import type { EnrichedRecord } from './gapCalculator';

export interface DriftResult {
  /** Decoupling percentage: positive = HR drifted up relative to pace */
  decouplingPercent: number;
  /** First half average heart rate */
  firstHalfAvgHR: number;
  /** Second half average heart rate */
  secondHalfAvgHR: number;
  /** First half average speed (m/s) */
  firstHalfAvgSpeed: number;
  /** Second half average speed (m/s) */
  secondHalfAvgSpeed: number;
  /** First half average GAP speed (m/s) */
  firstHalfAvgGAP: number;
  /** Second half average GAP speed (m/s) */
  secondHalfAvgGAP: number;
  /** First half Efficiency Factor (speed / HR) */
  firstHalfEF: number;
  /** Second half Efficiency Factor */
  secondHalfEF: number;
  /** First half GAP-based Efficiency Factor */
  firstHalfGapEF: number;
  /** Second half GAP-based Efficiency Factor */
  secondHalfGapEF: number;
  /** Raw (non-compensated) decoupling percentage */
  rawDecouplingPercent: number;
  /** GAP-compensated decoupling percentage */
  gapDecouplingPercent: number;
  /** Duration of analyzed segment in seconds */
  analyzedDuration: number;
  /** Interpretation of the result */
  interpretation: ThresholdInterpretation;
  /** Suggested AeT heart rate based on analysis */
  suggestedAeT: number | null;
}

export interface ThresholdInterpretation {
  level: 'below' | 'at' | 'above';
  message: string;
  description: string;
}

export interface SegmentAnalysis {
  /** Per-segment drift analysis for rolling window */
  segments: SegmentDrift[];
  /** Overall drift result */
  overall: DriftResult;
}

export interface SegmentDrift {
  startSeconds: number;
  endSeconds: number;
  avgHR: number;
  avgSpeed: number;
  avgGAP: number;
  ef: number;
  gapEf: number;
}

function interpret(decoupling: number, avgHR: number): ThresholdInterpretation {
  if (decoupling < 3.5) {
    return {
      level: 'below',
      message: 'Alle AeT:n',
      description: `Drifti ${decoupling.toFixed(1)}% on alle 3.5%. Aerobinen kynnys on todennäköisesti korkeammalla. Toista testi 5 bpm korkeammalla aloitussykkeellä.`,
    };
  } else if (decoupling <= 5.0) {
    return {
      level: 'at',
      message: 'AeT löydetty!',
      description: `Drifti ${decoupling.toFixed(1)}% on välillä 3.5-5%. Aerobinen kynnyksesi on noin ${Math.round(avgHR)} bpm.`,
    };
  } else {
    return {
      level: 'above',
      message: 'Yli AeT:n',
      description: `Drifti ${decoupling.toFixed(1)}% on yli 5%. Aloitussyke oli liian korkea. Toista testi matalammalla sykkeellä.`,
    };
  }
}

/**
 * Filter records to a selected time range and remove pauses/stops.
 */
export function filterRecords(
  records: EnrichedRecord[],
  startSeconds?: number,
  endSeconds?: number,
  minSpeed: number = 0.5, // minimum speed to include (m/s), filters out stops
): EnrichedRecord[] {
  return records.filter(r => {
    if (startSeconds != null && r.elapsedSeconds < startSeconds) return false;
    if (endSeconds != null && r.elapsedSeconds > endSeconds) return false;
    if (r.heartRate == null || r.heartRate < 40) return false;
    if (r.speed == null || r.speed < minSpeed) return false;
    return true;
  });
}

/**
 * Calculate drift analysis for a set of enriched records.
 * Records should already be filtered to the segment of interest.
 */
