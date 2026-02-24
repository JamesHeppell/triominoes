import { ALL_PIECES, PieceValues } from "./pieces";
import { drawPiece, drawEmptySlot, drawStarSlot, triVertices } from "./draw";
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
  7:  [{ rows: 1, cols: 7 }],
  8:  [{ rows: 2, cols: 4 }, { rows: 4, cols: 2 }, { rows: 1, cols: 8 }],
  9:  [{ rows: 3, cols: 3 }, { rows: 1, cols: 9 }],
  10: [{ rows: 2, cols: 5 }, { rows: 1, cols: 10 }],
  11: [{ rows: 1, cols: 11 }],
  12: [{ rows: 3, cols: 4 }, { rows: 4, cols: 3 }, { rows: 2, cols: 6 }, { rows: 1, cols: 12 }],
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

/** epoch ms when the puzzle was loaded; used to compute solve time. */
let startTime = 0;
/** How long the player took to solve (ms), or null if not yet solved / pre-solved. */
let solveTimeMs: number | null = null;

// Layout – recomputed on resize (positions only, never touches occupancy)
let R = 30;
let canvasW = 400;
let canvasH = 400;
let boardSectionH = 0;
let boardSlotPos: { cx: number; cy: number; up: boolean }[] = [];
let traySlotPos:  { cx: number; cy: number }[] = [];

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

/** True only when every slot is filled AND every shared edge has matching values. */
function isPuzzleSolved(): boolean {
  if (!boardOccupancy.length || !boardOccupancy.every(p => p !== null)) return false;
  if (DEV_SKIP_ADJACENCY) return true;
  return boardAdjacentPairs.every(({ slotA, slotB, type }) => adjacencyMatches(slotA, slotB, type));
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
function generateSolution(rng: () => number): PieceValues[] {
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
    return arr.slice(0, n);
  }

  // Shuffle tray order so the fill sequence doesn't reveal which piece goes where
  const result = genPieces as PieceValues[];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const BODY_MARGIN = 16;  // must match body padding × 2 in CSS
const TRAY_PAD    = 12;
const DIVIDER_H   = 14;  // vertical space for the divider line

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
    Math.min(60, (available - 2 * BOARD_PAD_X) / ((cols + 1) * (Math.sqrt(3) / 2)))
  );

  let bestR = 10;
  for (let r = rFromWidth; r >= 10; r--) {
    const boardH  = Math.round(rows * 1.5 * r + 2 * BOARD_PAD_Y);
    const cellW   = r * (84 / 30);
    const cellH   = r * (78 / 30);
    const tCols   = Math.max(1, Math.min(n, Math.floor((available - TRAY_PAD * 2) / cellW)));
    const tRows   = Math.ceil(n / tCols);
    const totalH  = boardH + DIVIDER_H + 2 * TRAY_PAD + tRows * cellH;
    if (totalH <= availH) { bestR = r; break; }
  }

  // ── Board ──────────────────────────────────────────────────────────────────
  const bl = computeBoardLayout(rows, cols, bestR);
  R = bl.r;
  boardSectionH = bl.canvasH;

  // Centre the board horizontally within the canvas
  const boardOffsetX = Math.max(0, Math.round((available - bl.canvasW) / 2));

  boardSlotPos = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const up = (row + col) % 2 === 0;
      boardSlotPos.push({
        cx: boardOffsetX + bl.padX + (col + 1) * (bl.s / 2),
        cy: bl.padY + row * bl.h + (up ? (2 * bl.h) / 3 : bl.h / 3),
        up,
      });
    }
  }

  // ── Tray ───────────────────────────────────────────────────────────────────
  const CELL_W = R * (84 / 30);
  const CELL_H = R * (78 / 30);
  const trayCols = Math.max(1, Math.min(n, Math.floor((available - TRAY_PAD * 2) / CELL_W)));
  const trayRows = Math.ceil(n / trayCols);

  // Centre tray horizontally
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

  canvasW = available;
  canvasH = Math.round(trayStartY + TRAY_PAD + trayRows * CELL_H + TRAY_PAD);
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
  ctx.fillStyle = "#16213e";
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

      ctx.save();
      ctx.strokeStyle = "#ff4040";
      ctx.lineWidth = Math.max(2, Math.round(R * 0.14));
      ctx.lineCap = "round";
      ctx.shadowColor = "#ff2222";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(v1[0], v1[1]);
      ctx.lineTo(v2[0], v2[1]);
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
        drawPiece(ctx, cx, cy, R, rotatedValues(pieces[i], pieceRotation[i]), rotationIsUp(pieceRotation[i]));
      } else {
        drawStarSlot(ctx, cx, cy, R);
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

    ctx.fillStyle = "rgba(22, 33, 62, 0.78)";
    ctx.fillRect(0, 0, canvasW, boardSectionH);

    const solvedSize = Math.max(28, Math.round(R * 1.3));
    ctx.fillStyle = "#f9c74f";
    ctx.font = `bold ${solvedSize}px sans-serif`;
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
    if (pointInTriangle(x, y, triVertices(cx, cy, R, true))) return i;
    if (pointInTriangle(x, y, triVertices(cx, cy, R, false))) return i;
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

function formatSolveTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function checkCompletion(): void {
  if (solvedMarked) return;
  if (isPuzzleSolved()) {
    solvedMarked = true;
    solveTimeMs = Date.now() - startTime;
    markDailyComplete(currentDateKey, currentDifficulty, solveTimeMs);
  }
}

function init(): void {
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
  startTime         = Date.now();
  const rng      = seededRng(dailySeed(currentDateKey, difficulty));
  const [min, max] = PIECE_COUNT_RANGE[difficulty];
  const count    = min + Math.floor(rng() * (max - min + 1));
  const shapes = BOARD_SHAPES_FOR_COUNT[count];
  boardShape         = shapes[Math.floor(rng() * shapes.length)];
  boardAdjacentPairs = computeAdjacentPairs();
  pieces             = generateSolution(rng);
  pieceRotation      = Array(pieces.length).fill(0);
  boardOccupancy     = Array(boardShape.rows * boardShape.cols).fill(null);

  const redraw = () => {
    const canvasOffsetY = canvas.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(150, window.innerHeight - canvasOffsetY - 16);
    recomputeLayout(availH);
    canvas.width  = canvasW;
    canvas.height = canvasH;
    render(ctx);
  };

  redraw();
  attachPointerEvents(canvas, ctx);

  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement | null;
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const label   = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
      const homeUrl = window.location.origin +
                      window.location.pathname.replace("puzzle.html", "index.html");
      const timeStr = solveTimeMs !== null ? ` in ${formatSolveTime(solveTimeMs)}` : "";
      const text    = `I solved today's Triominoes puzzle (${label})${timeStr} 🎉`;
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

  // If today's puzzle is already complete, show the solved state immediately
  if (isDailyComplete(currentDateKey, difficulty)) {
    solvedMarked = true;
    solveTimeMs = getDailySolveTime(currentDateKey, difficulty);
    for (let i = 0; i < boardOccupancy.length; i++) {
      boardOccupancy[i] = i;
      // Flip rotation to match slot orientation (all pieces start at rotation 0 = up)
      if (!boardSlotPos[i].up) pieceRotation[i] = 3;
    }
    render(ctx);
  }

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
