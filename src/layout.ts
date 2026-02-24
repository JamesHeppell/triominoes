// Body has 8px horizontal padding each side → 16px total (matches style.css)
const BODY_MARGIN = 16;

const CANVAS_PAD = 12; // internal canvas padding for the piece grid
const IDEAL_CELL_W = 84;
const IDEAL_CELL_H = 78;
const IDEAL_R = 30;
const MIN_SCALE = 0.7;

// ─── Piece grid layout (used by main page and puzzle tray) ─────────────────

export interface GridLayout {
  cols: number;
  cellW: number;
  cellH: number;
  r: number;
  canvasW: number;
  canvasH: number;
  pad: number;
}

/**
 * Responsive grid layout for `n` triangular pieces.
 * Picks the most columns possible while keeping pieces ≥ MIN_SCALE of ideal.
 * `maxCols` caps the column count.
 * `targetR` overrides the ideal R so cell dimensions scale from a specific
 * triangle radius (used by the puzzle tray to match the board piece size).
 */
export function computeGridLayout(
  n: number,
  maxCols = 8,
  targetR?: number
): GridLayout {
  const available = window.innerWidth - BODY_MARGIN;
  const minCols = Math.min(3, n);
  const cap = Math.min(maxCols, n);

  // Scale ideal cell dimensions proportionally if a targetR is given
  const rScale = (targetR ?? IDEAL_R) / IDEAL_R;
  const idealW = IDEAL_CELL_W * rScale;
  const idealH = IDEAL_CELL_H * rScale;

  let cols = minCols;
  for (let c = cap; c >= minCols; c--) {
    if (available / (c * idealW + CANVAS_PAD * 2) >= MIN_SCALE) {
      cols = c;
      break;
    }
  }

  const canvasW = Math.min(available, cols * idealW + CANVAS_PAD * 2);
  const cellW = (canvasW - CANVAS_PAD * 2) / cols;
  const scale = cellW / idealW;
  const cellH = idealH * scale;
  const r = Math.round((targetR ?? IDEAL_R) * scale);
  const rows = Math.ceil(n / cols);
  const canvasH = Math.round(rows * cellH) + CANVAS_PAD * 2;

  return { cols, cellW, cellH, r, canvasW, canvasH, pad: CANVAS_PAD };
}

// ─── Triangular board layout (used by puzzle page) ─────────────────────────

export interface BoardLayout {
  r: number;
  s: number;    // triangle side length  (= r * √3)
  h: number;    // row height            (= 1.5 * r)
  canvasW: number;
  canvasH: number;
  padX: number;
  padY: number;
}

/**
 * Compute the board canvas size so the triangular grid of `nRows × nCols`
 * fits within the viewport. R is capped at 60px.
 *
 * Board width  = (nCols + 1) * R * √3/2 + 2 * pad
 * Board height = nRows * 1.5 * R        + 2 * pad
 */
export function computeBoardLayout(nRows: number, nCols: number, maxR = 60): BoardLayout {
  const available = window.innerWidth - BODY_MARGIN;
  const PAD_X = 20;
  const PAD_Y = 40;

  const rFromWidth =
    (available - 2 * PAD_X) / ((nCols + 1) * (Math.sqrt(3) / 2));
  const r = Math.round(Math.min(maxR, rFromWidth));
  const s = r * Math.sqrt(3);
  const h = r * 1.5;
  const canvasW = Math.round((nCols + 1) * (s / 2) + 2 * PAD_X);
  const canvasH = Math.round(nRows * h + 2 * PAD_Y);

  return { r, s, h, canvasW, canvasH, padX: PAD_X, padY: PAD_Y };
}
