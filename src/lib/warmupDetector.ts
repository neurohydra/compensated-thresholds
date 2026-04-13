import type { EnrichedRecord } from './gapCalculator';

/**
 * Warmup detection diagnostics — returned to UI for transparency.
 */
export interface WarmupDiagnostics {
  /** Detected warmup end in seconds */
  warmupEndSeconds: number;
  /** Method used for detection */
  method: 'hr-pace-combined' | 'hr-only' | 'fallback';
  /** Confidence in the detection */
  confidence: 'high' | 'medium' | 'low';
  /** HR at the detected warmup end */
  hrAtEnd: number;
  /** HR rate of change at detection point (bpm/min) */
  hrRateAtEnd: number;
  /** Pace CV (coefficient of variation) at detection point */
  paceCvAtEnd: number;
  /** HR standard deviation in the 60s after detection */
  hrStdAfterDetection: number;
  /** Rolling window data for visualization */
  windows: WarmupWindow[];
  /** Explanation of why this point was chosen */
  reason: string;
}

export interface WarmupWindow {
  /** Center time of window in elapsed seconds */
  time: number;
  /** Average HR in this window */
  avgHR: number;
  /** HR rate of change (bpm/min) */
  hrRate: number;
  /** Speed coefficient of variation (0-1) */
  speedCV: number;
  /** HR standard deviation in this window */
  hrStd: number;
  /** Combined stability score (lower = more stable) */
  stabilityScore: number;
  /** Whether this window is marked as "stable" */
  isStable: boolean;
}

interface DetectorOptions {
  /** Rolling window size in seconds for smoothing */
  windowSec?: number;
  /** Max HR rise rate (bpm/min) to consider "stable" */
  stableRateBpmPerMin?: number;
  /** Max HR standard deviation within window to consider stable */
  maxHrStd?: number;
  /** Max speed CV to consider pace stable */
  maxSpeedCV?: number;
  /** How many consecutive stable windows needed */
  confirmWindows?: number;
  /** Minimum warmup duration in seconds */
  minWarmupSec?: number;
  /** Maximum warmup duration in seconds */
  maxWarmupSec?: number;
}

const DEFAULT_OPTIONS: Required<DetectorOptions> = {
  windowSec: 60,
  stableRateBpmPerMin: 2.0,
  maxHrStd: 5.0,
  maxSpeedCV: 0.25,
  confirmWindows: 3,
  minWarmupSec: 120,
  maxWarmupSec: 1200,
};

/**
 * Detect warmup end using combined HR + pace + HR variance analysis.
 *
 * Strategy (multi-signal approach):
 * 1. Compute rolling windows with:
 *    - Average HR and HR rate of change (derivative)
 *    - HR standard deviation within window (variability)
 *    - Speed coefficient of variation (pace consistency)
 * 2. Calculate combined "stability score" for each window
 * 3. Warmup ends when stability score drops below threshold for N consecutive windows
 * 4. Validate: check that post-warmup HR doesn't immediately spike (false positive)
 *
 * Returns elapsed seconds where the steady-state portion begins.
 */
export function detectWarmupEnd(
  records: EnrichedRecord[],
  options: DetectorOptions = {},
): number {
  const result = detectWarmupEndWithDiagnostics(records, options);
  return result.warmupEndSeconds;
}

/**
 * Full detection with diagnostics for UI display and validation.
 */
