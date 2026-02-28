import { ALL_PIECES } from "./pieces";
import { drawPiece, getPalette } from "./draw";
import { computeGridLayout } from "./layout";
import { Difficulty, DEV_MODE, getUtcDateKey, isDailyComplete, msUntilUtcMidnight, resetDailyProgress, incrementDevOffset, getStreakData, resetStreak } from "./daily";

function render(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): void {
  const layout = computeGridLayout(ALL_PIECES.length);

  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;

  ctx.fillStyle = getPalette().canvasBg;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

  ALL_PIECES.forEach((piece, i) => {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const cx = layout.pad + col * layout.cellW + layout.cellW / 2;
    const cy = layout.pad + row * layout.cellH + layout.cellH / 2;
    drawPiece(ctx, cx, cy, layout.r, piece);
  });
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

const THEME_KEY = "triominoes-theme";

function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle("light", light);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = light ? "☾" : "☀";
}

function initTheme(): void {
  // Inline script already applied the class; just sync the button label.
  const stored = localStorage.getItem(THEME_KEY);
  const isLight = stored === "light" ||
    (stored === null && window.matchMedia("(prefers-color-scheme: light)").matches);
  applyTheme(isLight);

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const nowLight = !document.documentElement.classList.contains("light");
      localStorage.setItem(THEME_KEY, nowLight ? "light" : "dark");
      applyTheme(nowLight);
      // Re-render the 56-tile grid if the modal is currently open.
      const modal = document.getElementById("tile-modal");
      const canvas = document.getElementById("board") as HTMLCanvasElement | null;
      if (modal && !modal.hidden && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) render(canvas, ctx);
      }
    });
  }
}

function init(): void {
  const canvas = document.getElementById("board") as HTMLCanvasElement | null;
  const modal  = document.getElementById("tile-modal") as HTMLElement | null;
  const tileBtn = document.getElementById("tile-set-btn") as HTMLButtonElement | null;

  if (!canvas) {
    console.error("Could not find required DOM elements.");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (tileBtn && modal) {
    // Re-render on every open so the canvas picks up the current theme.
    tileBtn.addEventListener("click", () => {
      render(canvas!, ctx!);
      modal.hidden = false;
    });
    modal.addEventListener("click", () => { modal.hidden = true; });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal) modal.hidden = true;
  });

  initTheme();
  updateButtonStates();
  startCountdown();

  const { streak, completedToday, streakEnded } = getStreakData();
  if (streakEnded) {
    const badge = document.createElement("div");
    badge.className = "streak-badge streak-badge--ended";
    const countEl = document.createElement("span");
    countEl.className = "streak-count";
    countEl.textContent = `${streak}-day`;
    const labelEl = document.createElement("span");
    labelEl.className = "streak-label";
    labelEl.textContent = "streak ended";
    badge.append(countEl, labelEl);
    document.body.appendChild(badge);
  } else if (streak > 0) {
    const badge = document.createElement("div");
    badge.className = "streak-badge" + (completedToday ? " streak-badge--done" : "");
    const countEl = document.createElement("span");
    countEl.className = "streak-count";
    countEl.textContent = String(streak);
    const labelEl = document.createElement("span");
    labelEl.className = "streak-label";
    labelEl.textContent = "day streak";
    badge.append(countEl, labelEl);
    document.body.appendChild(badge);
  }

  if (DEV_MODE) {
    document.body.classList.add("dev-mode");
    const banner = document.createElement("div");
    banner.className = "dev-banner";
    banner.textContent = "DEV MODE";
    document.body.appendChild(banner);

    const btn = document.createElement("button");
    btn.textContent = "Reset";
    btn.className = "btn-dev-reset";
    btn.addEventListener("click", () => {
      resetDailyProgress(getUtcDateKey());
      resetStreak();
      localStorage.removeItem("triominoes-hint-dismissed");
      localStorage.removeItem("triominoes-constraint-tip-v1");
      localStorage.removeItem(THEME_KEY);
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
    resizeTimer = setTimeout(() => { if (modal && !modal.hidden) render(canvas, ctx); }, 150);
  });
}

document.addEventListener("DOMContentLoaded", init);
