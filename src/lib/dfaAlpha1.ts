import type { RRInterval } from './fitParser';

/**
 * DFA alpha1 (Detrended Fluctuation Analysis) for aerobic threshold detection.
 *
 * Based on Rogers et al. (2021) — PMC7845545:
 * - alpha1 = 0.75 corresponds to VT1 (aerobic threshold / AeT)
 * - alpha1 = 0.50 corresponds to VT2 (anaerobic threshold / LT2)
 *
 * Uses rolling 120-second windows advanced by 5 seconds.
 * Box sizes 4–16 for short-term alpha1 (standard in literature).
 */

export interface DFAWindow {
  /** Center time of this window in elapsed seconds */
  elapsedSeconds: number;
  /** DFA alpha1 value (NaN if insufficient data) */
  alpha1: number;
  /** Estimated heart rate from RR intervals (bpm) */
  heartRate: number;
  /** Artifact percentage in this window */
  artifactPercent: number;
  /** Number of RR intervals in this window */
  beatCount: number;
  /** Whether this window is valid (artifact < 5%, enough beats) */
  isValid: boolean;
}

export interface DFAResult {
  /** Rolling DFA alpha1 windows */
  windows: DFAWindow[];
  /** Estimated HRVT1 (heart rate where alpha1 crosses 0.75) */
  hrvt1: number | null;
  /** Estimated HRVT2 (heart rate where alpha1 crosses 0.50) */
  hrvt2: number | null;
  /** Time when alpha1 first crosses 0.75 (elapsed seconds) */
  hrvt1Time: number | null;
  /** Time when alpha1 first crosses 0.50 (elapsed seconds) */
  hrvt2Time: number | null;
  /** Overall data quality assessment */
  quality: DFAQuality;
  /** Whether there's enough HRV data for reliable analysis */
  isReliable: boolean;
}

export interface DFAQuality {
  totalBeats: number;
  validWindows: number;
  totalWindows: number;
  avgArtifactPercent: number;
  sensorType: 'chest-strap' | 'optical' | 'unknown';
  recommendation: string;
}

// Constants
const WINDOW_DURATION_MS = 120_000;  // 120 seconds
const WINDOW_ADVANCE_MS = 5_000;     // 5 seconds
const MIN_BEATS_PER_WINDOW = 50;
const MAX_ARTIFACT_PERCENT = 5.0;
const BOX_SIZES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/**
 * Run complete DFA alpha1 analysis on RR interval data.
 */
export function analyzeDFAAlpha1(rrIntervals: RRInterval[]): DFAResult {
  if (rrIntervals.length < MIN_BEATS_PER_WINDOW) {
    return emptyResult('Liian vähän RR-intervalleja DFA-analyysiin');
  }

  // Filter out gap markers
  const validRR = rrIntervals.filter(rr => !rr.isGap && rr.rrMs > 0);

  if (validRR.length < MIN_BEATS_PER_WINDOW) {
    return emptyResult('Liian vähän valideja RR-intervalleja');
  }

  // Determine sensor type from quality flags
  const hasQualityFlags = validRR.some(rr => rr.quality != null);
  const sensorType = inferSensorType(validRR);

  // Compute rolling windows
  const windows = computeRollingWindows(validRR);

  const validWindows = windows.filter(w => w.isValid);
  const avgArtifact = validWindows.length > 0
    ? validWindows.reduce((s, w) => s + w.artifactPercent, 0) / validWindows.length
    : 100;

  // Find HRVT1 (alpha1 = 0.75) and HRVT2 (alpha1 = 0.50)
  const hrvt1 = findThresholdCrossing(validWindows, 0.75);
  const hrvt2 = findThresholdCrossing(validWindows, 0.50);

  const quality: DFAQuality = {
    totalBeats: validRR.length,
    validWindows: validWindows.length,
    totalWindows: windows.length,
    avgArtifactPercent: avgArtifact,
    sensorType,
    recommendation: getRecommendation(sensorType, validWindows.length, avgArtifact),
  };

  return {
    windows,
    hrvt1: hrvt1?.heartRate ?? null,
    hrvt2: hrvt2?.heartRate ?? null,
    hrvt1Time: hrvt1?.time ?? null,
    hrvt2Time: hrvt2?.time ?? null,
    quality,
    isReliable: validWindows.length >= 10 && sensorType !== 'optical' && avgArtifact < 5,
  };
}

