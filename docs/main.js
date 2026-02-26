"use strict";
(() => {
  // src/pieces.ts
  function generateAllPieces() {
    const pieces = [];
    for (let a = 0; a <= 5; a++) {
      for (let b = a; b <= 5; b++) {
        for (let c = b; c <= 5; c++) {
          pieces.push([a, b, c]);
        }
      }
    }
    return Object.freeze(pieces);
  }
  var ALL_PIECES = generateAllPieces();

  // src/draw.ts
  var TEXT_FRAC = 0.42;
  function triVertices(cx, cy, r, up) {
    const start = up ? -Math.PI / 2 : Math.PI / 2;
    return [0, 1, 2].map((i) => [
      cx + r * Math.cos(start + i * 2 * Math.PI / 3),
      cy + r * Math.sin(start + i * 2 * Math.PI / 3)
    ]);
  }
  function tracePath(ctx, verts) {
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    ctx.lineTo(verts[1][0], verts[1][1]);
    ctx.lineTo(verts[2][0], verts[2][1]);
    ctx.closePath();
  }
  function drawPiece(ctx, cx, cy, r, values, up = true) {
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

  // src/layout.ts
  var BODY_MARGIN = 16;
  var CANVAS_PAD = 12;
  var IDEAL_CELL_W = 84;
  var IDEAL_CELL_H = 78;
  var IDEAL_R = 30;
  var MIN_SCALE = 0.7;
  function computeGridLayout(n, maxCols = 8, targetR) {
    const available = window.innerWidth - BODY_MARGIN;
    const minCols = Math.min(3, n);
    const cap = Math.min(maxCols, n);
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

  // src/daily.ts
  var DEV_MODE = false;
  function getUtcDateKey() {
    const now = /* @__PURE__ */ new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function msUntilUtcMidnight() {
    const now = /* @__PURE__ */ new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return next - now.getTime();
  }
  var DEV_OFFSET_KEY = "triominoes-dev-offset";
  function getDevOffset() {
    return DEV_MODE ? parseInt(localStorage.getItem(DEV_OFFSET_KEY) ?? "0", 10) : 0;
  }
  function incrementDevOffset() {
    if (!DEV_MODE)
      return;
    localStorage.setItem(DEV_OFFSET_KEY, String(getDevOffset() + 1));
  }
  var STORAGE_KEY = "triominoes-daily-v1";
  function loadRecord() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function saveRecord(record) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  function isDailyComplete(dateKey, difficulty) {
    const val = loadRecord()[dateKey]?.[difficulty];
    return val === true || typeof val === "number";
  }
  var STREAK_KEY = "triominoes-streak-v1";
  function loadStreakData() {
    try {
      return JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") ?? { streak: 0, lastDate: "" };
    } catch {
      return { streak: 0, lastDate: "" };
    }
  }
  function getStreakData() {
    const { streak, lastDate } = loadStreakData();
    const today = getUtcDateKey();
    if (lastDate === today)
      return { streak, completedToday: true, streakEnded: false };
    const [y, m, d] = today.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    const yesterdayKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
    const streakEnded = streak > 0 && lastDate !== "" && lastDate !== yesterdayKey;
    return { streak, completedToday: false, streakEnded };
  }
  function resetStreak() {
    localStorage.removeItem(STREAK_KEY);
  }
  function resetDailyProgress(dateKey) {
    const record = loadRecord();
    delete record[dateKey];
    saveRecord(record);
    resetTimerProgress(dateKey);
    resetStateProgress(dateKey);
  }
  var TIMER_KEY = "triominoes-timer-v1";
  function loadTimerRecord() {
    try {
      return JSON.parse(localStorage.getItem(TIMER_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function resetTimerProgress(dateKey) {
    const record = loadTimerRecord();
    delete record[dateKey];
    localStorage.setItem(TIMER_KEY, JSON.stringify(record));
  }
  var STATE_KEY = "triominoes-state-v1";
  function loadStateRecord() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function resetStateProgress(dateKey) {
    const record = loadStateRecord();
    delete record[dateKey];
    localStorage.setItem(STATE_KEY, JSON.stringify(record));
  }

  // src/main.ts
  function render(canvas, ctx) {
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
  }
  function updateButtonStates() {
    const dateKey = getUtcDateKey();
    const difficulties = ["easy", "medium", "hard"];
    difficulties.forEach((d) => {
      const btn = document.getElementById(`btn-${d}`);
      if (btn && isDailyComplete(dateKey, d)) {
        btn.classList.add("btn-completed");
      }
    });
    const allDone = difficulties.every((d) => isDailyComplete(dateKey, d));
    const resetBtn = document.getElementById("reset-btn");
    if (resetBtn) {
      resetBtn.hidden = !allDone;
      resetBtn.addEventListener("click", () => {
        resetDailyProgress(dateKey);
        window.location.reload();
      });
    }
  }
  function startCountdown() {
    const el = document.getElementById("countdown");
    if (!el)
      return;
    function tick() {
      const ms = msUntilUtcMidnight();
      if (ms <= 0) {
        window.location.reload();
        return;
      }
      const totalSec = Math.floor(ms / 1e3);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor(totalSec % 3600 / 60);
      const s = totalSec % 60;
      el.textContent = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
    }
    tick();
    setInterval(tick, 1e3);
  }
  function init() {
    const canvas = document.getElementById("board");
    const detailsEl = document.getElementById("tile-set");
    if (!canvas) {
      console.error("Could not find required DOM elements.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;
    let rendered = false;
    function renderOnce() {
      if (!rendered) {
        render(canvas, ctx);
        rendered = true;
      }
    }
    if (detailsEl) {
      detailsEl.addEventListener("toggle", () => {
        if (detailsEl.open)
          renderOnce();
      });
    }
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
        incrementDevOffset();
        window.location.reload();
      });
      document.body.appendChild(btn);
    }
    let lastWidth = window.innerWidth;
    let resizeTimer;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth)
        return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!detailsEl || detailsEl.open)
          render(canvas, ctx);
      }, 150);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
