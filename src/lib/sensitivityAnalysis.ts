import type { EnrichedRecord, GapModel } from './gapCalculator';
import { enrichRecords } from './gapCalculator';
import { filterRecords, analyzeDrift } from './driftAnalysis';
import type { DriftResult } from './driftAnalysis';
import type { ActivityRecord } from './fitParser';

/**
 * Sensitivity analysis: how stable is the drift result across parameter variations?
 */
export interface SensitivityResult {
  /** Base result with current parameters */
  baseResult: DriftResult;
  /** How drift changes with different warmup cutoffs */
  warmupSensitivity: WarmupSensitivityPoint[];
  /** How drift changes between GAP models */
  gapModelComparison: GapModelComparison;
  /** How drift changes with different split points (not just 50/50) */
  splitSensitivity: SplitSensitivityPoint[];
  /** Bootstrap confidence interval for drift */
  confidenceInterval: ConfidenceInterval;
  /** Overall robustness score 0-100 */
  robustnessScore: number;
  /** Summary as array of i18n key + params */
  summaryKeys: Array<{ key: string; params?: Record<string, string | number> }>;
}

export interface WarmupSensitivityPoint {
  warmupSeconds: number;
  driftPercent: number | null;
  analyzedMinutes: number;
}

export interface GapModelComparison {
  stravaDrift: number | null;
  minettiDrift: number | null;
  rawDrift: number | null;
  difference: number;
}

export interface SplitSensitivityPoint {
  /** Split ratio (0.3 = 30%/70%, 0.5 = 50%/50%) */
  splitRatio: number;
  driftPercent: number | null;
}

export interface ConfidenceInterval {
  /** Lower bound (5th percentile) */
  lower: number;
  /** Median */
  median: number;
  /** Upper bound (95th percentile) */
  upper: number;
  /** Width of the interval */
  width: number;
}

/**
 * Run full sensitivity analysis on a set of records.
 */
