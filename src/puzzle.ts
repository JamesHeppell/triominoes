import { ALL_PIECES, PieceValues } from "./pieces";
import { drawPiece, drawEmptySlot, drawStarSlot, triVertices, getPalette } from "./draw";
import { computeBoardLayout } from "./layout";
import {
  Difficulty,
  DEV_MODE,
  getUtcDateKey,
  dailySeed,
  seededRng,
  markDailyComplete,
  isDailyComplete,
  getDailySolveTime,
  getStoredElapsed,
  saveStoredElapsed,
  clearStoredElapsed,
  loadPuzzleState,
  savePuzzleState,
} from "./daily";

const PIECE_COUNT_RANGE: Record<Difficulty, [number, number]> = {
  easy:   [4, 6],
  medium: [7, 9],
  hard:   [10, 12],
};

/** Driven by DEV_MODE in daily.ts — skip adjacency checks for UI testing. Never commit DEV_MODE as true. */
const DEV_SKIP_ADJACENCY = DEV_MODE;

const BOARD_SHAPES_FOR_COUNT: Record<number, { rows: number; cols: number }[]> = {
  4:  [{ rows: 2, cols: 2 }, { rows: 1, cols: 4 }],
  5:  [{ rows: 1, cols: 5 }],
  6:  [{ rows: 2, cols: 3 }, { rows: 3, cols: 2 }, { rows: 1, cols: 6 }],
  7:  [{ rows: 1, cols: 7 }, { rows: 2, cols: 4 }],
  8:  [{ rows: 2, cols: 4 }, { rows: 4, cols: 2 }, { rows: 3, cols: 3 }],
  9:  [{ rows: 3, cols: 3 }, { rows: 2, cols: 5 }],
  10: [{ rows: 2, cols: 5 }, { rows: 5, cols: 2 }, { rows: 3, cols: 4 }, { rows: 4, cols: 3 }],
  11: [{ rows: 3, cols: 4 }, { rows: 4, cols: 3 }, { rows: 2, cols: 6 }],
  12: [{ rows: 3, cols: 4 }, { rows: 4, cols: 3 }, { rows: 2, cols: 6 }],
};

// ─── Module-level state ─────────────────────────────────────────────────────

/** The piece values – set once on load, stable across resizes. */
let pieces: PieceValues[] = [];

/** Current rotation (0–5) for each piece; 0 = canonical orientation (▲). */
let pieceRotation: number[] = [];

/**
 * Placement state: boardOccupancy[i] = index into pieces[] placed in board
 * slot i, or null.  Persists across resizes (only positions change).
 */
let boardOccupancy: (number | null)[] = [];

/** Board shape derived from the daily piece count; set once in init(). */
let boardShape: { rows: number; cols: number } = { rows: 1, cols: 3 };

/** DOM panel shown when all pieces are placed. */
let solvedPanelEl: HTMLElement | null = null;

/** Set once in init(); used for completion tracking. */
let currentDateKey = "";
let currentDifficulty: Difficulty = "easy";

/** Prevents marking completion more than once per session. */
let solvedMarked = false;

/** Accumulated ms from previous sessions (loaded from localStorage on init). */
let timerElapsed = 0;
/** epoch ms of the start of the current active session; null when paused. */
let timerActiveStart: number | null = null;
/** How long the player took to solve (ms), or null if not yet solved / pre-solved. */
let solveTimeMs: number | null = null;

// Layout – recomputed on resize (positions only, never touches occupancy)
let R = 30;
let trayR = 22; // Tray piece circumradius = R * TRAY_SCALE; set in recomputeLayout
let canvasW = 400;
let canvasH = 400;
let boardSectionH = 0;
let boardSlotPos: { cx: number; cy: number; up: boolean }[] = [];
let traySlotPos:  { cx: number; cy: number }[] = [];
let hintY = 0;          // y-centre of the hint text row; 0 when hint is dismissed

/** True once the user has interacted with a piece; persisted in localStorage. */
let hintDismissed = false;

/** Current drag, or null when idle. */
interface DragState {
  pieceIdx: number;
  /** Board slot the piece was lifted from, or null if lifted from tray. */
  fromBoard: number | null;
  x: number;
  y: number;
  /** Where the pointer went down — used to distinguish tap from drag. */
  startX: number;
  startY: number;
}
let drag: DragState | null = null;

// ─── Constraints ─────────────────────────────────────────────────────────────

type ConstraintKind = 'sum' | 'all-different' | 'all-same';

interface Constraint {
  kind: ConstraintKind;
  /** 1 slot for sum/all-same/all-different; 2 slots for paired sum. */
  slots: number[];
  /** Target sum for 'sum'; unused (0) for others. */
  target: number;
  /** Solid hex colour for badge and tint. */
  color: string;
}

const CONSTRAINT_COLORS = ['#7c3aed', '#ea580c', '#16a34a', '#0891b2'];

/** Extra board constraints generated from the solution; checked alongside adjacency. */
let boardConstraints: Constraint[] = [];

/** Convert '#rrggbb' + alpha to an rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Adjacency ───────────────────────────────────────────────────────────────

type AdjacencyType = 'right' | 'left' | 'below';

interface AdjacentPair {
  /** Always the ▲ slot. */
  slotA: number;
  /** Always the ▽ slot. */
  slotB: number;
  type: AdjacencyType;
}