export function analyzeDrift(records: EnrichedRecord[]): DriftResult {
  if (records.length < 20) {
    throw new Error('Liian vähän datapisteitä analyysiin (vähintään 20 tarvitaan)');
  }

  // Split by time into two halves
  const totalDuration = records[records.length - 1].elapsedSeconds - records[0].elapsedSeconds;
  const midTime = records[0].elapsedSeconds + totalDuration / 2;

  const firstHalf = records.filter(r => r.elapsedSeconds < midTime);
  const secondHalf = records.filter(r => r.elapsedSeconds >= midTime);

  if (firstHalf.length < 10 || secondHalf.length < 10) {
    throw new Error('Kummassakin puoliskossa tulee olla vähintään 10 datapistettä');
  }

  // Calculate averages for each half
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const firstHalfAvgHR = avg(firstHalf.map(r => r.heartRate!));
  const secondHalfAvgHR = avg(secondHalf.map(r => r.heartRate!));
  const firstHalfAvgSpeed = avg(firstHalf.filter(r => r.speed != null).map(r => r.speed!));
  const secondHalfAvgSpeed = avg(secondHalf.filter(r => r.speed != null).map(r => r.speed!));
  const firstHalfAvgGAP = avg(firstHalf.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));
  const secondHalfAvgGAP = avg(secondHalf.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));

  // Efficiency Factor: speed / HR (higher = more efficient)
  const firstHalfEF = firstHalfAvgSpeed / firstHalfAvgHR;
  const secondHalfEF = secondHalfAvgSpeed / secondHalfAvgHR;

  // GAP-based EF: gapSpeed / HR
  const firstHalfGapEF = firstHalfAvgGAP / firstHalfAvgHR;
  const secondHalfGapEF = secondHalfAvgGAP / secondHalfAvgHR;

  // Decoupling: (EF1 - EF2) / EF1 * 100
  // Positive = HR drifted up (or pace slowed) relative to first half
  const rawDecouplingPercent = ((firstHalfEF - secondHalfEF) / firstHalfEF) * 100;
  const gapDecouplingPercent = ((firstHalfGapEF - secondHalfGapEF) / firstHalfGapEF) * 100;

  // Use GAP-compensated as the primary metric
  const decouplingPercent = gapDecouplingPercent;

  const avgHR = (firstHalfAvgHR + secondHalfAvgHR) / 2;
  const interpretation = interpret(decouplingPercent, firstHalfAvgHR);

  // Suggest AeT based on first half HR if drift is in the right range
  let suggestedAeT: number | null = null;
  if (decouplingPercent >= 3.5 && decouplingPercent <= 5.0) {
    suggestedAeT = Math.round(firstHalfAvgHR);
  }

  return {
    decouplingPercent,
    firstHalfAvgHR,
    secondHalfAvgHR,
    firstHalfAvgSpeed,
    secondHalfAvgSpeed,
    firstHalfAvgGAP,
    secondHalfAvgGAP,
    firstHalfEF,
    secondHalfEF,
    firstHalfGapEF,
    secondHalfGapEF,
    rawDecouplingPercent,
    gapDecouplingPercent,
    analyzedDuration: totalDuration,
    interpretation,
    suggestedAeT,
  };
}

/**
 * Create rolling segment analysis for visualization.
 * Divides the activity into N equal time segments.
 */
export function segmentAnalysis(records: EnrichedRecord[], numSegments: number = 10): SegmentDrift[] {
  if (records.length < numSegments) return [];

  const totalDuration = records[records.length - 1].elapsedSeconds - records[0].elapsedSeconds;
  const segmentDuration = totalDuration / numSegments;
  const startTime = records[0].elapsedSeconds;

  const segments: SegmentDrift[] = [];
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  for (let i = 0; i < numSegments; i++) {
    const segStart = startTime + i * segmentDuration;
    const segEnd = segStart + segmentDuration;

    const segRecords = records.filter(r =>
      r.elapsedSeconds >= segStart && r.elapsedSeconds < segEnd
    );

    if (segRecords.length === 0) continue;

    const avgHR = avg(segRecords.filter(r => r.heartRate != null).map(r => r.heartRate!));
    const avgSpeed = avg(segRecords.filter(r => r.speed != null).map(r => r.speed!));
    const avgGAP = avg(segRecords.filter(r => r.gapSpeed != null).map(r => r.gapSpeed!));

    segments.push({
      startSeconds: segStart,
      endSeconds: segEnd,
      avgHR,
      avgSpeed,
      avgGAP,
      ef: avgHR > 0 ? avgSpeed / avgHR : 0,
      gapEf: avgHR > 0 ? avgGAP / avgHR : 0,
    });
  }

  return segments;
}

/**
 * Format speed (m/s) to pace (min:sec/km).
 */
export function speedToPace(speedMs: number): string {
  if (speedMs <= 0) return '--:--';
  const paceSecsPerKm = 1000 / speedMs;
  const mins = Math.floor(paceSecsPerKm / 60);
  const secs = Math.round(paceSecsPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to mm:ss or hh:mm:ss.
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