export function detectWarmupEndWithDiagnostics(
  records: EnrichedRecord[],
  options: DetectorOptions = {},
): WarmupDiagnostics {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { windowSec, stableRateBpmPerMin, maxHrStd, maxSpeedCV, confirmWindows, minWarmupSec, maxWarmupSec } = opts;

  const hrRecords = records.filter(r => r.heartRate != null && r.heartRate > 40);

  if (hrRecords.length < 20) {
    return fallbackResult(0, 'Liian vähän datapisteitä', []);
  }

  const startTime = hrRecords[0].elapsedSeconds;
  const endTime = hrRecords[hrRecords.length - 1].elapsedSeconds;
  const totalDuration = endTime - startTime;

  if (totalDuration < minWarmupSec * 2) {
    return fallbackResult(0, 'Suoritus liian lyhyt automaattiseen lämmittelytunnistukseen', []);
  }

  // Build rolling windows with multiple signals
  const stepSec = windowSec / 2; // 50% overlap
  const windows: WarmupWindow[] = [];
  let prevAvgHR: number | null = null;
  let prevTime: number | null = null;

  for (let t = startTime; t + windowSec <= endTime; t += stepSec) {
    const windowRecords = hrRecords.filter(
      r => r.elapsedSeconds >= t && r.elapsedSeconds < t + windowSec
    );
    if (windowRecords.length < 3) continue;

    // HR metrics
    const hrs = windowRecords.map(r => r.heartRate!);
    const avgHR = mean(hrs);
    const hrStd = std(hrs);

    // HR rate of change
    let hrRate = 0;
    if (prevAvgHR != null && prevTime != null) {
      const dt = ((t + windowSec / 2) - prevTime) / 60; // minutes
      if (dt > 0) {
        hrRate = (avgHR - prevAvgHR) / dt;
      }
    }

    // Speed metrics (coefficient of variation)
    const speeds = windowRecords
      .filter(r => r.speed != null && r.speed > 0.3)
      .map(r => r.speed!);
    const speedCV = speeds.length >= 2 ? std(speeds) / mean(speeds) : 0.5;

    // Combined stability score (lower = more stable)
    // Weighted combination of normalized signals
    const hrRateNorm = Math.abs(hrRate) / stableRateBpmPerMin;  // 1.0 = at threshold
    const hrStdNorm = hrStd / maxHrStd;                         // 1.0 = at threshold
    const speedCVNorm = speedCV / maxSpeedCV;                    // 1.0 = at threshold

    const stabilityScore = hrRateNorm * 0.4 + hrStdNorm * 0.3 + speedCVNorm * 0.3;

    const isStable = hrRate < stableRateBpmPerMin && hrStd < maxHrStd && speedCV < maxSpeedCV;

    const windowTime = t + windowSec / 2;
    windows.push({
      time: windowTime - startTime, // relative to start
      avgHR,
      hrRate,
      speedCV,
      hrStd,
      stabilityScore,
      isStable,
    });

    prevAvgHR = avgHR;
    prevTime = windowTime;
  }

  if (windows.length < confirmWindows + 2) {
    return fallbackResult(0, 'Liian vähän ikkunoita analyysiin', windows);
  }

  // Find where stability is achieved for consecutive windows
  let stableCount = 0;
  let bestDetection: { index: number; score: number } | null = null;

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const elapsed = w.time;

    if (elapsed < minWarmupSec) {
      stableCount = 0;
      continue;
    }

    if (elapsed > maxWarmupSec) {
      // Use best detection found so far, or max warmup
      if (bestDetection) {
        return buildResult(windows, bestDetection.index, confirmWindows, 'hr-pace-combined', 'medium',
          `Tasaantuminen tunnistettu ${formatSec(windows[bestDetection.index].time)}, mutta ei täysin vakaa. ` +
          `Paras stabiilius: ${windows[bestDetection.index].stabilityScore.toFixed(2)}`);
      }
      return buildResult(windows, i, 0, 'fallback', 'low',
        `Syke ei tasaantunut ${formatSec(maxWarmupSec)} kuluessa. Käytetään maksimileikkausta.`);
    }

    if (w.isStable) {
      stableCount++;
      if (stableCount >= confirmWindows) {
        // Validate: check post-detection HR doesn't spike
        const detectionIdx = i - confirmWindows + 1;
        if (validatePostWarmup(windows, detectionIdx, confirmWindows)) {
          const method = hasSpeedData(windows, detectionIdx) ? 'hr-pace-combined' : 'hr-only';
          return buildResult(windows, detectionIdx, confirmWindows, method, 'high',
            `Syke ja vauhti tasaantuivat ${formatSec(windows[detectionIdx].time)} kohdalla. ` +
            `HR-nousu: ${w.hrRate.toFixed(1)} bpm/min, HR-hajonta: ${w.hrStd.toFixed(1)} bpm, ` +
            `vauhdin vaihtelu: ${(w.speedCV * 100).toFixed(0)}%.`);
        }
        // False positive — HR spikes after, keep looking
        stableCount = 0;
      }
    } else {
      // Track the "most stable" window even if not fully stable
      if (w.stabilityScore < (bestDetection ? windows[bestDetection.index].stabilityScore : Infinity)) {
        bestDetection = { index: i, score: w.stabilityScore };
      }
      stableCount = 0;
    }
  }

  // Didn't find sustained stability — use best partial match
  if (bestDetection) {
    return buildResult(windows, bestDetection.index, 0, 'hr-only', 'low',
      `Täyttä tasaantumista ei löytynyt. Käytetään parasta kohtaa (stabiilius: ${windows[bestDetection.index].stabilityScore.toFixed(2)}) ` +
      `kohdassa ${formatSec(windows[bestDetection.index].time)}.`);
  }

  // Last resort: 15% of total
  const fallbackSec = Math.min(Math.round(totalDuration * 0.15), maxWarmupSec);
  return fallbackResult(fallbackSec, 'Tasaantumispistettä ei löytynyt. Käytetään 15% kokonaiskestosta.', windows);
}

/**
 * Validate that HR doesn't spike in the 3 windows after the detected point.
 * This catches false positives where HR briefly dips during a hill descent
 * but then climbs again (not a real warmup end).
 */
function validatePostWarmup(windows: WarmupWindow[], detectionIdx: number, lookAhead: number): boolean {
  const baseHR = windows[detectionIdx].avgHR;

  for (let i = detectionIdx + 1; i < Math.min(detectionIdx + lookAhead + 3, windows.length); i++) {
    // If HR rises more than 8 bpm above the detected level, it's a false positive
    if (windows[i].avgHR > baseHR + 8) {
      return false;
    }
  }
  return true;
}

function hasSpeedData(windows: WarmupWindow[], idx: number): boolean {
  return windows[idx].speedCV < 0.5; // meaningful speed CV means we had speed data
}

function buildResult(
  windows: WarmupWindow[],
  detectionIdx: number,
  confirmOffset: number,
  method: WarmupDiagnostics['method'],
  confidence: WarmupDiagnostics['confidence'],
  reason: string,
): WarmupDiagnostics {
  const w = windows[detectionIdx];
  // Calculate post-detection HR stability
  const postWindows = windows.slice(detectionIdx, detectionIdx + 5);
  const postHrs = postWindows.map(pw => pw.avgHR);
  const hrStdAfter = postHrs.length >= 2 ? std(postHrs) : 0;

  return {
    warmupEndSeconds: Math.round(w.time),
    method,
    confidence,
    hrAtEnd: Math.round(w.avgHR),
    hrRateAtEnd: w.hrRate,
    paceCvAtEnd: w.speedCV,
    hrStdAfterDetection: hrStdAfter,
    windows,
    reason,
  };
}

function fallbackResult(seconds: number, reason: string, windows: WarmupWindow[]): WarmupDiagnostics {
  return {
    warmupEndSeconds: seconds,
    method: 'fallback',
    confidence: 'low',
    hrAtEnd: 0,
    hrRateAtEnd: 0,
    paceCvAtEnd: 0,
    hrStdAfterDetection: 0,
    windows,
    reason,
  };
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