/** All internal shared edges in the board; computed once after boardShape is set. */
let boardAdjacentPairs: AdjacentPair[] = [];

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Returns true if (px, py) is inside the triangle defined by verts. */
function pointInTriangle(
  px: number,
  py: number,
  verts: [number, number][]
): boolean {
  const s = (
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number
  ) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);

  const d1 = s(px, py, verts[0][0], verts[0][1], verts[1][0], verts[1][1]);
  const d2 = s(px, py, verts[1][0], verts[1][1], verts[2][0], verts[2][1]);
  const d3 = s(px, py, verts[2][0], verts[2][1], verts[0][0], verts[0][1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Convert a PointerEvent to canvas-space coordinates (handles CSS scaling). */
function toCanvas(
  canvas: HTMLCanvasElement,
  e: PointerEvent
): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (canvas.width  / rect.width),
    (e.clientY - rect.top)  * (canvas.height / rect.height),
  ];
}

// ─── Adjacency helpers ───────────────────────────────────────────────────────

/**
 * Enumerates every internal shared edge in the board exactly once.
 * Only processes ▲ slots (row+col even) and records their right, left, and
 * below ▽ neighbours — covering all pairs without double-counting.
 */
function computeAdjacentPairs(): AdjacentPair[] {
  const { rows, cols } = boardShape;
  const pairs: AdjacentPair[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 2 !== 0) continue; // only ▲ slots
      const i = row * cols + col;
      if (col + 1 < cols) pairs.push({ slotA: i, slotB: row * cols + (col + 1), type: 'right' });
      if (col > 0)        pairs.push({ slotA: i, slotB: row * cols + (col - 1), type: 'left' });
      if (row + 1 < rows) pairs.push({ slotA: i, slotB: (row + 1) * cols + col, type: 'below' });
    }
  }
  return pairs;
}

/**
 * Derives extra constraints from the known solution values.
 * Builds a pool of all valid candidates, shuffles it with the seeded RNG,
 * then greedily picks non-overlapping constraints up to the difficulty count.
 *
 * Allowed kinds by difficulty:
 *   easy   → sum (single slot only)
 *   medium → sum (single or pair), all-different
 *   hard   → all kinds
 */
function generateConstraints(solutionValues: PieceValues[], rng: () => number): Constraint[] {
  const targetCount = currentDifficulty === 'easy' ? 1 : currentDifficulty === 'medium' ? 2 : 4;
  const n = boardShape.rows * boardShape.cols;

  type CandKind = 'sum-single' | 'sum-pair' | 'all-different' | 'all-same';
  interface Cand { kind: CandKind; slots: number[]; target: number }
  const pool: Cand[] = [];

  for (let s = 0; s < n; s++) {
    const v = solutionValues[s];
    pool.push({ kind: 'sum-single', slots: [s], target: v[0] + v[1] + v[2] });
    if (v[0] !== v[1] && v[1] !== v[2] && v[0] !== v[2])
      pool.push({ kind: 'all-different', slots: [s], target: 0 });
    if (v[0] === v[1] && v[1] === v[2])
      pool.push({ kind: 'all-same', slots: [s], target: 0 });
  }
  for (const { slotA, slotB } of boardAdjacentPairs) {
    const vA = solutionValues[slotA], vB = solutionValues[slotB];
    pool.push({ kind: 'sum-pair', slots: [slotA, slotB],
      target: vA[0] + vA[1] + vA[2] + vB[0] + vB[1] + vB[2] });
  }

  // Filter to kinds allowed for this difficulty
  const allowed: Set<CandKind> = currentDifficulty === 'easy'
    ? new Set(['sum-single'])
    : currentDifficulty === 'medium'
    ? new Set(['sum-single', 'sum-pair', 'all-different'])
    : new Set(['sum-single', 'sum-pair', 'all-different', 'all-same']);
  const filtered = pool.filter(c => allowed.has(c.kind));

  // Fisher-Yates shuffle
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }

  // Greedy pick: no shared slots
  const chosen: Cand[] = [];
  const usedSlots = new Set<number>();
  for (const c of filtered) {
    if (chosen.length >= targetCount) break;
    if (c.slots.some(s => usedSlots.has(s))) continue;
    chosen.push(c);
    c.slots.forEach(s => usedSlots.add(s));
  }

  return chosen.map((c, i) => ({
    kind: c.kind === 'sum-single' || c.kind === 'sum-pair' ? 'sum' : c.kind,
    slots: c.slots,
    target: c.target,
    color: CONSTRAINT_COLORS[i],
  }));
}

/** Returns true if the constraint is satisfied by current board state.
 *  Always returns true when any constrained slot is still empty. */
function constraintSatisfied(c: Constraint): boolean {
  if (c.slots.some(s => boardOccupancy[s] === null)) return true;
  if (c.kind === 'sum') {
    const total = c.slots.reduce((sum, s) => {
      const v = rotatedValues(pieces[boardOccupancy[s]!], pieceRotation[boardOccupancy[s]!]);
      return sum + v[0] + v[1] + v[2];
    }, 0);
    return total === c.target;
  }
  const v = rotatedValues(pieces[boardOccupancy[c.slots[0]]!], pieceRotation[boardOccupancy[c.slots[0]]!]);
  if (c.kind === 'all-different') return v[0] !== v[1] && v[1] !== v[2] && v[0] !== v[2];
  /* all-same */                  return v[0] === v[1] && v[1] === v[2];
}

/**
 * Returns true if the two adjacent occupied slots have matching corner values
 * at their shared edge.  Returns true (no violation) when either slot is empty.
 *
 * Vertex layout (from triVertices): ▲ v[0]=top, v[1]=bottom-right, v[2]=bottom-left
 *                                   ▽ v[0]=bottom, v[1]=top-left,  v[2]=top-right
 * Shared corners per direction:
 *   right : ▲v[0]↔▽v[1]  ▲v[1]↔▽v[0]
 *   left  : ▲v[0]↔▽v[2]  ▲v[2]↔▽v[0]
 *   below : ▲v[1]↔▽v[2]  ▲v[2]↔▽v[1]
 */