export function runSensitivityAnalysis(
  rawRecords: ActivityRecord[],
  currentTrimStart: number,
  currentTrimEnd: number,
  currentGapModel: GapModel,
): SensitivityResult {
  const enrichedStrava = enrichRecords(rawRecords, 'strava');
  const enrichedMinetti = enrichRecords(rawRecords, 'minetti');
  const currentEnriched = currentGapModel === 'strava' ? enrichedStrava : enrichedMinetti;

  // Base result
  const baseFiltered = filterRecords(currentEnriched, currentTrimStart, currentTrimEnd);
  let baseResult: DriftResult;
  try {
    baseResult = analyzeDrift(baseFiltered);
  } catch {
    // Can't do sensitivity without base result
    return emptyResult();
  }

  // 1. Warmup sensitivity: vary warmup cutoff from 0 to 20 minutes
  const warmupSensitivity: WarmupSensitivityPoint[] = [];
  const totalDuration = currentTrimEnd;
  for (let warmupSec = 0; warmupSec <= Math.min(1200, totalDuration * 0.4); warmupSec += 30) {
    const filtered = filterRecords(currentEnriched, warmupSec, currentTrimEnd);
    const analyzedMinutes = Math.round((currentTrimEnd - warmupSec) / 60);
    try {
      const result = analyzeDrift(filtered);
      warmupSensitivity.push({
        warmupSeconds: warmupSec,
        driftPercent: result.gapDecouplingPercent,
        analyzedMinutes,
      });
    } catch {
      warmupSensitivity.push({ warmupSeconds: warmupSec, driftPercent: null, analyzedMinutes });
    }
  }

  // 2. GAP model comparison
  let stravaDrift: number | null = null;
  let minettiDrift: number | null = null;
  let rawDrift: number | null = null;

  try {
    const stravaFiltered = filterRecords(enrichedStrava, currentTrimStart, currentTrimEnd);
    stravaDrift = analyzeDrift(stravaFiltered).gapDecouplingPercent;
  } catch {}

  try {
    const minettiFiltered = filterRecords(enrichedMinetti, currentTrimStart, currentTrimEnd);
    minettiDrift = analyzeDrift(minettiFiltered).gapDecouplingPercent;
  } catch {}

  try {
    rawDrift = baseResult.rawDecouplingPercent;
  } catch {}

  const driftValues = [stravaDrift, minettiDrift, rawDrift].filter(d => d != null) as number[];
  const gapModelDifference = driftValues.length >= 2
    ? Math.max(...driftValues) - Math.min(...driftValues)
    : 0;

  // 3. Split sensitivity: vary the split point from 30% to 70%
  const splitSensitivity: SplitSensitivityPoint[] = [];
  for (let ratio = 0.3; ratio <= 0.7; ratio += 0.05) {
    const filtered = filterRecords(currentEnriched, currentTrimStart, currentTrimEnd);
    try {
      const result = analyzeWithSplit(filtered, ratio);
      splitSensitivity.push({ splitRatio: ratio, driftPercent: result });
    } catch {
      splitSensitivity.push({ splitRatio: ratio, driftPercent: null });
    }
  }

  // 4. Bootstrap confidence interval
  const confidenceInterval = bootstrapConfidenceInterval(baseFiltered, 200);

  // 5. Robustness score
  const warmupRange = getRange(warmupSensitivity
    .filter(p => p.driftPercent != null)
    .map(p => p.driftPercent!));
  const splitRange = getRange(splitSensitivity
    .filter(p => p.driftPercent != null)
    .map(p => p.driftPercent!));
  const ciWidth = confidenceInterval.width;

  // Score: lower variation = higher robustness
  const warmupStability = Math.max(0, 100 - warmupRange * 10);
  const splitStability = Math.max(0, 100 - splitRange * 15);
  const modelStability = Math.max(0, 100 - gapModelDifference * 15);
  const ciStability = Math.max(0, 100 - ciWidth * 10);

  const robustnessScore = Math.round(
    warmupStability * 0.3 +
    splitStability * 0.2 +
    modelStability * 0.2 +
    ciStability * 0.3
  );

  // Summary as i18n key + params array
  const summaryKeys: Array<{ key: string; params?: Record<string, string | number> }> = [];
  if (robustnessScore >= 75) {
    summaryKeys.push({ key: 'diagnostics.sens.summaryRobust' });
  } else if (robustnessScore >= 50) {
    summaryKeys.push({ key: 'diagnostics.sens.summaryStable' });
  } else {
    summaryKeys.push({ key: 'diagnostics.sens.summarySensitive' });
  }

  if (gapModelDifference > 2) {
    summaryKeys.push({ key: 'diagnostics.sens.summaryGapModel', params: { diff: gapModelDifference.toFixed(1) } });
  }

  if (ciWidth > 3) {
    summaryKeys.push({ key: 'diagnostics.sens.summaryCIWide', params: { lower: confidenceInterval.lower.toFixed(1), upper: confidenceInterval.upper.toFixed(1) } });
  }

  if (warmupRange > 3) {
    summaryKeys.push({ key: 'diagnostics.sens.summaryWarmup' });
  }

  return {
    baseResult,
    warmupSensitivity,
    gapModelComparison: {
      stravaDrift,
      minettiDrift,
      rawDrift,
      difference: gapModelDifference,
    },
    splitSensitivity,
    confidenceInterval,
    robustnessScore,
    summaryKeys,
  };
}

/**
 * Analyze drift with a custom split ratio instead of 50/50.
 */
