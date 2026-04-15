import { Decoder, Stream } from '@garmin/fitsdk';

export interface ActivityRecord {
  timestamp: Date;
  heartRate: number | null;
  speed: number | null;       // m/s
  altitude: number | null;    // meters
  lat: number | null;         // degrees
  lng: number | null;         // degrees
  distance: number | null;    // meters
  cadence: number | null;
  temperature: number | null; // °C
  power: number | null;       // watts (running power if available)
}

/**
 * A single RR interval (beat-to-beat interval).
 */
export interface RRInterval {
  /** Time in ms since activity start */
  timestampMs: number;
  /** RR interval duration in milliseconds */
  rrMs: number;
  /** Quality: 1 = high confidence, 0 = low (from rawBbi), null = unknown */
  quality: number | null;
  /** Whether this is a gap (no real data) */
  isGap: boolean;
}

export interface ActivitySummary {
  name: string;
  sport: string;
  startTime: Date;
  totalDistance: number;      // meters
  totalDuration: number;     // seconds
  avgHeartRate: number;
  records: ActivityRecord[];
  /** RR intervals (beat-to-beat) for HRV/DFA analysis */
  rrIntervals: RRInterval[];
  /** Whether HRV data is available */
  hasHRV: boolean;
  /** Whether temperature data is available */
  hasTemperature: boolean;
  /** Whether power data is available */
  hasPower: boolean;
  /** Average temperature during activity (°C) */
  avgTemperature: number | null;
}

const SEMICIRCLE_TO_DEG = 180 / Math.pow(2, 31);

export function parseFitFile(arrayBuffer: ArrayBuffer): ActivitySummary {
  const stream = Stream.fromArrayBuffer(arrayBuffer);
  const decoder = new Decoder(stream);

  if (!decoder.isFIT()) {
    throw new Error('Tiedosto ei ole validi FIT-tiedosto');
  }

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  });

  if (errors.length > 0) {
    console.warn('FIT parsing warnings:', errors);
  }

  const recordMsgs = messages.recordMesgs || [];
  const sessionMsgs = messages.sessionMesgs || [];

  if (recordMsgs.length === 0) {
    throw new Error('FIT-tiedostossa ei ole tallennettuja datapisteitä');
  }

  const records: ActivityRecord[] = recordMsgs
    .map((r: Record<string, unknown>) => ({
      timestamp: r.timestamp as Date,
      heartRate: (r.heartRate as number) ?? null,
      speed: (r.enhancedSpeed as number) ?? (r.speed as number) ?? null,
      altitude: (r.enhancedAltitude as number) ?? (r.altitude as number) ?? null,
      lat: r.positionLat != null ? (r.positionLat as number) * SEMICIRCLE_TO_DEG : null,
      lng: r.positionLong != null ? (r.positionLong as number) * SEMICIRCLE_TO_DEG : null,
      distance: (r.distance as number) ?? null,
      cadence: (r.cadence as number) ?? null,
      temperature: (r.temperature as number) ?? null,
      power: (r.enhancedPower as number) ?? (r.power as number) ?? null,
    }))
    .filter((r: ActivityRecord) => r.timestamp != null);

  const session = sessionMsgs[0] as Record<string, unknown> | undefined;

  const startTime = records[0].timestamp;
  const endTime = records[records.length - 1].timestamp;
  const totalDuration = (endTime.getTime() - startTime.getTime()) / 1000;
  const startTimeMs = startTime.getTime();

  // Heart rate stats
  const validHr = records.filter(r => r.heartRate != null);
  const avgHeartRate = validHr.length > 0
    ? validHr.reduce((sum, r) => sum + r.heartRate!, 0) / validHr.length
    : 0;

  // Temperature stats
  const tempRecords = records.filter(r => r.temperature != null);
  const hasTemperature = tempRecords.length > 0;
  const avgTemperature = hasTemperature
    ? tempRecords.reduce((sum, r) => sum + r.temperature!, 0) / tempRecords.length
    : null;

  // Power stats
  const hasPower = records.some(r => r.power != null && r.power > 0);

  // Distance
  const lastDistance = records.filter(r => r.distance != null).pop();
  const totalDistance = lastDistance?.distance ?? 0;

  // Extract RR intervals from HRV data
  const rrIntervals = extractRRIntervals(messages, startTimeMs);

  return {
    name: (session?.sport as string) ?? 'Tuntematon',
    sport: (session?.sport as string) ?? 'running',
    startTime,
    totalDistance,
    totalDuration,
    avgHeartRate: Math.round(avgHeartRate),
    records,
    rrIntervals,
    hasHRV: rrIntervals.length > 0,
    hasTemperature,
    hasPower,
    avgTemperature,
  };
}

