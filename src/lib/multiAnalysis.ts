import type { ActivitySummary } from './fitParser';
import type { EnrichedRecord, GapModel } from './gapCalculator';
import { enrichRecords } from './gapCalculator';
import { filterRecords, analyzeDrift, speedToPace, formatDuration } from './driftAnalysis';
import type { DriftResult } from './driftAnalysis';
import { detectWarmupEnd, detectWarmupEndWithDiagnostics } from './warmupDetector';
import type { WarmupDiagnostics } from './warmupDetector';
import { assessDataQuality } from './dataQuality';
import type { DataQualityReport } from './dataQuality';

export interface AnalyzedActivity {
  id: string;
  fileName: string;
  activity: ActivitySummary;
  enrichedRecords: EnrichedRecord[];
  /** Default trim: skip warmup */
  trimStart: number;
  trimEnd: number;
  /** Drift result for trimmed region */
  driftResult: DriftResult | null;
  /** Average HR of the first half (used as the "test HR") */
  testHR: number;
  /** Average HR over full trimmed region */
  avgHR: number;
  /** Average pace over trimmed region */
  avgPace: string;
  /** Date of the activity */
  date: Date;
  /** Duration of analyzed segment */
  analyzedMinutes: number;
  /** Color for charts */
  color: string;
  /** Auto-detected warmup end in seconds */
  warmupDetectedAt: number;
  /** Warmup detection diagnostics */
  warmupDiag: WarmupDiagnostics;
  /** Data quality report */
  dataQuality: DataQualityReport;
}

export interface ThresholdEstimate {
  /** Estimated AeT heart rate */
  aetHR: number;
  /** Confidence: how close the interpolation points are */
  confidence: 'high' | 'medium' | 'low';
  /** Description */
  description: string;
  /** The two activities used to interpolate (below and above) */
  belowActivity: AnalyzedActivity | null;
  aboveActivity: AnalyzedActivity | null;
}

export interface MultiAnalysisResult {
  activities: AnalyzedActivity[];
  thresholdEstimate: ThresholdEstimate | null;
  /** Sorted by testHR for charting */
  sortedByHR: AnalyzedActivity[];
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
  '#14b8a6', '#e11d48', '#0ea5e9', '#d946ef', '#22c55e',
];

let idCounter = 0;

export function createAnalyzedActivity(
  activity: ActivitySummary,
  fileName: string,
  gapModel: GapModel,
  colorIndex: number,
): AnalyzedActivity {
  const id = `act_${++idCounter}_${Date.now()}`;
  const enriched = enrichRecords(activity.records, gapModel);

  // Auto-detect warmup end by finding where HR stabilizes
  const warmupDiag = detectWarmupEndWithDiagnostics(enriched);
  const trimStart = warmupDiag.warmupEndSeconds;
  const dataQuality = assessDataQuality(enriched);
  const trimEnd = activity.totalDuration;

  const filtered = filterRecords(enriched, trimStart, trimEnd);

  let driftResult: DriftResult | null = null;
  let testHR = 0;
  let avgHR = 0;

  try {
    driftResult = analyzeDrift(filtered);
    testHR = driftResult.firstHalfAvgHR;
    avgHR = (driftResult.firstHalfAvgHR + driftResult.secondHalfAvgHR) / 2;
  } catch {
    // Not enough data
    const hrs = filtered.filter(r => r.heartRate != null).map(r => r.heartRate!);
    avgHR = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
    testHR = avgHR;
  }

  const speeds = filtered.filter(r => r.speed != null).map(r => r.speed!);
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  return {
    id,
    fileName,
    activity,
    enrichedRecords: enriched,
    trimStart,
    trimEnd,
    driftResult,
    testHR: Math.round(testHR),
    avgHR: Math.round(avgHR),
    avgPace: speedToPace(avgSpeed),
    date: activity.startTime,
    analyzedMinutes: Math.round((trimEnd - trimStart) / 60),
    color: COLORS[colorIndex % COLORS.length],
    warmupDetectedAt: trimStart,
    warmupDiag,
    dataQuality,
  };
}

export function reanalyzeActivity(
  act: AnalyzedActivity,
  trimStart: number,
  trimEnd: number,
  gapModel: GapModel,
): AnalyzedActivity {
  const enriched = enrichRecords(act.activity.records, gapModel);
  const filtered = filterRecords(enriched, trimStart, trimEnd);

  let driftResult: DriftResult | null = null;
  let testHR = 0;
  let avgHR = 0;

  try {
    driftResult = analyzeDrift(filtered);
    testHR = driftResult.firstHalfAvgHR;
    avgHR = (driftResult.firstHalfAvgHR + driftResult.secondHalfAvgHR) / 2;
  } catch {
    const hrs = filtered.filter(r => r.heartRate != null).map(r => r.heartRate!);
    avgHR = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
    testHR = avgHR;
  }

  const speeds = filtered.filter(r => r.speed != null).map(r => r.speed!);
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  return {
    ...act,
    enrichedRecords: enriched,
    trimStart,
    trimEnd,
    driftResult,
    testHR: Math.round(testHR),
    avgHR: Math.round(avgHR),
    avgPace: speedToPace(avgSpeed),
    analyzedMinutes: Math.round((trimEnd - trimStart) / 60),
  };
}