function analyzeWithSplit(records: EnrichedRecord[], splitRatio: number): number {
  if (records.length < 20) throw new Error('Too few records');

  const totalDuration = records[records.length - 1].elapsedSeconds - records[0].elapsedSeconds;
  const splitTime = records[0].elapsedSeconds + totalDuration * splitRatio;

  const firstHalf = records.filter(r => r.elapsedSeconds < splitTime);
  const secondHalf = records.filter(r => r.elapsedSeconds >= splitTime);

  if (firstHalf.length < 5 || secondHalf.length < 5) throw new Error('Too few in half');

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const firstGAP = avg(firstHalf.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));
  const secondGAP = avg(secondHalf.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));
  const firstHR = avg(firstHalf.filter(r => r.heartRate != null).map(r => r.heartRate!));
  const secondHR = avg(secondHalf.filter(r => r.heartRate != null).map(r => r.heartRate!));

  const ef1 = firstGAP / firstHR;
  const ef2 = secondGAP / secondHR;

  return ((ef1 - ef2) / ef1) * 100;
}

/**
 * Bootstrap resampling to estimate confidence interval for drift.
 * Resamples 60-second blocks to preserve temporal autocorrelation.
 */
function bootstrapConfidenceInterval(records: EnrichedRecord[], iterations: number): ConfidenceInterval {
  if (records.length < 30) {
    return { lower: 0, median: 0, upper: 0, width: 0 };
  }

  // Split into 60-second blocks
  const startTime = records[0].elapsedSeconds;
  const endTime = records[records.length - 1].elapsedSeconds;
  const blockDuration = 60;
  const blocks: EnrichedRecord[][] = [];

  for (let t = startTime; t < endTime; t += blockDuration) {
    const block = records.filter(r =>
      r.elapsedSeconds >= t && r.elapsedSeconds < t + blockDuration
    );
    if (block.length > 0) blocks.push(block);
  }

  if (blocks.length < 6) {
    return { lower: 0, median: 0, upper: 0, width: 0 };
  }

  const drifts: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    // Resample blocks with replacement
    const resampled: EnrichedRecord[] = [];
    const halfLen = Math.floor(blocks.length / 2);

    // Resample first half blocks
    for (let i = 0; i < halfLen; i++) {
      const idx = Math.floor(Math.random() * halfLen);
      resampled.push(...blocks[idx]);
    }
    const firstHalfEnd = resampled.length;

    // Resample second half blocks
    for (let i = halfLen; i < blocks.length; i++) {
      const idx = halfLen + Math.floor(Math.random() * (blocks.length - halfLen));
      resampled.push(...blocks[idx]);
    }

    // Calculate drift for this resample
    const first = resampled.slice(0, firstHalfEnd);
    const second = resampled.slice(firstHalfEnd);

    if (first.length < 5 || second.length < 5) continue;

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const firstHR = avg(first.filter(r => r.heartRate != null).map(r => r.heartRate!));
    const secondHR = avg(second.filter(r => r.heartRate != null).map(r => r.heartRate!));
    const firstGAP = avg(first.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));
    const secondGAP = avg(second.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));

    if (firstHR > 0 && firstGAP > 0) {
      const ef1 = firstGAP / firstHR;
      const ef2 = secondGAP / secondHR;
      drifts.push(((ef1 - ef2) / ef1) * 100);
    }
  }

  if (drifts.length < 10) {
    return { lower: 0, median: 0, upper: 0, width: 0 };
  }

  drifts.sort((a, b) => a - b);
  const lower = drifts[Math.floor(drifts.length * 0.05)];
  const median = drifts[Math.floor(drifts.length * 0.5)];
  const upper = drifts[Math.floor(drifts.length * 0.95)];

  return {
    lower,
    median,
    upper,
    width: upper - lower,
  };
}

function getRange(values: number[]): number {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

function emptyResult(): SensitivityResult {
  return {
    baseResult: null as any,
    warmupSensitivity: [],
    gapModelComparison: { stravaDrift: null, minettiDrift: null, rawDrift: null, difference: 0 },
    splitSensitivity: [],
    confidenceInterval: { lower: 0, median: 0, upper: 0, width: 0 },
    robustnessScore: 0,
    summaryKeys: [{ key: 'diagnostics.sens.summaryTooFewData' }],
  };
}
