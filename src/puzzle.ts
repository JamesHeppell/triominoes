import { ALL_PIECES, PieceValues } from "./pieces";
import { drawPiece, drawEmptySlot, drawStarSlot, triVertices } from "./draw";
import { computeBoardLayout } from "./layout";
import {
  Difficulty,
  getUtcDateKey,
  dailySeed,
  seededRng,
  markDailyComplete,
  isDailyComplete,
} from "./daily";

const PIECE_COUNT: Record<Difficulty, number> = {
  easy: 3,
  medium: 5,
  hard: 10,
};

const BOARD_SHAPE: Record<Difficulty, { rows: number; cols: number }> = {
  easy:   { rows: 1, cols: 3 },
  medium: { rows: 1, cols: 5 },
  hard:   { rows: 2, cols: 5 },
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

/** DOM panel shown when all pieces are placed. */
let solvedPanelEl: HTMLElement | null = null;

/** Set once in init(); used for completion tracking. */
let currentDateKey = "";
let currentDifficulty: Difficulty = "easy";

/** Prevents marking completion more than once per session. */
let solvedMarked = false;

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

// ─── Layout ──────────────────────────────────────────────────────────────────

const BODY_MARGIN = 16;  // must match body padding × 2 in CSS
const TRAY_PAD    = 12;
const DIVIDER_H   = 26;  // vertical space for the divider line + "YOUR PIECES" label

/**
 * Recomputes all position data.
 * Does NOT reset boardOccupancy – placement state is preserved across resizes.
 */
function recomputeLayout(difficulty: Difficulty): void {
  const { rows, cols } = BOARD_SHAPE[difficulty];
  const n = pieces.length;
  const available = window.innerWidth - BODY_MARGIN;

  // ── Board ──────────────────────────────────────────────────────────────────
  // Cap R so the tray always fits at least 3 columns.
  // CELL_W = R * (84/30), so 3 cols need R ≤ (available - TRAY_PAD*2) / (3 * 84/30).
  const rMaxForTray = Math.floor((available - TRAY_PAD * 2) / (3 * (84 / 30)));
  const bl = computeBoardLayout(rows, cols, rMaxForTray);
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
  const isSolved = boardOccupancy.length > 0 && boardOccupancy.every(p => p !== null);

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

  if (!isSolved) {
    // ── Divider ─────────────────────────────────────────────────────────────
    const divY = boardSectionH + 8;
    ctx.fillStyle = "#e94560";
    ctx.fillRect(16, divY, canvasW - 32, 2);

    const labelSize = Math.max(10, Math.round(R * 0.24));
    ctx.fillStyle = "#a0a0b0";
    ctx.font = `bold ${labelSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YOUR PIECES", canvasW / 2, divY + 9);

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

function seededPieces(n: number, rng: () => number): PieceValues[] {
  const arr = [...ALL_PIECES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function updateSolvedPanel(): void {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  for (const d of difficulties) {
    const btn = document.getElementById(`solved-btn-${d}`);
    if (!btn) continue;
    if (isDailyComplete(currentDateKey, d)) {
      btn.classList.add("btn-completed");
    } else {
      btn.classList.remove("btn-completed");
    }
  }

  const allDone = difficulties.every(d => isDailyComplete(currentDateKey, d));
  const subEl = document.getElementById("solved-sub");
  const navEl = document.getElementById("solved-nav");
  if (subEl) subEl.textContent = allDone ? "You've solved all of today's puzzles!" : "Try a different difficulty:";
  if (navEl) (navEl as HTMLElement).hidden = allDone;
}

function checkCompletion(): void {
  if (solvedMarked) return;
  if (boardOccupancy.length > 0 && boardOccupancy.every(p => p !== null)) {
    solvedMarked = true;
    markDailyComplete(currentDateKey, currentDifficulty);
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
  pieces         = seededPieces(PIECE_COUNT[difficulty], seededRng(dailySeed(currentDateKey, difficulty)));
  pieceRotation  = Array(PIECE_COUNT[difficulty]).fill(0);
  boardOccupancy = Array(
    BOARD_SHAPE[difficulty].rows * BOARD_SHAPE[difficulty].cols
  ).fill(null);

  const redraw = () => {
    recomputeLayout(difficulty);
    canvas.width  = canvasW;
    canvas.height = canvasH;
    render(ctx);
  };

  redraw();
  attachPointerEvents(canvas, ctx);

  // If today's puzzle is already complete, show the solved state immediately
  if (isDailyComplete(currentDateKey, difficulty)) {
    solvedMarked = true;
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