function adjacencyMatches(slotA: number, slotB: number, type: AdjacencyType): boolean {
  const pA = boardOccupancy[slotA];
  const pB = boardOccupancy[slotB];
  if (pA === null || pB === null) return true;
  const vA = rotatedValues(pieces[pA], pieceRotation[pA]);
  const vB = rotatedValues(pieces[pB], pieceRotation[pB]);
  if (type === 'right') return vA[0] === vB[1] && vA[1] === vB[0];
  if (type === 'left')  return vA[0] === vB[2] && vA[2] === vB[0];
  /* below */           return vA[1] === vB[2] && vA[2] === vB[1];
}

/** True only when every slot is filled, every shared edge matches, and all extra constraints pass. */
function isPuzzleSolved(): boolean {
  if (!boardOccupancy.length || !boardOccupancy.every(p => p !== null)) return false;
  if (DEV_SKIP_ADJACENCY) return true;
  if (!boardAdjacentPairs.every(({ slotA, slotB, type }) => adjacencyMatches(slotA, slotB, type))) return false;
  return boardConstraints.every(c => constraintSatisfied(c));
}

// ─── Rotation helpers ────────────────────────────────────────────────────────

/** rotation 0,2,4 → ▲ (up); 1,3,5 → ▽ (down). */
function rotationIsUp(rotation: number): boolean {
  return rotation % 2 === 0;
}

/**
 * Returns the three displayed values for a piece at a given rotation.
 * Each rotation shifts which corner is "top" and whether the triangle is up or down.
 */
function rotatedValues(piece: PieceValues, rotation: number): PieceValues {
  const shift = rotation % 3;
  return [piece[shift], piece[(shift + 1) % 3], piece[(shift + 2) % 3]];
}

// ─── Puzzle generation ───────────────────────────────────────────────────────

/**
 * Fills the board with a valid triomino tiling via backtracking, then returns
 * the pieces in shuffled tray order so the player can't trivially read off
 * the solution.
 *
 * Fill order: left-to-right, top-to-bottom.  At each slot only already-placed
 * neighbours constrain the choice (at most 2), so the search tree is shallow
 * and finishes in milliseconds even for 12-slot boards.
 *
 * Constraints checked per slot (vertex layout: ▲ v[0]=top v[1]=btm-right v[2]=btm-left,
 *                                                ▽ v[0]=btm v[1]=top-left v[2]=top-right):
 *   ▲ slot: left ▽ via 'left' rule  → my[0]=nb[2], my[2]=nb[0]
 *   ▽ slot: left ▲ via 'right' rule → nb[0]=my[1], nb[1]=my[0]
 *           above ▲ via 'below' rule → nb[1]=my[2], nb[2]=my[1]
 */
function generateSolution(rng: () => number): { pieces: PieceValues[]; solutionValues: PieceValues[] } {
  const { rows, cols } = boardShape;
  const n = rows * cols;

  const genPieces: (PieceValues | null)[] = Array(n).fill(null);
  const genRots: number[] = Array(n).fill(0);
  const used = new Array(ALL_PIECES.length).fill(false);

  function fill(slot: number): boolean {
    if (slot === n) return true;

    const row = Math.floor(slot / cols);
    const col = slot % cols;
    const isUp = (row + col) % 2 === 0;
    const validRots = isUp ? [0, 2, 4] : [1, 3, 5];

    // Shuffle remaining piece indices so each solve is different
    const cands: number[] = [];
    for (let i = 0; i < ALL_PIECES.length; i++) {
      if (!used[i]) cands.push(i);
    }
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }

    for (const pi of cands) {
      for (const rot of validRots) {
        const v = rotatedValues(ALL_PIECES[pi], rot);
        let ok = true;

        if (isUp) {
          // ▲: check left ▽ neighbour via 'left' rule: my[0]=nb[2], my[2]=nb[0]
          if (col > 0) {
            const nb = rotatedValues(genPieces[slot - 1]!, genRots[slot - 1]);
            if (v[0] !== nb[2] || v[2] !== nb[0]) ok = false;
          }
        } else {
          // ▽: check left ▲ neighbour via 'right' rule: nb[0]=my[1], nb[1]=my[0]
          if (col > 0 && ok) {
            const nb = rotatedValues(genPieces[slot - 1]!, genRots[slot - 1]);
            if (nb[0] !== v[1] || nb[1] !== v[0]) ok = false;
          }
          // ▽: check above ▲ neighbour via 'below' rule: nb[1]=my[2], nb[2]=my[1]
          if (row > 0 && ok) {
            const nb = rotatedValues(genPieces[(row - 1) * cols + col]!, genRots[(row - 1) * cols + col]);
            if (nb[1] !== v[2] || nb[2] !== v[1]) ok = false;
          }
        }

        if (ok) {
          genPieces[slot] = ALL_PIECES[pi];
          genRots[slot]   = rot;
          used[pi]        = true;
          if (fill(slot + 1)) return true;
          genPieces[slot] = null;
          used[pi]        = false;
        }
      }
    }
    return false; // backtrack
  }

  if (!fill(0)) {
    // Should never happen for n ≤ 12 with 56 pieces; guard for robustness
    console.warn("generateSolution: exhausted — falling back to random pieces");
    const arr = [...ALL_PIECES];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const fallback = arr.slice(0, n);
    return { pieces: fallback, solutionValues: fallback };
  }

  // Capture solution values before shuffling tray order
  const solutionValues = (genPieces as PieceValues[]).map((p, i) => rotatedValues(p, genRots[i]));

  // Shuffle tray order so the fill sequence doesn't reveal which piece goes where
  const result = genPieces as PieceValues[];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { pieces: result, solutionValues };
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const BODY_MARGIN = 16;  // must match body padding × 2 in CSS
const TRAY_PAD    = 12;
const DIVIDER_H   = 14;  // vertical space for the divider line
const HINT_H      = 26;  // height reserved below tray pieces for the hint text
const HINT_KEY    = "triominoes-hint-dismissed";
const CONSTRAINT_TIP_KEY = "triominoes-constraint-tip-v1";