/**
 * Compute rolling DFA alpha1 windows.
 */
function computeRollingWindows(rrIntervals: RRInterval[]): DFAWindow[] {
  const windows: DFAWindow[] = [];
  const totalDurationMs = rrIntervals.reduce((s, rr) => s + rr.rrMs, 0);

  let windowStartMs = 0;

  while (windowStartMs + WINDOW_DURATION_MS <= totalDurationMs) {
    // Collect RR intervals for this window
    const windowRR = getWindowIntervals(rrIntervals, windowStartMs, WINDOW_DURATION_MS);

    if (windowRR.length < MIN_BEATS_PER_WINDOW) {
      windowStartMs += WINDOW_ADVANCE_MS;
      continue;
    }

    // Artifact detection and cleaning
    const { cleaned, artifactPercent } = detectAndCleanArtifacts(windowRR);

    const isValid = artifactPercent <= MAX_ARTIFACT_PERCENT && cleaned.length >= MIN_BEATS_PER_WINDOW;

    // Calculate heart rate from mean RR
    const meanRR = cleaned.reduce((s, rr) => s + rr, 0) / cleaned.length;
    const heartRate = 60000 / meanRR;

    // Compute DFA alpha1
    let alpha1 = NaN;
    if (isValid) {
      alpha1 = computeAlpha1(cleaned);
    }

    const centerMs = windowStartMs + WINDOW_DURATION_MS / 2;

    windows.push({
      elapsedSeconds: centerMs / 1000,
      alpha1,
      heartRate: Math.round(heartRate),
      artifactPercent,
      beatCount: windowRR.length,
      isValid,
    });

    windowStartMs += WINDOW_ADVANCE_MS;
  }

  return windows;
}

/**
 * Get RR intervals within a time window.
 */
function getWindowIntervals(
  rrIntervals: RRInterval[],
  startMs: number,
  durationMs: number,
): number[] {
  const result: number[] = [];
  let cumulativeMs = 0;

  for (const rr of rrIntervals) {
    if (cumulativeMs >= startMs && cumulativeMs < startMs + durationMs) {
      result.push(rr.rrMs);
    }
    cumulativeMs += rr.rrMs;
    if (cumulativeMs >= startMs + durationMs) break;
  }

  return result;
}

/**
 * Artifact detection and correction using:
 * 1. Physiological range filter (300-2000ms = 30-200 bpm)
 * 2. Successive difference filter (percentage-based)
 * 3. Local median filter
 * 4. Cubic interpolation for correction (NOT deletion, which inflates alpha1)
 */
