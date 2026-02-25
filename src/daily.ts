export type Difficulty = "easy" | "medium" | "hard";

/** Set to true locally to enable dev features (reset button, skip adjacency). Never commit as true. */
export const DEV_MODE = false;

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

const DEV_OFFSET_KEY = "triominoes-dev-offset";

export function getDevOffset(): number {
  return DEV_MODE ? parseInt(localStorage.getItem(DEV_OFFSET_KEY) ?? "0", 10) : 0;
}

export function incrementDevOffset(): void {
  if (!DEV_MODE) return;
  localStorage.setItem(DEV_OFFSET_KEY, String(getDevOffset() + 1));
}

/** Deterministic seed for a given UTC date + difficulty. */
export function dailySeed(dateKey: string, difficulty: Difficulty): number {
  const n = parseInt(dateKey.replace(/-/g, ""), 10);
  const d: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
  return ((n * 10 + d[difficulty] + getDevOffset() * 1000) >>> 0);
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

// ─── Streak tracking ──────────────────────────────────────────────────────────

const STREAK_KEY = "triominoes-streak-v1";
type StreakData = { streak: number; lastDate: string };

function loadStreakData(): StreakData {
  try {
    return JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") ?? { streak: 0, lastDate: "" };
  } catch {
    return { streak: 0, lastDate: "" };
  }
}

/** Returns the current streak and whether the player has completed a puzzle today. */
export function getStreakData(): { streak: number; completedToday: boolean } {
  const { streak, lastDate } = loadStreakData();
  return { streak, completedToday: lastDate === getUtcDateKey() };
}

/** Wipes the stored streak entirely (dev reset only). */
export function resetStreak(): void {
  localStorage.removeItem(STREAK_KEY);
}

function updateStreak(dateKey: string): void {
  const { streak, lastDate } = loadStreakData();
  if (lastDate === dateKey) return; // already counted today

  const [y, m, d] = dateKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yesterdayKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;

  const newStreak = lastDate === yesterdayKey ? streak + 1 : 1;
  localStorage.setItem(STREAK_KEY, JSON.stringify({ streak: newStreak, lastDate: dateKey }));
}

export function markDailyComplete(dateKey: string, difficulty: Difficulty, solveTimeMs?: number): void {
  const record = loadRecord();
  if (!record[dateKey]) record[dateKey] = {};
  record[dateKey][difficulty] = solveTimeMs !== undefined ? solveTimeMs : true;
  saveRecord(record);
  updateStreak(dateKey);
}

export function resetDailyProgress(dateKey: string): void {
  const record = loadRecord();
  delete record[dateKey];
  saveRecord(record);
  // Also wipe any in-progress timer and board state for that date
  resetTimerProgress(dateKey);
  resetStateProgress(dateKey);
}

// ─── In-progress timer (localStorage) ────────────────────────────────────────

const TIMER_KEY = "triominoes-timer-v1";
type TimerRecord = Record<string, Partial<Record<Difficulty, number>>>;

function loadTimerRecord(): TimerRecord {
  try {
    return JSON.parse(localStorage.getItem(TIMER_KEY) ?? "{}") as TimerRecord;
  } catch {
    return {};
  }
}

/** Returns accumulated elapsed ms for an in-progress puzzle (0 if not stored). */
export function getStoredElapsed(dateKey: string, difficulty: Difficulty): number {
  return loadTimerRecord()[dateKey]?.[difficulty] ?? 0;
}

/** Persists accumulated elapsed ms for an in-progress puzzle. */
export function saveStoredElapsed(dateKey: string, difficulty: Difficulty, elapsed: number): void {
  const record = loadTimerRecord();
  if (!record[dateKey]) record[dateKey] = {};
  record[dateKey][difficulty] = elapsed;
  localStorage.setItem(TIMER_KEY, JSON.stringify(record));
}

/** Removes the in-progress timer entry (called on solve). */
export function clearStoredElapsed(dateKey: string, difficulty: Difficulty): void {
  const record = loadTimerRecord();
  if (record[dateKey]) {
    delete record[dateKey][difficulty];
    localStorage.setItem(TIMER_KEY, JSON.stringify(record));
  }
}

function resetTimerProgress(dateKey: string): void {
  const record = loadTimerRecord();
  delete record[dateKey];
  localStorage.setItem(TIMER_KEY, JSON.stringify(record));
}

// ─── In-progress board state (localStorage) ───────────────────────────────────

const STATE_KEY = "triominoes-state-v1";

type PuzzleStateEntry = { occupancy: (number | null)[]; rotations: number[] };
type StateRecord = Record<string, Partial<Record<Difficulty, PuzzleStateEntry>>>;

function loadStateRecord(): StateRecord {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as StateRecord;
  } catch {
    return {};
  }
}

/** Returns the saved board state for an in-progress puzzle, or null if none. */
export function loadPuzzleState(dateKey: string, difficulty: Difficulty): PuzzleStateEntry | null {
  return loadStateRecord()[dateKey]?.[difficulty] ?? null;
}

/** Persists the current board occupancy and rotations. */
export function savePuzzleState(
  dateKey: string,
  difficulty: Difficulty,
  occupancy: (number | null)[],
  rotations: number[],
): void {
  const record = loadStateRecord();
  if (!record[dateKey]) record[dateKey] = {};
  record[dateKey][difficulty] = { occupancy: [...occupancy], rotations: [...rotations] };
  localStorage.setItem(STATE_KEY, JSON.stringify(record));
}

/** Removes the saved board state (called on solve or reset). */
export function clearPuzzleState(dateKey: string, difficulty: Difficulty): void {
  const record = loadStateRecord();
  if (record[dateKey]) {
    delete record[dateKey][difficulty];
    localStorage.setItem(STATE_KEY, JSON.stringify(record));
  }
}

function resetStateProgress(dateKey: string): void {
  const record = loadStateRecord();
  delete record[dateKey];
  localStorage.setItem(STATE_KEY, JSON.stringify(record));
}