/**
 * Extract RR intervals from FIT HRV messages.
 * Tries rawBbi first (best quality flags), then hrvMesgs, then beatIntervalsMesgs.
 */
function extractRRIntervals(
  messages: Record<string, any>,
  startTimeMs: number,
): RRInterval[] {
  // Strategy 1: rawBbiMesgs (message 372) — best quality, has quality/gap flags
  const rawBbiMesgs = messages.rawBbiMesgs as any[] | undefined;
  if (rawBbiMesgs && rawBbiMesgs.length > 0) {
    return extractFromRawBbi(rawBbiMesgs, startTimeMs);
  }

  // Strategy 2: hrvMesgs (message 78) — most common during activities
  const hrvMesgs = messages.hrvMesgs as any[] | undefined;
  if (hrvMesgs && hrvMesgs.length > 0) {
    return extractFromHrv(hrvMesgs, startTimeMs);
  }

  // Strategy 3: beatIntervalsMesgs (message 290)
  const beatMesgs = messages.beatIntervalsMesgs as any[] | undefined;
  if (beatMesgs && beatMesgs.length > 0) {
    return extractFromBeatIntervals(beatMesgs, startTimeMs);
  }

  return [];
}

function extractFromRawBbi(mesgs: any[], startTimeMs: number): RRInterval[] {
  const intervals: RRInterval[] = [];
  let cumulativeMs = 0;

  for (const msg of mesgs) {
    const times = msg.time as number[] | undefined;
    const qualities = msg.quality as number[] | undefined;
    const gaps = msg.gap as number[] | undefined;

    if (!times) continue;

    // Calculate base timestamp for this message
    const msgTimestamp = msg.timestamp as Date | undefined;
    const msgTimestampMs = msg.timestampMs as number | undefined;
    let baseMs = msgTimestamp
      ? msgTimestamp.getTime() - startTimeMs + (msgTimestampMs ?? 0)
      : cumulativeMs;

    for (let i = 0; i < times.length; i++) {
      const rrMs = times[i];
      if (rrMs == null || rrMs <= 0) continue;

      const quality = qualities ? (qualities[i] ?? null) : null;
      const isGap = gaps ? (gaps[i] === 1) : false;

      intervals.push({
        timestampMs: baseMs,
        rrMs,
        quality,
        isGap,
      });

      baseMs += rrMs;
      cumulativeMs = baseMs;
    }
  }

  return intervals;
}

function extractFromHrv(mesgs: any[], _startTimeMs: number): RRInterval[] {
  const intervals: RRInterval[] = [];
  let cumulativeMs = 0;

  for (const msg of mesgs) {
    const times = msg.time as number[] | undefined;
    if (!times) continue;

    for (const val of times) {
      if (val == null || val <= 0) continue;

      // hrvMesgs time field has scale 1000, so SDK gives seconds
      // Convert to milliseconds
      const rrMs = val * 1000;

      intervals.push({
        timestampMs: cumulativeMs,
        rrMs,
        quality: null,
        isGap: false,
      });

      cumulativeMs += rrMs;
    }
  }

  return intervals;
}

function extractFromBeatIntervals(mesgs: any[], startTimeMs: number): RRInterval[] {
  const intervals: RRInterval[] = [];

  for (const msg of mesgs) {
    const times = msg.time as number[] | undefined;
    const timestamp = msg.timestamp as Date | undefined;
    const timestampMs = msg.timestampMs as number | undefined;

    if (!times) continue;

    let baseMs = timestamp
      ? timestamp.getTime() - startTimeMs + (timestampMs ?? 0)
      : 0;

    for (const rrMs of times) {
      if (rrMs == null || rrMs <= 0) continue;

      intervals.push({
        timestampMs: baseMs,
        rrMs,
        quality: null,
        isGap: false,
      });

      baseMs += rrMs;
    }
  }

  return intervals;
}