function detectAndCleanArtifacts(rrMs: number[]): { cleaned: number[]; artifactPercent: number } {
  if (rrMs.length === 0) return { cleaned: [], artifactPercent: 100 };

  const isArtifact = new Array(rrMs.length).fill(false);
  let artifactCount = 0;

  for (let i = 0; i < rrMs.length; i++) {
    // Physiological range
    if (rrMs[i] < 300 || rrMs[i] > 2000) {
      isArtifact[i] = true;
      artifactCount++;
      continue;
    }

    // Successive difference (percentage-based)
    if (i > 0 && !isArtifact[i - 1]) {
      const percentDiff = (rrMs[i] - rrMs[i - 1]) / rrMs[i - 1];
      if (percentDiff > 0.325 || percentDiff < -0.245) {
        isArtifact[i] = true;
        artifactCount++;
        continue;
      }
    }

    // Local median comparison (window of 5)
    const start = Math.max(0, i - 2);
    const end = Math.min(rrMs.length - 1, i + 2);
    const neighbors: number[] = [];
    for (let j = start; j <= end; j++) {
      if (j !== i && !isArtifact[j]) neighbors.push(rrMs[j]);
    }
    if (neighbors.length >= 2) {
      const localMedian = median(neighbors);
      if (Math.abs(rrMs[i] - localMedian) / localMedian > 0.20) {
        isArtifact[i] = true;
        artifactCount++;
      }
    }
  }

  const artifactPercent = (artifactCount / rrMs.length) * 100;

  // Interpolate artifacts (don't delete — deletion inflates alpha1)
  const cleaned = [...rrMs];
  for (let i = 0; i < cleaned.length; i++) {
    if (isArtifact[i]) {
      // Find nearest valid neighbors
      let prevValid = -1;
      let nextValid = -1;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!isArtifact[j]) { prevValid = j; break; }
      }
      for (let j = i + 1; j < Math.min(cleaned.length, i + 5); j++) {
        if (!isArtifact[j]) { nextValid = j; break; }
      }

      if (prevValid >= 0 && nextValid >= 0) {
        // Linear interpolation between nearest valid values
        const ratio = (i - prevValid) / (nextValid - prevValid);
        cleaned[i] = rrMs[prevValid] + ratio * (rrMs[nextValid] - rrMs[prevValid]);
      } else if (prevValid >= 0) {
        cleaned[i] = rrMs[prevValid];
      } else if (nextValid >= 0) {
        cleaned[i] = rrMs[nextValid];
      }
      // else leave as-is (shouldn't happen often)
    }
  }

  return { cleaned, artifactPercent };
}

/**
 * Compute DFA alpha1 scaling exponent.
 *
 * Steps:
 * 1. Integration: cumulative sum of mean-subtracted series
 * 2. For each box size n (4-16): divide into non-overlapping boxes,
 *    fit linear trend, compute RMS of detrended residuals
 * 3. Log-log regression of F(n) vs n → slope = alpha1
 */
function computeAlpha1(rrMs: number[]): number {
  const N = rrMs.length;
  if (N < BOX_SIZES[BOX_SIZES.length - 1]) return NaN;

  const meanRR = rrMs.reduce((s, v) => s + v, 0) / N;

  // Step 1: Integration (cumulative sum of deviations from mean)
  const Y = new Float64Array(N);
  Y[0] = rrMs[0] - meanRR;
  for (let k = 1; k < N; k++) {
    Y[k] = Y[k - 1] + (rrMs[k] - meanRR);
  }

  // Step 2: Compute fluctuation for each box size
  const logN: number[] = [];
  const logF: number[] = [];

  for (const n of BOX_SIZES) {
    if (n > N) break;

    const numBoxes = Math.floor(N / n);
    if (numBoxes < 1) continue;

    let varianceSum = 0;

    for (let box = 0; box < numBoxes; box++) {
      const offset = box * n;

      // Linear least squares fit: y = a*x + b
      // Using direct formulas for speed
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        const x = i;
        const y = Y[offset + i];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }

      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) < 1e-12) continue;

      const a = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - a * sumX) / n;

      // Detrend and compute variance
      let squaredSum = 0;
      for (let i = 0; i < n; i++) {
        const trend = a * i + b;
        const residual = Y[offset + i] - trend;
        squaredSum += residual * residual;
      }

      varianceSum += squaredSum / n;
    }

    // RMS fluctuation for this box size
    const F_n = Math.sqrt(varianceSum / numBoxes);
    if (F_n > 0) {
      logN.push(Math.log(n));
      logF.push(Math.log(F_n));
    }
  }

  // Step 3: Log-log regression → alpha1 is the slope
  if (logN.length < 3) return NaN;

  return linearRegressionSlope(logN, logF);
}

/**
 * Find the heart rate where DFA alpha1 crosses a threshold value.
 * Uses the incremental test approach: as exercise intensity increases,
 * alpha1 decreases. Find the interpolated crossing point.
 */