/**
 * Recomputes all position data.
 * Does NOT reset boardOccupancy – placement state is preserved across resizes.
 * availH is the pixel height available for the canvas (window height minus page chrome).
 */
function recomputeLayout(availH: number): void {
  const { rows, cols } = boardShape;
  const n = pieces.length;
  const available = window.innerWidth - BODY_MARGIN;
  const BOARD_PAD_X = 20;  // must match PAD_X in layout.ts
  const BOARD_PAD_Y = 40;  // must match PAD_Y in layout.ts

  // ── Find the largest R that fits both width and height ─────────────────────
  const rFromWidth = Math.floor(
    (available - 2 * BOARD_PAD_X) / ((cols + 1) * (Math.sqrt(3) / 2))
  );

  // Tray pieces are rendered at 3/4 of the board R so the board can occupy more space.
  const TRAY_SCALE = 0.75;

  // Tray cell size: piece bounding box + gap (× trayR/30).
  // Piece itself is √3 ≈ 1.732 wide, 1.5 tall. Hard mode uses a tighter horizontal ratio
  // (56/30 ≈ 1.867 — just a sliver of gap each side) so 4 cols fit at a larger R,
  // which lets both pieces and the board be bigger on small screens.
  const TRAY_CELL_W_RATIO = currentDifficulty === 'hard' ? 56 / 30 : 68 / 30;
  const TRAY_CELL_H_RATIO = 62 / 30;

  const hintReserve = hintDismissed ? 0 : HINT_H;

  // Hard mode: enforce at least 4 tray columns so the board gets more space.
  // Max columns capped at half the piece count so wide screens never show a
  // single long row (e.g. 11 across + 1 below); ceil(n/2) keeps two roughly
  // equal rows and naturally scales if the piece-count range changes.
  const minTrayCols = currentDifficulty === 'hard' ? 4 : 1;
  const maxTrayCols = Math.ceil(n / 2);

  let bestR = 10;
  for (let r = rFromWidth; r >= 10; r--) {
    const boardH  = Math.round(rows * 1.5 * r + 2 * BOARD_PAD_Y);
    const cellW   = r * TRAY_SCALE * TRAY_CELL_W_RATIO;
    const cellH   = r * TRAY_SCALE * TRAY_CELL_H_RATIO;
    const trayAvail = available - TRAY_PAD * 2;
    // If minTrayCols can't fit horizontally at this R, keep shrinking
    if (minTrayCols * cellW > trayAvail) continue;
    const tCols   = Math.max(minTrayCols, Math.min(maxTrayCols, Math.floor(trayAvail / cellW)));
    const tRows   = Math.ceil(n / tCols);
    const totalH  = boardH + DIVIDER_H + 2 * TRAY_PAD + tRows * cellH + hintReserve;
    if (totalH <= availH) { bestR = r; break; }
  }

  // ── Board metrics ──────────────────────────────────────────────────────────
  const bl = computeBoardLayout(rows, cols, bestR);
  R = bl.r;
  trayR = Math.round(R * TRAY_SCALE);

  // ── Tray dimensions (computed before allocating board section height) ───────
  const CELL_W = trayR * TRAY_CELL_W_RATIO;
  const CELL_H = trayR * TRAY_CELL_H_RATIO;
  const trayAvailFinal = available - TRAY_PAD * 2;
  const trayCols = Math.max(minTrayCols, Math.min(maxTrayCols, Math.floor(trayAvailFinal / CELL_W)));
  const trayRows = Math.ceil(n / trayCols);
  const trayContentH = 2 * TRAY_PAD + trayRows * CELL_H + hintReserve;

  // ── Extend canvas to fill viewport; give all extra space to board section ───
  const minContentH = Math.round(rows * bl.h + 2 * BOARD_PAD_Y + DIVIDER_H + trayContentH);
  canvasW = available;
  canvasH = Math.max(minContentH, availH);

  // Board section = everything above the divider; centre tiles vertically in it
  boardSectionH = Math.round(canvasH - DIVIDER_H - trayContentH);
  const boardPadY = Math.round((boardSectionH - rows * bl.h) / 2);

  // Centre the board horizontally within the canvas
  const boardOffsetX = Math.max(0, Math.round((available - bl.canvasW) / 2));

  boardSlotPos = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const up = (row + col) % 2 === 0;
      boardSlotPos.push({
        cx: boardOffsetX + bl.padX + (col + 1) * (bl.s / 2),
        cy: boardPadY + row * bl.h + (up ? (2 * bl.h) / 3 : bl.h / 3),
        up,
      });
    }
  }

  // ── Tray (pinned to bottom of canvas, just below the divider) ─────────────
  const trayContentW = trayCols * CELL_W;
  const trayOffsetX  = Math.max(0, (available - trayContentW) / 2);
  const trayStartY   = boardSectionH + DIVIDER_H;

  traySlotPos = [];
  for (let i = 0; i < n; i++) {
    const col = i % trayCols;
    const row = Math.floor(i / trayCols);
    traySlotPos.push({
      cx: trayOffsetX + col * CELL_W + CELL_W / 2,
      cy: trayStartY + TRAY_PAD + row * CELL_H + CELL_H / 2,
    });
  }

  hintY = trayStartY + TRAY_PAD + trayRows * CELL_H + hintReserve / 2;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render(ctx: CanvasRenderingContext2D): void {
  // solvedMarked is set only after isPuzzleSolved() passes, so tying the
  // visual state to it means the overlay only appears on a valid solution.
  const isSolved = solvedMarked && boardOccupancy.length > 0 && boardOccupancy.every(p => p !== null);

  // When solved, shrink the canvas to just the board section so the tray
  // disappears and the solved panel below becomes immediately visible.
  const renderH = isSolved ? boardSectionH : canvasH;
  if (ctx.canvas.height !== renderH) ctx.canvas.height = renderH; // clears canvas

  // Background
  const palette = getPalette();
  ctx.fillStyle = palette.canvasBg;
  ctx.fillRect(0, 0, canvasW, renderH);

  // ── Board slots ───────────────────────────────────────────────────────────
  for (let i = 0; i < boardSlotPos.length; i++) {
    const { cx, cy, up } = boardSlotPos[i];
    const pIdx = boardOccupancy[i];

    if (pIdx !== null && pIdx !== drag?.pieceIdx) {
      drawPiece(ctx, cx, cy, R, rotatedValues(pieces[pIdx], pieceRotation[pIdx]), up);
    } else {
      drawEmptySlot(ctx, cx, cy, R, up);
    }
  }

  // ── Constraint tints (semi-transparent colour overlay on constrained slots) ─
  for (const c of boardConstraints) {
    ctx.save();
    ctx.fillStyle = hexToRgba(c.color, 0.28);
    for (const s of c.slots) {
      const { cx, cy, up } = boardSlotPos[s];
      const verts = triVertices(cx, cy, R, up);
      ctx.beginPath();
      ctx.moveTo(verts[0][0], verts[0][1]);
      ctx.lineTo(verts[1][0], verts[1][1]);
      ctx.lineTo(verts[2][0], verts[2][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Constraint badges (circle + label at centroid of affected slots) ───────
  for (const c of boardConstraints) {
    const bx = c.slots.reduce((sum, s) => sum + boardSlotPos[s].cx, 0) / c.slots.length;
    const by = c.slots.reduce((sum, s) => sum + boardSlotPos[s].cy, 0) / c.slots.length;
    const allFilled = c.slots.every(s => boardOccupancy[s] !== null);
    const satisfied = allFilled && constraintSatisfied(c);
    const badgeR = Math.max(8, Math.round(R * 0.22));
    const pendingLabel = c.kind === 'sum' ? String(c.target) : c.kind === 'all-different' ? '≠' : '≡';
    const label = allFilled ? (satisfied ? '✓' : '✗') : pendingLabel;

    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = allFilled ? (satisfied ? '#22c55e' : '#ef4444') : c.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(badgeR * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, by);
    ctx.restore();
  }

  // ── Mismatch edge highlights ─────────────────────────────────────────────
  if (!isSolved) {
    for (const { slotA, slotB, type } of boardAdjacentPairs) {
      if (boardOccupancy[slotA] === null || boardOccupancy[slotB] === null) continue;
      if (adjacencyMatches(slotA, slotB, type)) continue;

      const { cx, cy } = boardSlotPos[slotA]; // slotA is always ▲
      const verts = triVertices(cx, cy, R, true);
      const [v1, v2] = type === 'right' ? [verts[0], verts[1]]
                     : type === 'left'  ? [verts[0], verts[2]]
                     :                   [verts[1], verts[2]]; // 'below'

      // Inset 10% from each end so the indicator is slightly shorter than the edge
      const inset = 0.1;
      const i1: [number, number] = [v1[0] + inset * (v2[0] - v1[0]), v1[1] + inset * (v2[1] - v1[1])];
      const i2: [number, number] = [v2[0] - inset * (v2[0] - v1[0]), v2[1] - inset * (v2[1] - v1[1])];

      ctx.save();
      ctx.strokeStyle = "#ff4040";
      ctx.lineWidth = Math.max(1, Math.round(R * 0.07));
      ctx.lineCap = "round";
      ctx.setLineDash([Math.round(R * 0.18), Math.round(R * 0.12)]);
      ctx.shadowColor = "#ff2222";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(i1[0], i1[1]);
      ctx.lineTo(i2[0], i2[1]);
      ctx.stroke();

      // ✕ mark at edge midpoint — shape-based indicator for colorblind users
      const mx = (i1[0] + i2[0]) / 2;
      const my = (i1[1] + i2[1]) / 2;
      const xr = Math.max(4, Math.round(R * 0.13));
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(mx, my, xr, 0, Math.PI * 2);
      ctx.fillStyle = palette.slotFill;
      ctx.fill();
      ctx.strokeStyle = "#ff4040";
      ctx.lineWidth = Math.max(1.5, Math.round(R * 0.065));
      const a = xr * 0.55;
      ctx.beginPath();
      ctx.moveTo(mx - a, my - a); ctx.lineTo(mx + a, my + a);
      ctx.moveTo(mx + a, my - a); ctx.lineTo(mx - a, my + a);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (!isSolved) {
    // ── Divider ─────────────────────────────────────────────────────────────
    const divY = boardSectionH + 8;
    ctx.fillStyle = "#e94560";
    ctx.fillRect(16, divY, canvasW - 32, 2);

    // ── Tray slots ───────────────────────────────────────────────────────────
    for (let i = 0; i < pieces.length; i++) {
      const { cx, cy } = traySlotPos[i];
      const isOnBoard  = boardOccupancy.some(p => p === i);
      const isDragging = drag?.pieceIdx === i;

      if (!isOnBoard && !isDragging) {
        drawPiece(ctx, cx, cy, trayR, rotatedValues(pieces[i], pieceRotation[i]), rotationIsUp(pieceRotation[i]));
      } else {
        drawStarSlot(ctx, cx, cy, trayR);
      }
    }

    // ── Controls hint (shown until first interaction) ─────────────────────────
    if (!hintDismissed) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("tap to rotate  ·  drag to board", canvasW / 2, hintY);
    }

    // ── Snap preview ghost ────────────────────────────────────────────────────
    if (drag && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 8) {
      const ghostSlot = snapTarget(drag.x, drag.y);
      if (ghostSlot !== -1) {
        const { cx, cy, up } = boardSlotPos[ghostSlot];
        let ghostRot = pieceRotation[drag.pieceIdx];
        if (rotationIsUp(ghostRot) !== up) ghostRot = (ghostRot + 3) % 6;
        ctx.save();
        ctx.globalAlpha = 0.4;
        drawPiece(ctx, cx, cy, R, rotatedValues(pieces[drag.pieceIdx], ghostRot), up);
        ctx.restore();
      }
    }

    // ── Dragged piece (drawn on top of everything) ───────────────────────────
    if (drag) {
      ctx.save();
      ctx.shadowColor   = "rgba(0,0,0,0.45)";
      ctx.shadowBlur    = 10;
      ctx.shadowOffsetY = 5;
      const dRot = pieceRotation[drag.pieceIdx];
      drawPiece(ctx, drag.x, drag.y, R, rotatedValues(pieces[drag.pieceIdx], dRot), rotationIsUp(dRot));
      ctx.restore();
    }
  }

  // ── Solved overlay ────────────────────────────────────────────────────────
  if (solvedPanelEl) solvedPanelEl.hidden = !isSolved;
  if (isSolved) {
    updateSolvedPanel();

    ctx.fillStyle = palette.solvedOverlay;
    ctx.fillRect(0, 0, canvasW, boardSectionH);

    let solvedSize = Math.max(28, Math.round(R * 1.3));
    ctx.font = `bold ${solvedSize}px sans-serif`;
    const maxTextW = canvasW - 32;
    const measuredW = ctx.measureText("SOLVED!").width;
    if (measuredW > maxTextW) {
      solvedSize = Math.floor(solvedSize * maxTextW / measuredW);
      ctx.font = `bold ${solvedSize}px sans-serif`;
    }
    ctx.fillStyle = "#f9c74f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SOLVED!", canvasW / 2, boardSectionH / 2);
  }
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

/** Board slot index at canvas point, or -1. */
function hitBoard(x: number, y: number): number {
  for (let i = 0; i < boardSlotPos.length; i++) {
    const { cx, cy, up } = boardSlotPos[i];
    if (pointInTriangle(x, y, triVertices(cx, cy, R, up))) return i;
  }
  return -1;
}

/** Tray piece index at canvas point (skips pieces currently on board or in drag), or -1. */
function hitTray(x: number, y: number): number {
  for (let i = 0; i < pieces.length; i++) {
    if (boardOccupancy.some(p => p === i)) continue;
    if (drag?.pieceIdx === i) continue;
    const { cx, cy } = traySlotPos[i];
    // Check both orientations — slot renders as a star (▲ + ▽)
    if (pointInTriangle(x, y, triVertices(cx, cy, trayR, true))) return i;
    if (pointInTriangle(x, y, triVertices(cx, cy, trayR, false))) return i;
  }
  return -1;
}

/**
 * Find the best empty board slot to snap to on drop.
 * First tries exact point-in-triangle; falls back to nearest centre ≤ 1.2·R.
 */
function snapTarget(x: number, y: number): number {
  // Exact hit
  for (let i = 0; i < boardSlotPos.length; i++) {
    if (boardOccupancy[i] !== null) continue;
    const { cx, cy, up } = boardSlotPos[i];
    if (pointInTriangle(x, y, triVertices(cx, cy, R, up))) return i;
  }
  // Nearest centre
  let best = -1;
  let bestD = R * 1.2;
  for (let i = 0; i < boardSlotPos.length; i++) {
    if (boardOccupancy[i] !== null) continue;
    const { cx, cy } = boardSlotPos[i];
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Pointer events ──────────────────────────────────────────────────────────

function attachPointerEvents(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): void {
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const [x, y] = toCanvas(canvas, e);

    // Lift from occupied board slot
    const bi = hitBoard(x, y);
    if (bi !== -1 && boardOccupancy[bi] !== null) {
      drag = { pieceIdx: boardOccupancy[bi]!, fromBoard: bi, x, y, startX: x, startY: y };
      boardOccupancy[bi] = null;
      canvas.setPointerCapture(e.pointerId);
      render(ctx);
      return;
    }

    // Lift from tray
    const ti = hitTray(x, y);
    if (ti !== -1) {
      drag = { pieceIdx: ti, fromBoard: null, x, y, startX: x, startY: y };
      canvas.setPointerCapture(e.pointerId);
      render(ctx);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.preventDefault();
    const [x, y] = toCanvas(canvas, e);
    drag.x = x;
    drag.y = y;
    render(ctx);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const [x, y] = toCanvas(canvas, e);
    const { pieceIdx, fromBoard, startX, startY } = drag;
    drag = null;

    // Tap (no real movement) → rotate piece, restore to origin
    if (Math.hypot(x - startX, y - startY) < 8) {
      pieceRotation[pieceIdx] = (pieceRotation[pieceIdx] + 1) % 6;
      if (fromBoard !== null) boardOccupancy[fromBoard] = pieceIdx;
      checkCompletion();
      render(ctx);
      return;
    }

    const target = snapTarget(x, y);
    if (target !== -1) {
      // Auto-adapt rotation to match the slot's up/down orientation
      const slotUp = boardSlotPos[target].up;
      if (rotationIsUp(pieceRotation[pieceIdx]) !== slotUp) {
        pieceRotation[pieceIdx] = (pieceRotation[pieceIdx] + 3) % 6;
      }
      boardOccupancy[target] = pieceIdx;
    } else if (y >= boardSectionH) {
      // Dropped anywhere in the tray area → return piece to its tray home.
    } else if (fromBoard !== null) {
      // Dropped on the board area but no valid slot → restore to original slot
      boardOccupancy[fromBoard] = pieceIdx;
    }
    // else: lifted from tray, dropped on board with no valid slot → back to tray

    checkCompletion();
    render(ctx);
  });

  // System gesture interrupted the drag — restore piece to origin
  canvas.addEventListener("pointercancel", () => {
    if (!drag) return;
    const { pieceIdx, fromBoard } = drag;
    drag = null;
    if (fromBoard !== null) boardOccupancy[fromBoard] = pieceIdx;
    render(ctx);
  });
}

// ─── Constraint tooltip ───────────────────────────────────────────────────────

/**
 * Shows a first-encounter card explaining the constraint badges in the current
 * puzzle.  Only ever shown once (stored in localStorage); skipped if already
 * solved.  Sits below the ready-overlay in z-order so it appears naturally once
 * the player dismisses "Continue".
 */
function showConstraintTooltip(container: HTMLElement): void {
  if (localStorage.getItem(CONSTRAINT_TIP_KEY) === "1") return;
  if (boardConstraints.length === 0) return;

  const tip = document.createElement("div");
  tip.className = "constraint-tooltip";

  const heading = document.createElement("p");
  heading.className = "constraint-tooltip__heading";
  heading.textContent = "Coloured badges:";
  tip.appendChild(heading);

  for (const c of boardConstraints) {
    const row = document.createElement("div");
    row.className = "constraint-tooltip__row";

    const badge = document.createElement("span");
    badge.className = "constraint-tooltip__badge";
    badge.style.background = c.color;
    badge.textContent = c.kind === "sum" ? String(c.target)
                      : c.kind === "all-different" ? "≠" : "≡";

    const desc = document.createElement("span");
    desc.className = "constraint-tooltip__desc";
    if (c.kind === "sum") {
      desc.textContent = c.slots.length === 1
        ? `corners sum to ${c.target}`
        : `both tiles sum to ${c.target}`;
    } else if (c.kind === "all-different") {
      desc.textContent = "all 3 corners differ";
    } else {
      desc.textContent = "all 3 corners match";
    }

    row.append(badge, desc);
    tip.appendChild(row);
  }

  const btn = document.createElement("button");
  btn.className = "btn btn-easy constraint-tooltip__btn";
  btn.textContent = "Got it";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    localStorage.setItem(CONSTRAINT_TIP_KEY, "1");
    tip.remove();
  });
  tip.appendChild(btn);

  container.appendChild(tip);
}

// ─── Entry point ─────────────────────────────────────────────────────────────


function updateSolvedPanel(): void {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  for (const d of difficulties) {
    const btn = document.getElementById(`solved-btn-${d}`) as HTMLAnchorElement | null;
    if (!btn) continue;
    if (isDailyComplete(currentDateKey, d)) {
      btn.classList.add("btn-completed");
    } else {
      btn.classList.remove("btn-completed");
    }
    if (d === currentDifficulty) {
      btn.removeAttribute("href");
      btn.classList.add("btn-current");
    }
  }

  const allDone = difficulties.every(d => isDailyComplete(currentDateKey, d));
  const subEl  = document.getElementById("solved-sub");
  const navEl  = document.getElementById("solved-nav");
  const timeEl = document.getElementById("solve-time");
  if (subEl)  subEl.textContent  = allDone ? "You've solved all of today's puzzles!" : "Try a different difficulty:";
  if (navEl)  (navEl as HTMLElement).hidden = allDone;
  if (timeEl) timeEl.textContent = solveTimeMs !== null ? `Solved in ${formatSolveTime(solveTimeMs)}` : "";
}

function getElapsed(): number {
  return timerElapsed + (timerActiveStart !== null ? Date.now() - timerActiveStart : 0);
}

function pauseTimer(): void {
  if (timerActiveStart === null) return;
  timerElapsed += Date.now() - timerActiveStart;
  timerActiveStart = null;
  if (!solvedMarked) saveStoredElapsed(currentDateKey, currentDifficulty, timerElapsed);
}

function resumeTimer(): void {
  if (timerActiveStart !== null || solvedMarked) return;
  timerActiveStart = Date.now();
}

function formatSolveTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function showReadyOverlay(): void {
  const main = document.querySelector(".puzzle-main") as HTMLElement | null;
  if (!main) { resumeTimer(); return; }

  const overlay = document.createElement("div");
  overlay.className = "ready-overlay";

  const heading = document.createElement("h2");
  heading.textContent = "Ready?";

  const elapsed = document.createElement("p");
  elapsed.className = "ready-elapsed";
  elapsed.textContent = `${formatSolveTime(timerElapsed)} played so far`;

  const btn = document.createElement("button");
  btn.textContent = "Continue";
  btn.className = "btn btn-easy";
  btn.addEventListener("click", () => {
    overlay.remove();
    resumeTimer();
  });

  overlay.append(heading, elapsed, btn);
  main.appendChild(overlay);
}

function checkCompletion(): void {
  if (solvedMarked) return;
  savePuzzleState(currentDateKey, currentDifficulty, boardOccupancy, pieceRotation);
  if (isPuzzleSolved()) {
    solvedMarked = true;
    if (!hintDismissed) {
      hintDismissed = true;
      localStorage.setItem(HINT_KEY, "1");
    }
    solveTimeMs = getElapsed();
    timerActiveStart = null;
    clearStoredElapsed(currentDateKey, currentDifficulty);
    // Keep puzzle state saved (don't clear) so revisiting shows the correct solved board
    markDailyComplete(currentDateKey, currentDifficulty, solveTimeMs);
  }
}

function init(): void {
  if (DEV_MODE) {
    const banner = document.createElement("div");
    banner.className = "dev-banner";
    banner.textContent = "DEV MODE";
    document.body.appendChild(banner);
  }

  // Best-effort portrait lock — works on Android Chrome PWA; silently ignored elsewhere
  (screen.orientation as any)?.lock?.("portrait").catch(() => {});

  const params = new URLSearchParams(window.location.search);
  const difficulty = (params.get("d") ?? "easy") as Difficulty;

  const titleEl = document.getElementById("puzzle-title");
  if (titleEl) {
    titleEl.textContent =
      difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  }

  solvedPanelEl = document.getElementById("solved-panel");

  const canvas = document.getElementById("puzzle-canvas") as HTMLCanvasElement | null;
  if (!canvas) { console.error("No canvas element found."); return; }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Initialise once per load — pieces are seeded by today's UTC date
  currentDateKey    = getUtcDateKey();
  currentDifficulty = difficulty;
  solvedMarked      = false;
  solveTimeMs       = null;
  timerElapsed      = getStoredElapsed(currentDateKey, difficulty);
  timerActiveStart  = Date.now();
  const rng      = seededRng(dailySeed(currentDateKey, difficulty));
  const [min, max] = PIECE_COUNT_RANGE[difficulty];
  const count    = min + Math.floor(rng() * (max - min + 1));
  const shapes = BOARD_SHAPES_FOR_COUNT[count];
  boardShape         = shapes[Math.floor(rng() * shapes.length)];
  boardAdjacentPairs = computeAdjacentPairs();
  const { pieces: solvedPieces, solutionValues } = generateSolution(rng);
  pieces             = solvedPieces;
  pieceRotation      = Array(pieces.length).fill(0);
  boardOccupancy     = Array(boardShape.rows * boardShape.cols).fill(null);
  boardConstraints   = generateConstraints(solutionValues, rng);

  // Restore saved board state if it exists and sizes match
  const savedState = loadPuzzleState(currentDateKey, difficulty);
  if (savedState &&
      savedState.occupancy.length === boardOccupancy.length &&
      savedState.rotations.length === pieceRotation.length) {
    boardOccupancy = savedState.occupancy;
    pieceRotation  = savedState.rotations;
  }

  const redraw = () => {
    const canvasOffsetY = canvas.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(150, window.innerHeight - canvasOffsetY - 16);
    recomputeLayout(availH);
    canvas.width  = canvasW;
    canvas.height = canvasH;
    render(ctx);
  };

  hintDismissed = localStorage.getItem(HINT_KEY) === "1";
  redraw();
  attachPointerEvents(canvas, ctx);

  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement | null;
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const label   = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
      const homeUrl = window.location.origin +
                      window.location.pathname.replace("puzzle.html", "index.html");
      const [y, m, d] = currentDateKey.split("-").map(Number);
      const dateStr = new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const timeStr = solveTimeMs !== null ? ` in ${formatSolveTime(solveTimeMs)}` : "";
      const text    = `🔺 Triominoes · ${dateStr}\nSolved ${label}${timeStr} — can you beat it?`;
      try {
        if (navigator.share) {
          await navigator.share({ title: "Triominoes", text, url: homeUrl });
        } else {
          await navigator.clipboard.writeText(`${text}\n${homeUrl}`);
          shareBtn.textContent = "Copied!";
          setTimeout(() => { shareBtn.textContent = "Share result"; }, 2000);
        }
      } catch { /* cancelled */ }
    });
  }

  const puzzleMain = document.querySelector(".puzzle-main") as HTMLElement | null;

  // If today's puzzle is already complete, show the solved state immediately
  if (isDailyComplete(currentDateKey, difficulty)) {
    solvedMarked = true;
    solveTimeMs = getDailySolveTime(currentDateKey, difficulty);
    // savedState was already applied above if valid; only fall back to
    // reconstruction from solutionValues when no persisted state exists
    // (e.g. solved before state-persistence was added to checkCompletion).
    const hasSavedState = savedState !== null &&
      savedState.occupancy.length === boardOccupancy.length &&
      savedState.rotations.length === pieceRotation.length;
    if (!hasSavedState) {
      const used = new Set<number>();
      for (let s = 0; s < boardOccupancy.length; s++) {
        const up = boardSlotPos[s].up;
        const sv = solutionValues[s];
        const validRots = up ? [0, 2, 4] : [1, 3, 5];
        for (let pi = 0; pi < pieces.length; pi++) {
          if (used.has(pi)) continue;
          let placed = false;
          for (const rot of validRots) {
            const v = rotatedValues(pieces[pi], rot);
            if (v[0] === sv[0] && v[1] === sv[1] && v[2] === sv[2]) {
              boardOccupancy[s] = pi;
              pieceRotation[pi] = rot;
              used.add(pi);
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
      }
    }
    render(ctx);
  } else {
    if (puzzleMain) showConstraintTooltip(puzzleMain);
    if (timerElapsed >= 10_000) {
      // Only show overlay if at least 10s played — avoids prompt for very brief sessions
      pauseTimer();
      showReadyOverlay();
    }
    // Less than 10s played — resume silently (timer already running)
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseTimer();
    } else {
      resumeTimer();
    }
  });

  window.addEventListener("pagehide", () => {
    pauseTimer();
    if (!solvedMarked) savePuzzleState(currentDateKey, currentDifficulty, boardOccupancy, pieceRotation);
  });

  let lastWidth = window.innerWidth;
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redraw, 150);
  });
}

document.addEventListener("DOMContentLoaded", init);