/**
 * Estimate aerobic threshold by finding where drift crosses 3.5-5% range.
 * Uses linear interpolation between activities sorted by first-half HR.
 */
export function estimateThreshold(activities: AnalyzedActivity[]): ThresholdEstimate | null {
  // Filter to activities with valid drift results and sufficient duration
  const valid = activities.filter(a =>
    a.driftResult != null &&
    a.analyzedMinutes >= 20 &&
    a.testHR > 0
  );

  if (valid.length === 0) return null;

  // Sort by first half HR (test HR)
  const sorted = [...valid].sort((a, b) => a.testHR - b.testHR);

  // Check if any activity is exactly in the 3.5-5% range
  const atThreshold = sorted.filter(a =>
    a.driftResult!.gapDecouplingPercent >= 3.5 &&
    a.driftResult!.gapDecouplingPercent <= 5.0
  );

  if (atThreshold.length > 0) {
    // Average of all activities in the sweet spot
    const avgAeT = atThreshold.reduce((s, a) => s + a.testHR, 0) / atThreshold.length;
    return {
      aetHR: Math.round(avgAeT),
      confidence: atThreshold.length >= 2 ? 'high' : 'medium',
      description: `${atThreshold.length} suoritusta osui 3.5-5% driftialueelle. Aerobinen kynnys on noin ${Math.round(avgAeT)} bpm.`,
      belowActivity: atThreshold[0],
      aboveActivity: atThreshold[atThreshold.length - 1],
    };
  }

  // Try to interpolate: find pair where drift crosses from <3.5% to >5%
  for (let i = 0; i < sorted.length - 1; i++) {
    const low = sorted[i];
    const high = sorted[i + 1];
    const driftLow = low.driftResult!.gapDecouplingPercent;
    const driftHigh = high.driftResult!.gapDecouplingPercent;

    // One below 3.5, one above 5 (or one below and one above 3.5)
    if (driftLow < 3.5 && driftHigh > 3.5) {
      // Linear interpolation to find HR where drift = 3.5%
      const target = 3.5;
      const ratio = (target - driftLow) / (driftHigh - driftLow);
      const aetHR = low.testHR + ratio * (high.testHR - low.testHR);

      const hrGap = high.testHR - low.testHR;
      const confidence = hrGap <= 5 ? 'high' : hrGap <= 10 ? 'medium' : 'low';

      return {
        aetHR: Math.round(aetHR),
        confidence,
        description: `Interpoloitu suorituksista: ${low.testHR} bpm (${driftLow.toFixed(1)}% drifti) ja ${high.testHR} bpm (${driftHigh.toFixed(1)}% drifti). Sykealueiden väli: ${hrGap} bpm.`,
        belowActivity: low,
        aboveActivity: high,
      };
    }
  }

  // Can't interpolate — give best guess based on available data
  const allBelow = sorted.every(a => a.driftResult!.gapDecouplingPercent < 3.5);
  const allAbove = sorted.every(a => a.driftResult!.gapDecouplingPercent > 5.0);

  if (allBelow) {
    const highest = sorted[sorted.length - 1];
    return {
      aetHR: highest.testHR + 5,
      confidence: 'low',
      description: `Kaikki suoritukset olivat alle 3.5% driftin. AeT on todennäköisesti yli ${highest.testHR} bpm. Testaa korkeammalla sykkeellä.`,
      belowActivity: highest,
      aboveActivity: null,
    };
  }

  if (allAbove) {
    const lowest = sorted[0];
    return {
      aetHR: lowest.testHR - 5,
      confidence: 'low',
      description: `Kaikki suoritukset ylittivät 5% driftin. AeT on todennäköisesti alle ${lowest.testHR} bpm. Testaa matalammalla sykkeellä.`,
      belowActivity: null,
      aboveActivity: lowest,
    };
  }

  return null;
}

export function runMultiAnalysis(activities: AnalyzedActivity[]): MultiAnalysisResult {
  const sortedByHR = [...activities]
    .filter(a => a.driftResult != null)
    .sort((a, b) => a.testHR - b.testHR);

  const thresholdEstimate = estimateThreshold(activities);

  return {
    activities,
    thresholdEstimate,
    sortedByHR,
  };
}
