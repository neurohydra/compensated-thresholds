import type { EnrichedRecord } from './gapCalculator';

/**
 * Data quality assessment for a set of enriched records.
 */
export interface DataQualityReport {
  /** Overall quality score 0-100 */
  score: number;
  /** Quality level */
  level: 'good' | 'acceptable' | 'poor';
  /** Individual checks */
  checks: QualityCheck[];
  /** Cleaned records (outliers removed) */
  cleanedRecords: EnrichedRecord[];
  /** Number of records removed */
  removedCount: number;
  /** Specific issues found (i18n key + params) */
  issues: Array<{ key: string; params?: Record<string, string | number> }>;
}

export interface QualityCheck {
  nameKey: string;
  passed: boolean;
  score: number; // 0-100
  detailKey: string;
  detailParams?: Record<string, string | number>;
}

/**
 * Run data quality analysis on enriched records.
 * Detects and optionally removes outliers, checks for GPS issues, HR gaps, etc.
 */
export function assessDataQuality(records: EnrichedRecord[]): DataQualityReport {
  const checks: QualityCheck[] = [];
  const issues: Array<{ key: string; params?: Record<string, string | number> }> = [];
  let cleanedRecords = [...records];
  let removedCount = 0;

  // 1. HR data completeness
  const hrCount = records.filter(r => r.heartRate != null && r.heartRate > 0).length;
  const hrCompleteness = records.length > 0 ? hrCount / records.length : 0;
  checks.push({
    nameKey: 'quality.check.hrCompleteness.name',
    passed: hrCompleteness > 0.9,
    score: Math.round(hrCompleteness * 100),
    detailKey: 'quality.check.hrCompleteness.detail',
    detailParams: { percent: Math.round(hrCompleteness * 100), count: hrCount, total: records.length },
  });
  if (hrCompleteness < 0.9) {
    issues.push({ key: 'quality.issue.hrMissing', params: { percent: Math.round((1 - hrCompleteness) * 100) } });
  }

  // 2. HR plausibility — detect impossible values
  const hrValues = records.filter(r => r.heartRate != null).map(r => r.heartRate!);
  const implausibleHR = hrValues.filter(hr => hr < 30 || hr > 220);
  const hrPlausibility = hrValues.length > 0 ? 1 - implausibleHR.length / hrValues.length : 0;
  checks.push({
    nameKey: 'quality.check.hrPlausibility.name',
    passed: implausibleHR.length === 0,
    score: Math.round(hrPlausibility * 100),
    detailKey: implausibleHR.length === 0
      ? 'quality.check.hrPlausibility.pass'
      : 'quality.check.hrPlausibility.fail',
    detailParams: implausibleHR.length > 0 ? { count: implausibleHR.length } : undefined,
  });

  // 3. HR spike detection (sudden jumps > 20 bpm between consecutive readings)
  let hrSpikes = 0;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].heartRate;
    const curr = records[i].heartRate;
    if (prev != null && curr != null) {
      const dt = records[i].elapsedSeconds - records[i - 1].elapsedSeconds;
      if (dt > 0 && dt < 5 && Math.abs(curr - prev) > 20) {
        hrSpikes++;
      }
    }
  }
  const hrSpikeRate = records.length > 1 ? hrSpikes / (records.length - 1) : 0;
  checks.push({
    nameKey: 'quality.check.hrSpikes.name',
    passed: hrSpikeRate < 0.01,
    score: Math.round((1 - Math.min(hrSpikeRate * 10, 1)) * 100),
    detailKey: hrSpikes === 0 ? 'quality.check.hrSpikes.pass' : 'quality.check.hrSpikes.fail',
    detailParams: hrSpikes > 0 ? { count: hrSpikes } : undefined,
  });
  if (hrSpikes > 5) {
    issues.push({ key: 'quality.issue.hrSpikes', params: { count: hrSpikes } });
  }

  // 4. Speed data quality
  const speedValues = records.filter(r => r.speed != null).map(r => r.speed!);
  const implausibleSpeed = speedValues.filter(s => s > 8.0); // > 8 m/s = 2:05/km, impossible for aerobic
  const speedQuality = speedValues.length > 0 ? 1 - implausibleSpeed.length / speedValues.length : 0;
  checks.push({
    nameKey: 'quality.check.speed.name',
    passed: implausibleSpeed.length === 0,
    score: Math.round(speedQuality * 100),
    detailKey: implausibleSpeed.length === 0
      ? 'quality.check.speed.pass'
      : 'quality.check.speed.fail',
    detailParams: implausibleSpeed.length > 0 ? { count: implausibleSpeed.length } : undefined,
  });

  // 5. GPS altitude quality (excessive altitude changes)
  const altChanges: number[] = [];
  for (let i = 1; i < records.length; i++) {
    const prevAlt = records[i - 1].smoothedAltitude;
    const currAlt = records[i].smoothedAltitude;
    if (prevAlt != null && currAlt != null) {
      altChanges.push(Math.abs(currAlt - prevAlt));
    }
  }
  const bigAltJumps = altChanges.filter(c => c > 10).length; // > 10m per second is GPS noise
  const altQuality = altChanges.length > 0 ? 1 - Math.min(bigAltJumps / altChanges.length * 20, 1) : 0.5;
  checks.push({
    nameKey: 'quality.check.gpsAlt.name',
    passed: bigAltJumps < 5,
    score: Math.round(altQuality * 100),
    detailKey: bigAltJumps === 0 ? 'quality.check.gpsAlt.pass' : 'quality.check.gpsAlt.fail',
    detailParams: bigAltJumps > 0 ? { count: bigAltJumps } : undefined,
  });
  if (bigAltJumps > 10) {
    issues.push({ key: 'quality.issue.gpsNoise' });
  }

  // 6. Data sampling rate consistency
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(records.length, 500); i++) {
    intervals.push(records[i].elapsedSeconds - records[i - 1].elapsedSeconds);
  }
  const avgInterval = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 1;
  const gapCount = intervals.filter(i => i > avgInterval * 5).length;
  const samplingQuality = intervals.length > 0 ? 1 - Math.min(gapCount / intervals.length * 10, 1) : 0.5;
  checks.push({
    nameKey: 'quality.check.sampling.name',
    passed: gapCount < 3,
    score: Math.round(samplingQuality * 100),
    detailKey: 'quality.check.sampling.detail',
    detailParams: { interval: avgInterval.toFixed(1), gaps: gapCount },
  });
  if (gapCount > 5) {
    issues.push({ key: 'quality.issue.dataGaps' });
  }

  // 7. Terrain balance: check that first and second half have similar elevation profiles
  const midIdx = Math.floor(records.length / 2);
  const firstHalfGrades = records.slice(0, midIdx).filter(r => r.grade != null).map(r => r.grade);
  const secondHalfGrades = records.slice(midIdx).filter(r => r.grade != null).map(r => r.grade);

  if (firstHalfGrades.length > 10 && secondHalfGrades.length > 10) {
    const firstAvgGrade = firstHalfGrades.reduce((a, b) => a + b, 0) / firstHalfGrades.length;
    const secondAvgGrade = secondHalfGrades.reduce((a, b) => a + b, 0) / secondHalfGrades.length;
    const gradeImbalance = Math.abs(firstAvgGrade - secondAvgGrade) * 100; // percentage points

    const terrainScore = Math.round(Math.max(0, 100 - gradeImbalance * 20));
    checks.push({
      nameKey: 'quality.check.terrain.name',
      passed: gradeImbalance < 2,
      score: terrainScore,
      detailKey: 'quality.check.terrain.detail',
      detailParams: {
        first: (firstAvgGrade * 100).toFixed(1),
        second: (secondAvgGrade * 100).toFixed(1),
        diff: gradeImbalance.toFixed(1),
      },
    });
    if (gradeImbalance > 3) {
      issues.push({ key: 'quality.issue.terrainImbalance' });
    }
  }

  // Clean outlier records
  const beforeCount = cleanedRecords.length;
  cleanedRecords = cleanedRecords.filter(r => {
    if (r.heartRate != null && (r.heartRate < 30 || r.heartRate > 220)) return false;
    if (r.speed != null && r.speed > 8.0) return false;
    return true;
  });
  removedCount = beforeCount - cleanedRecords.length;

  // Overall score (weighted average of checks)
  const totalScore = checks.length > 0
    ? Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length)
    : 50;

  const level = totalScore >= 80 ? 'good' : totalScore >= 50 ? 'acceptable' : 'poor';

  return {
    score: totalScore,
    level,
    checks,
    cleanedRecords,
    removedCount,
    issues,
  };
}
