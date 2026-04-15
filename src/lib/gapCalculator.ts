import type { ActivityRecord } from './fitParser';

/**
 * Grade Adjusted Pace (GAP) calculation.
 *
 * Uses Strava's improved model (2017) which is based on real-world HR data
 * rather than lab-only measurements. Better for typical runners than Minetti.
 *
 * Strava relative cost: cost(i) = 1 + 15.14*i^2 - 2.896*i
 * where i is the fractional grade (0.01 = 1%)
 *
 * GAP speed = actual_speed / relative_cost(grade)
 * This gives the equivalent flat-ground speed for the same effort.
 */

function stravaCostFactor(grade: number): number {
  // Clamp grade to reasonable range (-0.5 to 0.5)
  const g = Math.max(-0.5, Math.min(0.5, grade));
  // Strava model: relative metabolic cost compared to flat
  const cost = 1 + 15.14 * g * g - 2.896 * g;
  // Minimum cost factor to avoid division issues
  return Math.max(0.5, cost);
}

/**
 * Minetti (2002) cost of transport model.
 * Returns metabolic cost in J/kg/m.
 * C(i) = 155.4i^5 - 30.4i^4 - 43.3i^3 + 46.3i^2 + 20.2i + 3.6
 * Relative cost = C(i) / C(0) where C(0) = 3.6
 */
function minettiCostFactor(grade: number): number {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  const cost = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 20.2 * g + 3.6;
  const flatCost = 3.6;
  return Math.max(0.5, cost / flatCost);
}

export type GapModel = 'strava' | 'minetti';

export interface EnrichedRecord extends ActivityRecord {
  grade: number;            // fractional grade (0.01 = 1%)
  gapSpeed: number | null;  // grade-adjusted speed in m/s
  costFactor: number;       // metabolic cost multiplier vs flat
  smoothedAltitude: number | null;
  elapsedSeconds: number;
}


/**
 * Smooth altitude data using a moving average to reduce GPS noise.
 */
function smoothAltitudes(records: ActivityRecord[], windowSize: number = 10): (number | null)[] {
  const altitudes = records.map(r => r.altitude);
  const smoothed: (number | null)[] = [];

  for (let i = 0; i < altitudes.length; i++) {
    if (altitudes[i] == null) {
      smoothed.push(null);
      continue;
    }

    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(altitudes.length - 1, i + half);
    let sum = 0;
    let count = 0;

    for (let j = start; j <= end; j++) {
      if (altitudes[j] != null) {
        sum += altitudes[j]!;
        count++;
      }
    }

    smoothed.push(count > 0 ? sum / count : null);
  }

  return smoothed;
}

/**
 * Calculate grades from smoothed altitude data.
 */
function calculateSmoothedGrades(records: ActivityRecord[], smoothedAlt: (number | null)[]): number[] {
  const grades: number[] = [0];

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];

    if (smoothedAlt[i - 1] != null && smoothedAlt[i] != null && prev.distance != null && curr.distance != null) {
      const dDist = curr.distance - prev.distance;
      const dAlt = smoothedAlt[i]! - smoothedAlt[i - 1]!;

      if (dDist > 0.5) {
        const horizontal = Math.sqrt(Math.max(0, dDist * dDist - dAlt * dAlt));
        grades.push(horizontal > 0.1 ? dAlt / horizontal : 0);
      } else {
        grades.push(grades[grades.length - 1] || 0);
      }
    } else {
      grades.push(0);
    }
  }

  return grades;
}

/**
 * Smooth grades using a moving average window (e.g. 30 seconds).
 */
function smoothGrades(grades: number[], windowSize: number = 15): number[] {
  const smoothed: number[] = [];
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < grades.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(grades.length - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += grades[j];
    }
    smoothed.push(sum / (end - start + 1));
  }

  return smoothed;
}

/**
 * Enrich activity records with grade-adjusted pace data.
 */
export function enrichRecords(
  records: ActivityRecord[],
  model: GapModel = 'strava',
  altitudeSmoothWindow: number = 10,
  gradeSmoothWindow: number = 15,
): EnrichedRecord[] {
  if (records.length === 0) return [];

  const costFn = model === 'strava' ? stravaCostFactor : minettiCostFactor;

  // Smooth altitudes first, then compute grades from smoothed data
  const smoothedAlt = smoothAltitudes(records, altitudeSmoothWindow);
  const rawGrades = calculateSmoothedGrades(records, smoothedAlt);
  const grades = smoothGrades(rawGrades, gradeSmoothWindow);

  const startTime = records[0].timestamp.getTime();

  return records.map((r, i) => {
    const grade = grades[i];
    const cost = costFn(grade);
    const gapSpeed = r.speed != null ? r.speed * cost : null;

    return {
      ...r,
      grade,
      gapSpeed,
      costFactor: cost,
      smoothedAltitude: smoothedAlt[i],
      elapsedSeconds: (r.timestamp.getTime() - startTime) / 1000,
    };
  });
}

/**
 * Get cost factor for a given grade (for display/explanation).
 */
export function getCostFactor(grade: number, model: GapModel = 'strava'): number {
  return model === 'strava' ? stravaCostFactor(grade) : minettiCostFactor(grade);
}