function findThresholdCrossing(
  windows: DFAWindow[],
  thresholdAlpha1: number,
): { heartRate: number; time: number } | null {
  // We need windows sorted by time, look for when alpha1 drops below threshold
  const valid = windows.filter(w => w.isValid && !isNaN(w.alpha1));
  if (valid.length < 5) return null;

  // Smooth alpha1 with 5-point moving average to reduce noise
  const smoothed = movingAverage(valid.map(w => w.alpha1), 5);

  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i - 1] >= thresholdAlpha1 && smoothed[i] < thresholdAlpha1) {
      // Interpolate the crossing point
      const ratio = (thresholdAlpha1 - smoothed[i - 1]) / (smoothed[i] - smoothed[i - 1]);
      const crossHR = valid[i - 1].heartRate + ratio * (valid[i].heartRate - valid[i - 1].heartRate);
      const crossTime = valid[i - 1].elapsedSeconds + ratio * (valid[i].elapsedSeconds - valid[i - 1].elapsedSeconds);

      return {
        heartRate: Math.round(crossHR),
        time: crossTime,
      };
    }
  }

  return null;
}

/**
 * Infer sensor type from RR interval characteristics.
 * Optical sensors have more noise and artifacts.
 */
function inferSensorType(rrIntervals: RRInterval[]): 'chest-strap' | 'optical' | 'unknown' {
  if (rrIntervals.length === 0) return 'unknown';

  // If we have quality flags (from rawBbi), it's likely a modern device
  const hasQuality = rrIntervals.some(rr => rr.quality != null);

  // Calculate successive differences
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(rrIntervals.length, 1000); i++) {
    diffs.push(Math.abs(rrIntervals[i].rrMs - rrIntervals[i - 1].rrMs));
  }

  if (diffs.length === 0) return 'unknown';

  // RMSSD approximation — optical sensors tend to have very low RMSSD
  // (they smooth/filter the signal) or very noisy RMSSD
  const rmssd = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);

  // Very round numbers (quantized to ~10ms) suggest optical
  const roundCount = rrIntervals.slice(0, 500).filter(rr => rr.rrMs % 10 === 0).length;
  const roundPercent = roundCount / Math.min(rrIntervals.length, 500);

  if (roundPercent > 0.8) return 'optical';
  if (hasQuality) return 'chest-strap';
  if (rmssd > 5 && rmssd < 100) return 'chest-strap';

  return 'unknown';
}

function getRecommendation(
  sensorType: string,
  validWindows: number,
  avgArtifact: number,
): string {
  const parts: string[] = [];

  if (sensorType === 'optical') {
    parts.push('Optinen sykemittari havaittu — DFA alpha1 vaatii rintasensorin (esim. Polar H10) luotettaviin tuloksiin.');
  } else if (sensorType === 'chest-strap') {
    parts.push('Rintasensori havaittu — hyvä datan laatu DFA-analyysiin.');
  }

  if (validWindows < 10) {
    parts.push('Liian vähän valideja ikkunoita luotettavaan analyysiin.');
  }

  if (avgArtifact > 3) {
    parts.push(`Keskimääräinen artefaktiprosentti ${avgArtifact.toFixed(1)}% — datassa kohinaa.`);
  }

  if (parts.length === 0) {
    parts.push('Datan laatu on hyvä DFA alpha1 -analyysiin.');
  }

  return parts.join(' ');
}

function emptyResult(reason: string): DFAResult {
  return {
    windows: [],
    hrvt1: null,
    hrvt2: null,
    hrvt1Time: null,
    hrvt2Time: null,
    quality: {
      totalBeats: 0,
      validWindows: 0,
      totalWindows: 0,
      avgArtifactPercent: 100,
      sensorType: 'unknown',
      recommendation: reason,
    },
    isReliable: false,
  };
}

// --- Utility functions ---

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function linearRegressionSlope(x: number[], y: number[]): number {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return NaN;
  return (n * sumXY - sumX * sumY) / denom;
}

function movingAverage(arr: number[], windowSize: number): number[] {
  const result: number[] = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(arr.length - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += arr[j];
    result.push(sum / (end - start + 1));
  }
  return result;
}
