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
    return loadRecord()[dateKey]?.[difficulty] === true;
  }
  function resetDailyProgress(dateKey) {
    const record = loadRecord();
    delete record[dateKey];
    saveRecord(record);
  }

  // src/main.ts
  function render(canvas, ctx, status) {
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
    status.textContent = `Full triomino set \u2013 ${ALL_PIECES.length} pieces`;
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
    const status = document.getElementById("status");
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
    let lastWidth = window.innerWidth;
    let resizeTimer;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth)
        return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(canvas, ctx, status), 150);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
