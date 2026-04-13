/**
 * Persistent storage for threshold analysis results.
 * Uses localStorage to track AeT/LT over time.
 */

export interface HistoryEntry {
  id: string;
  /** Date of the activity */
  date: string; // ISO string
  /** File name */
  fileName: string;
  /** Analysis method used */
  method: 'drift' | 'dfa-alpha1' | 'multi-file' | 'combined';
  /** Estimated AeT heart rate */
  aetHR: number | null;
  /** Estimated LT2/AnT heart rate (from DFA alpha1 = 0.50) */
  ltHR: number | null;
  /** Drift percentage */
  driftPercent: number | null;
  /** DFA alpha1 value at test HR (if available) */
  dfaAlpha1: number | null;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Average temperature during the activity */
  temperature: number | null;
  /** GAP model used */
  gapModel: string;
  /** Average pace */
  avgPace: string;
  /** Notes from user */
  notes: string;
  /** Timestamp when this entry was created */
  createdAt: string;
}

export interface HistoryStats {
  /** All entries sorted by date */
  entries: HistoryEntry[];
  /** Latest AeT estimate */
  latestAeT: number | null;
  /** AeT trend (positive = improving) */
  aetTrend: number | null;
  /** Latest LT2 estimate */
  latestLT: number | null;
  /** AeT/LT ratio (should be ~0.75-0.85 for well-trained) */
  aetLtRatio: number | null;
  /** Number of analyses done */
  totalAnalyses: number;
  /** Date range */
  firstDate: string | null;
  lastDate: string | null;
}

const STORAGE_KEY = 'compensated-thresholds-history';

/**
 * Load history from localStorage.
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as HistoryEntry[];
    return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } catch {
    return [];
  }
}

/**
 * Save a new entry to history.
 */
export function saveToHistory(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): HistoryEntry {
  const entries = loadHistory();

  const newEntry: HistoryEntry = {
    ...entry,
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  entries.push(newEntry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));

  return newEntry;
}

/**
 * Remove an entry from history.
 */
export function removeFromHistory(id: string): void {
  const entries = loadHistory().filter(e => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Update notes for an entry.
 */
export function updateEntryNotes(id: string, notes: string): void {
  const entries = loadHistory();
  const entry = entries.find(e => e.id === id);
  if (entry) {
    entry.notes = notes;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }
}

/**
 * Calculate statistics from history.
 */
export function getHistoryStats(): HistoryStats {
  const entries = loadHistory();

  if (entries.length === 0) {
    return {
      entries,
      latestAeT: null,
      aetTrend: null,
      latestLT: null,
      aetLtRatio: null,
      totalAnalyses: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  // Latest estimates (prefer high confidence)
  const aetEntries = entries.filter(e => e.aetHR != null).reverse();
  const latestAeT = aetEntries.length > 0 ? aetEntries[0].aetHR : null;

  const ltEntries = entries.filter(e => e.ltHR != null).reverse();
  const latestLT = ltEntries.length > 0 ? ltEntries[0].ltHR : null;

  // AeT trend (simple linear regression over last 6 entries)
  let aetTrend: number | null = null;
  if (aetEntries.length >= 3) {
    const recent = aetEntries.slice(0, 6).reverse(); // oldest first
    const x = recent.map((_, i) => i);
    const y = recent.map(e => e.aetHR!);
    aetTrend = linearSlope(x, y); // bpm per analysis
  }

  // AeT/LT ratio
  const aetLtRatio = latestAeT != null && latestLT != null && latestLT > 0
    ? latestAeT / latestLT
    : null;

  return {
    entries,
    latestAeT,
    aetTrend,
    latestLT,
    aetLtRatio,
    totalAnalyses: entries.length,
    firstDate: entries[0].date,
    lastDate: entries[entries.length - 1].date,
  };
}

/**
 * Export history as JSON.
 */
export function exportHistory(): string {
  return JSON.stringify(loadHistory(), null, 2);
}

/**
 * Import history from JSON.
 */
export function importHistory(json: string): number {
  try {
    const imported = JSON.parse(json) as HistoryEntry[];
    if (!Array.isArray(imported)) throw new Error('Invalid format');

    const existing = loadHistory();
    const existingIds = new Set(existing.map(e => e.id));
    const newEntries = imported.filter(e => !existingIds.has(e.id));

    const merged = [...existing, ...newEntries];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

    return newEntries.length;
  } catch {
    throw new Error('Virheellinen historia-tiedosto');
  }
}

function linearSlope(x: number[], y: number[]): number {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
