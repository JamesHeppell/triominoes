import { ALL_PIECES } from "./pieces";
import { drawPiece } from "./draw";
import { computeGridLayout } from "./layout";
import { Difficulty, DEV_MODE, getUtcDateKey, isDailyComplete, msUntilUtcMidnight, resetDailyProgress, incrementDevOffset } from "./daily";

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

function updateButtonStates(): void {
  const dateKey = getUtcDateKey();
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  difficulties.forEach(d => {
    const btn = document.getElementById(`btn-${d}`);
    if (btn && isDailyComplete(dateKey, d)) {
      btn.classList.add("btn-completed");
    }
  });

  const allDone = difficulties.every(d => isDailyComplete(dateKey, d));
  const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement | null;
  if (resetBtn) {
    resetBtn.hidden = !allDone;
    resetBtn.addEventListener("click", () => {
      resetDailyProgress(dateKey);
      window.location.reload();
    });
  }
}

function startCountdown(): void {
  const el = document.getElementById("countdown");
  if (!el) return;

  function tick(): void {
    const ms = msUntilUtcMidnight();
    if (ms <= 0) {
      window.location.reload();
      return;
    }
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    el!.textContent = [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  }

  tick();
  setInterval(tick, 1000);
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
  updateButtonStates();
  startCountdown();

  if (DEV_MODE) {
    const btn = document.createElement("button");
    btn.textContent = "Reset";
    btn.className = "btn-dev-reset";
    btn.addEventListener("click", () => {
      resetDailyProgress(getUtcDateKey());
      incrementDevOffset();
      window.location.reload();
    });
    document.body.appendChild(btn);
  }

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
