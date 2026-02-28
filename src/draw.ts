import { PieceValues } from "./pieces";

const TEXT_FRAC = 0.42;

/** Returns canvas colors matching the current light/dark theme. */
export function getPalette(): { canvasBg: string; slotFill: string; slotStroke: string; solvedOverlay: string } {
  const light = document.documentElement.classList.contains("light");
  return {
    canvasBg:     light ? "#e8eef8" : "#16213e",
    slotFill:     light ? "#c8d5e8" : "#1e2d50",
    slotStroke:   light ? "#4a6595" : "#5577aa",
    solvedOverlay: light ? "rgba(220,228,242,0.85)" : "rgba(22,33,62,0.78)",
  };
}

/** Compute the three vertices of an equilateral triangle centred at (cx, cy).
 *  up=true → apex at top (▲), up=false → apex at bottom (▽). */
export function triVertices(
  cx: number,
  cy: number,
  r: number,
  up: boolean
): [number, number][] {
  const start = up ? -Math.PI / 2 : Math.PI / 2;
  return [0, 1, 2].map((i) => [
    cx + r * Math.cos(start + (i * 2 * Math.PI) / 3),
    cy + r * Math.sin(start + (i * 2 * Math.PI) / 3),
  ]) as [number, number][];
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  verts: [number, number][]
): void {
  ctx.beginPath();
  ctx.moveTo(verts[0][0], verts[0][1]);
  ctx.lineTo(verts[1][0], verts[1][1]);
  ctx.lineTo(verts[2][0], verts[2][1]);
  ctx.closePath();
}

/** Draw a filled triomino piece (cream background, black corner numbers). */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  values: PieceValues,
  up = true
): void {
  const verts = triVertices(cx, cy, r, up);

  ctx.fillStyle = "#FFF8EE";
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1.5;
  tracePath(ctx, verts);
  ctx.fill();
  ctx.stroke();

  const fontSize = Math.max(9, Math.round(r * 0.43));
  ctx.fillStyle = "#111";
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 3; i++) {
    const [vx, vy] = verts[i];
    ctx.fillText(
      String(values[i]),
      cx + (vx - cx) * TEXT_FRAC,
      cy + (vy - cy) * TEXT_FRAC
    );
  }
}

/** Draw an empty board slot (dashed outline, theme-aware fill). */
export function drawEmptySlot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  up: boolean
): void {
  const { slotFill, slotStroke } = getPalette();
  const verts = triVertices(cx, cy, r, up);

  ctx.fillStyle = slotFill;
  ctx.strokeStyle = slotStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  tracePath(ctx, verts);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Draw a tray ghost slot — a star (▲ + ▽ overlaid) with dashed outlines. */
export function drawStarSlot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number
): void {
  const { slotFill, slotStroke } = getPalette();
  ctx.fillStyle = slotFill;
  ctx.strokeStyle = slotStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  tracePath(ctx, triVertices(cx, cy, r, false));
  ctx.fill();

  tracePath(ctx, triVertices(cx, cy, r, true));
  ctx.stroke();
  tracePath(ctx, triVertices(cx, cy, r, false));
  ctx.stroke();

  ctx.setLineDash([]);
}
