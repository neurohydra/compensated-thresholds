/**
 * Temperature compensation for heart rate drift analysis.
 *
 * Cardiovascular drift is significantly affected by ambient temperature.
 * In warm conditions, core temperature rises → plasma volume drops →
 * stroke volume decreases → HR increases to maintain cardiac output.
 *
 * This module estimates the temperature-induced HR drift component
 * and subtracts it from the total drift to isolate the metabolic drift.
 *
 * References:
 * - Coyle & González-Alonso (2001): Cardiovascular drift during prolonged exercise
 * - Wingo et al. (2012): HR drift in warm vs. cool conditions
 * - General guideline: ~2-3% additional drift per 5°C above 15°C
 */

export interface TemperatureCompensation {
  /** Average temperature during the activity (°C) */
  avgTemp: number;
  /** Temperature in first half (°C) */
  firstHalfTemp: number;
  /** Temperature in second half (°C) */
  secondHalfTemp: number;
  /** Estimated temperature-induced drift component (%) */
  tempDriftComponent: number;
  /** Compensated (metabolic-only) drift (%) */
  compensatedDrift: number;
  /** Raw (uncompensated) drift (%) */
  rawDrift: number;
  /** Whether compensation was applied */
  applied: boolean;
  /** Explanation */
  explanation: string;
  /** Risk level for heat-affected results */
  heatRisk: 'none' | 'low' | 'moderate' | 'high';
}

/**
 * Reference temperature where cardiovascular drift is minimal.
 * Below this, no significant heat-related drift compensation needed.
 */
const REFERENCE_TEMP = 15; // °C

/**
 * Drift increase per degree above reference.
 * Based on research: ~0.4-0.6% additional drift per °C above 15°C
 * for a 40-60 minute effort. We use 0.5% as a conservative middle estimate.
 */
const DRIFT_PER_DEGREE = 0.5; // % per °C

/**
 * Minimum temperature for compensation to be meaningful.
 * Below -10°C, cold stress actually increases HR drift too.
 */
const COLD_THRESHOLD = -5; // °C
const COLD_DRIFT_PER_DEGREE = 0.2; // % per °C below threshold

/**
 * Calculate temperature-compensated drift.
 */
export function compensateForTemperature(
  rawDriftPercent: number,
  temperatures: (number | null)[],
  durationMinutes: number,
): TemperatureCompensation {
  const validTemps = temperatures.filter((t): t is number => t != null);

  if (validTemps.length === 0) {
    return {
      avgTemp: 0,
      firstHalfTemp: 0,
      secondHalfTemp: 0,
      tempDriftComponent: 0,
      compensatedDrift: rawDriftPercent,
      rawDrift: rawDriftPercent,
      applied: false,
      explanation: 'Lämpötiladataa ei saatavilla — kompensaatiota ei voitu tehdä.',
      heatRisk: 'none',
    };
  }

  const mid = Math.floor(validTemps.length / 2);
  const firstHalfTemp = mean(validTemps.slice(0, mid));
  const secondHalfTemp = mean(validTemps.slice(mid));
  const avgTemp = mean(validTemps);

  // Calculate temperature-induced drift component
  let tempDriftComponent = 0;
  let heatRisk: TemperatureCompensation['heatRisk'] = 'none';
  const explanationParts: string[] = [];

  if (avgTemp > REFERENCE_TEMP) {
    const degreesAbove = avgTemp - REFERENCE_TEMP;
    // Duration factor: longer duration = more heat accumulation
    // Base is 45 min, scale linearly
    const durationFactor = Math.min(durationMinutes / 45, 2.0);
    tempDriftComponent = degreesAbove * DRIFT_PER_DEGREE * durationFactor;

    if (degreesAbove > 15) {
      heatRisk = 'high';
      explanationParts.push(`Korkea lämpötila (${avgTemp.toFixed(0)}°C) — merkittävä vaikutus driftiin.`);
    } else if (degreesAbove > 8) {
      heatRisk = 'moderate';
      explanationParts.push(`Lämmin (${avgTemp.toFixed(0)}°C) — kohtalainen vaikutus driftiin.`);
    } else if (degreesAbove > 3) {
      heatRisk = 'low';
      explanationParts.push(`Leuto (${avgTemp.toFixed(0)}°C) — vähäinen lämpövaikutus.`);
    }
  } else if (avgTemp < COLD_THRESHOLD) {
    const degreesBelow = COLD_THRESHOLD - avgTemp;
    tempDriftComponent = degreesBelow * COLD_DRIFT_PER_DEGREE;
    heatRisk = 'low';
    explanationParts.push(`Kylmä (${avgTemp.toFixed(0)}°C) — kylmästressi voi nostaa sykettä.`);
  }

  // Also check for temperature increase during the run (body heat building up)
  const tempIncrease = secondHalfTemp - firstHalfTemp;
  if (tempIncrease > 3) {
    tempDriftComponent += tempIncrease * 0.3;
    explanationParts.push(`Lämpötila nousi ${tempIncrease.toFixed(1)}°C suorituksen aikana.`);
  }

  const compensatedDrift = rawDriftPercent - tempDriftComponent;

  if (tempDriftComponent > 0) {
    explanationParts.push(
      `Arvioitu lämpötilavaikutus: ${tempDriftComponent.toFixed(1)}%-yksikköä. ` +
      `Kompensoitu drifti: ${compensatedDrift.toFixed(1)}% (raaka: ${rawDriftPercent.toFixed(1)}%).`
    );
  } else {
    explanationParts.push(
      `Lämpötila (${avgTemp.toFixed(0)}°C) on viileä — ei merkittävää lämpökompensaatiota.`
    );
  }

  return {
    avgTemp,
    firstHalfTemp,
    secondHalfTemp,
    tempDriftComponent,
    compensatedDrift: Math.max(0, compensatedDrift),
    rawDrift: rawDriftPercent,
    applied: tempDriftComponent > 0.5,
    explanation: explanationParts.join(' '),
    heatRisk,
  };
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
