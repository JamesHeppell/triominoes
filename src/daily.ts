export type Difficulty = "easy" | "medium" | "hard";

// ─── UTC date helpers ─────────────────────────────────────────────────────────

/** Returns today's UTC date string, e.g. "2026-02-22". */
export function getUtcDateKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Milliseconds until next UTC midnight. */
export function msUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────

/** Returns a function that produces pseudo-random values in [0, 1). */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed for a given UTC date + difficulty. */
export function dailySeed(dateKey: string, difficulty: Difficulty): number {
  const n = parseInt(dateKey.replace(/-/g, ""), 10);
  const d: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
  return ((n * 10 + d[difficulty]) >>> 0);
}

// ─── Completion state (localStorage) ─────────────────────────────────────────

const STORAGE_KEY = "triominoes-daily-v1";

/**
 * Per-difficulty entry: `true` = completed (legacy, no time recorded);
 * `number` = completed, value is solve time in milliseconds.
 */
type DifficultyEntry = boolean | number;
type CompletionRecord = Record<string, Partial<Record<Difficulty, DifficultyEntry>>>;

function loadRecord(): CompletionRecord {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as CompletionRecord;
  } catch {
    return {};
  }
}

function saveRecord(record: CompletionRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function isDailyComplete(dateKey: string, difficulty: Difficulty): boolean {
  const val = loadRecord()[dateKey]?.[difficulty];
  return val === true || typeof val === "number";
}

/** Returns the stored solve time in ms, or null if not recorded. */
export function getDailySolveTime(dateKey: string, difficulty: Difficulty): number | null {
  const val = loadRecord()[dateKey]?.[difficulty];
  return typeof val === "number" ? val : null;
}

export function markDailyComplete(dateKey: string, difficulty: Difficulty, solveTimeMs?: number): void {
  const record = loadRecord();
  if (!record[dateKey]) record[dateKey] = {};
  record[dateKey][difficulty] = solveTimeMs !== undefined ? solveTimeMs : true;
  saveRecord(record);
}

export function resetDailyProgress(dateKey: string): void {
  const record = loadRecord();
  delete record[dateKey];
  saveRecord(record);
}
