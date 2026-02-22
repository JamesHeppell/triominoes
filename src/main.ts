import { ALL_PIECES } from "./pieces";
import { drawPiece } from "./draw";
import { computeGridLayout } from "./layout";

function render(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  status: HTMLElement
): void {
  const layout = computeGridLayout(ALL_PIECES.length);

  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;

  ctx.fillStyle = "#16213e";
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

  ALL_PIECES.forEach((piece, i) => {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const cx = layout.pad + col * layout.cellW + layout.cellW / 2;
    const cy = layout.pad + row * layout.cellH + layout.cellH / 2;
    drawPiece(ctx, cx, cy, layout.r, piece);
  });

  status.textContent = `Full triomino set – ${ALL_PIECES.length} pieces`;
}

function init(): void {
  const canvas = document.getElementById("board") as HTMLCanvasElement | null;
  const status = document.getElementById("status") as HTMLElement | null;

  if (!canvas || !status) {
    console.error("Could not find required DOM elements.");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    status.textContent = "Canvas 2D not supported in this browser.";
    return;
  }

  render(canvas, ctx, status);

  let lastWidth = window.innerWidth;
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(canvas, ctx, status), 150);
  });
}

document.addEventListener("DOMContentLoaded", init);
