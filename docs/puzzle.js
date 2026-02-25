"use strict";
(() => {
  // src/pieces.ts
  function generateAllPieces() {
    const pieces2 = [];
    for (let a = 0; a <= 5; a++) {
      for (let b = a; b <= 5; b++) {
        for (let c = b; c <= 5; c++) {
          pieces2.push([a, b, c]);
        }
      }
    }
    return Object.freeze(pieces2);
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
  function drawEmptySlot(ctx, cx, cy, r, up) {
    const verts = triVertices(cx, cy, r, up);
    ctx.fillStyle = "#1e2d50";
    ctx.strokeStyle = "#5577aa";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    tracePath(ctx, verts);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawStarSlot(ctx, cx, cy, r) {
    ctx.fillStyle = "#1e2d50";
    ctx.strokeStyle = "#5577aa";
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

  // src/layout.ts
  var BODY_MARGIN = 16;
  function computeBoardLayout(nRows, nCols, maxR = 60) {
    const available = window.innerWidth - BODY_MARGIN;
    const PAD_X = 20;
    const PAD_Y = 40;
    const rFromWidth = (available - 2 * PAD_X) / ((nCols + 1) * (Math.sqrt(3) / 2));
    const r = Math.round(Math.min(maxR, rFromWidth));
    const s = r * Math.sqrt(3);
    const h = r * 1.5;
    const canvasW2 = Math.round((nCols + 1) * (s / 2) + 2 * PAD_X);
    const canvasH2 = Math.round(nRows * h + 2 * PAD_Y);
    return { r, s, h, canvasW: canvasW2, canvasH: canvasH2, padX: PAD_X, padY: PAD_Y };
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
  function seededRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 >>> 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var DEV_OFFSET_KEY = "triominoes-dev-offset";
  function getDevOffset() {
    return DEV_MODE ? parseInt(localStorage.getItem(DEV_OFFSET_KEY) ?? "0", 10) : 0;
  }
  function dailySeed(dateKey, difficulty) {
    const n = parseInt(dateKey.replace(/-/g, ""), 10);
    const d = { easy: 1, medium: 2, hard: 3 };
    return n * 10 + d[difficulty] + getDevOffset() * 1e3 >>> 0;
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
  function getDailySolveTime(dateKey, difficulty) {
    const val = loadRecord()[dateKey]?.[difficulty];
    return typeof val === "number" ? val : null;
  }
  var STREAK_KEY = "triominoes-streak-v1";
  function loadStreakData() {
    try {
      return JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") ?? { streak: 0, lastDate: "" };
    } catch {
      return { streak: 0, lastDate: "" };
    }
  }
  function updateStreak(dateKey) {
    const { streak, lastDate } = loadStreakData();
    if (lastDate === dateKey)
      return;
    const [y, m, d] = dateKey.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    const yesterdayKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
    const newStreak = lastDate === yesterdayKey ? streak + 1 : 1;
    localStorage.setItem(STREAK_KEY, JSON.stringify({ streak: newStreak, lastDate: dateKey }));
  }
  function markDailyComplete(dateKey, difficulty, solveTimeMs2) {
    const record = loadRecord();
    if (!record[dateKey])
      record[dateKey] = {};
    record[dateKey][difficulty] = solveTimeMs2 !== void 0 ? solveTimeMs2 : true;
    saveRecord(record);
    updateStreak(dateKey);
  }
  var TIMER_KEY = "triominoes-timer-v1";
  function loadTimerRecord() {
    try {
      return JSON.parse(localStorage.getItem(TIMER_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function getStoredElapsed(dateKey, difficulty) {
    return loadTimerRecord()[dateKey]?.[difficulty] ?? 0;
  }
  function saveStoredElapsed(dateKey, difficulty, elapsed) {
    const record = loadTimerRecord();
    if (!record[dateKey])
      record[dateKey] = {};
    record[dateKey][difficulty] = elapsed;
    localStorage.setItem(TIMER_KEY, JSON.stringify(record));
  }
  function clearStoredElapsed(dateKey, difficulty) {
    const record = loadTimerRecord();
    if (record[dateKey]) {
      delete record[dateKey][difficulty];
      localStorage.setItem(TIMER_KEY, JSON.stringify(record));
    }
  }
  var STATE_KEY = "triominoes-state-v1";
  function loadStateRecord() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function loadPuzzleState(dateKey, difficulty) {
    return loadStateRecord()[dateKey]?.[difficulty] ?? null;
  }
  function savePuzzleState(dateKey, difficulty, occupancy, rotations) {
    const record = loadStateRecord();
    if (!record[dateKey])
      record[dateKey] = {};
    record[dateKey][difficulty] = { occupancy: [...occupancy], rotations: [...rotations] };
    localStorage.setItem(STATE_KEY, JSON.stringify(record));
  }
  function clearPuzzleState(dateKey, difficulty) {
    const record = loadStateRecord();
    if (record[dateKey]) {
      delete record[dateKey][difficulty];
      localStorage.setItem(STATE_KEY, JSON.stringify(record));
    }
  }

  // src/puzzle.ts
  var PIECE_COUNT_RANGE = {
    easy: [4, 6],
    medium: [7, 9],
    hard: [10, 12]
  };
  var DEV_SKIP_ADJACENCY = DEV_MODE;
  var BOARD_SHAPES_FOR_COUNT = {
    4: [{ rows: 2, cols: 2 }, { rows: 1, cols: 4 }],
    5: [{ rows: 1, cols: 5 }],
    6: [{ rows: 2, cols: 3 }, { rows: 3, cols: 2 }, { rows: 1, cols: 6 }],
    7: [{ rows: 1, cols: 7 }],
    8: [{ rows: 2, cols: 4 }, { rows: 4, cols: 2 }, { rows: 1, cols: 8 }],
    9: [{ rows: 3, cols: 3 }, { rows: 1, cols: 9 }],
    10: [{ rows: 2, cols: 5 }, { rows: 1, cols: 10 }],
    11: [{ rows: 1, cols: 11 }],
    12: [{ rows: 3, cols: 4 }, { rows: 4, cols: 3 }, { rows: 2, cols: 6 }, { rows: 1, cols: 12 }]
  };
  var pieces = [];
  var pieceRotation = [];
  var boardOccupancy = [];
  var boardShape = { rows: 1, cols: 3 };
  var solvedPanelEl = null;
  var currentDateKey = "";
  var currentDifficulty = "easy";
  var solvedMarked = false;
  var timerElapsed = 0;
  var timerActiveStart = null;
  var solveTimeMs = null;
  var R = 30;
  var canvasW = 400;
  var canvasH = 400;
  var boardSectionH = 0;
  var boardSlotPos = [];
  var traySlotPos = [];
  var drag = null;
  var boardAdjacentPairs = [];
  function pointInTriangle(px, py, verts) {
    const s = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
    const d1 = s(px, py, verts[0][0], verts[0][1], verts[1][0], verts[1][1]);
    const d2 = s(px, py, verts[1][0], verts[1][1], verts[2][0], verts[2][1]);
    const d3 = s(px, py, verts[2][0], verts[2][1], verts[0][0], verts[0][1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  function toCanvas(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (canvas.width / rect.width),
      (e.clientY - rect.top) * (canvas.height / rect.height)
    ];
  }
  function computeAdjacentPairs() {
    const { rows, cols } = boardShape;
    const pairs = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if ((row + col) % 2 !== 0)
          continue;
        const i = row * cols + col;
        if (col + 1 < cols)
          pairs.push({ slotA: i, slotB: row * cols + (col + 1), type: "right" });
        if (col > 0)
          pairs.push({ slotA: i, slotB: row * cols + (col - 1), type: "left" });
        if (row + 1 < rows)
          pairs.push({ slotA: i, slotB: (row + 1) * cols + col, type: "below" });
      }
    }
    return pairs;
  }
  function adjacencyMatches(slotA, slotB, type) {
    const pA = boardOccupancy[slotA];
    const pB = boardOccupancy[slotB];
    if (pA === null || pB === null)
      return true;
    const vA = rotatedValues(pieces[pA], pieceRotation[pA]);
    const vB = rotatedValues(pieces[pB], pieceRotation[pB]);
    if (type === "right")
      return vA[0] === vB[1] && vA[1] === vB[0];
    if (type === "left")
      return vA[0] === vB[2] && vA[2] === vB[0];
    return vA[1] === vB[2] && vA[2] === vB[1];
  }
  function isPuzzleSolved() {
    if (!boardOccupancy.length || !boardOccupancy.every((p) => p !== null))
      return false;
    if (DEV_SKIP_ADJACENCY)
      return true;
    return boardAdjacentPairs.every(({ slotA, slotB, type }) => adjacencyMatches(slotA, slotB, type));
  }
  function rotationIsUp(rotation) {
    return rotation % 2 === 0;
  }
  function rotatedValues(piece, rotation) {
    const shift = rotation % 3;
    return [piece[shift], piece[(shift + 1) % 3], piece[(shift + 2) % 3]];
  }
  function generateSolution(rng) {
    const { rows, cols } = boardShape;
    const n = rows * cols;
    const genPieces = Array(n).fill(null);
    const genRots = Array(n).fill(0);
    const used = new Array(ALL_PIECES.length).fill(false);
    function fill(slot) {
      if (slot === n)
        return true;
      const row = Math.floor(slot / cols);
      const col = slot % cols;
      const isUp = (row + col) % 2 === 0;
      const validRots = isUp ? [0, 2, 4] : [1, 3, 5];
      const cands = [];
      for (let i = 0; i < ALL_PIECES.length; i++) {
        if (!used[i])
          cands.push(i);
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
            if (col > 0) {
              const nb = rotatedValues(genPieces[slot - 1], genRots[slot - 1]);
              if (v[0] !== nb[2] || v[2] !== nb[0])
                ok = false;
            }
          } else {
            if (col > 0 && ok) {
              const nb = rotatedValues(genPieces[slot - 1], genRots[slot - 1]);
              if (nb[0] !== v[1] || nb[1] !== v[0])
                ok = false;
            }
            if (row > 0 && ok) {
              const nb = rotatedValues(genPieces[(row - 1) * cols + col], genRots[(row - 1) * cols + col]);
              if (nb[1] !== v[2] || nb[2] !== v[1])
                ok = false;
            }
          }
          if (ok) {
            genPieces[slot] = ALL_PIECES[pi];
            genRots[slot] = rot;
            used[pi] = true;
            if (fill(slot + 1))
              return true;
            genPieces[slot] = null;
            used[pi] = false;
          }
        }
      }
      return false;
    }
    if (!fill(0)) {
      console.warn("generateSolution: exhausted \u2014 falling back to random pieces");
      const arr = [...ALL_PIECES];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, n);
    }
    const result = genPieces;
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  var BODY_MARGIN2 = 16;
  var TRAY_PAD = 12;
  var DIVIDER_H = 14;
  function recomputeLayout(availH) {
    const { rows, cols } = boardShape;
    const n = pieces.length;
    const available = window.innerWidth - BODY_MARGIN2;
    const BOARD_PAD_X = 20;
    const BOARD_PAD_Y = 40;
    const rFromWidth = Math.floor(
      (available - 2 * BOARD_PAD_X) / ((cols + 1) * (Math.sqrt(3) / 2))
    );
    let bestR = 10;
    for (let r = rFromWidth; r >= 10; r--) {
      const boardH = Math.round(rows * 1.5 * r + 2 * BOARD_PAD_Y);
      const cellW = r * (84 / 30);
      const cellH = r * (78 / 30);
      const tCols = Math.max(1, Math.min(n, Math.floor((available - TRAY_PAD * 2) / cellW)));
      const tRows = Math.ceil(n / tCols);
      const totalH = boardH + DIVIDER_H + 2 * TRAY_PAD + tRows * cellH;
      if (totalH <= availH) {
        bestR = r;
        break;
      }
    }
    const bl = computeBoardLayout(rows, cols, bestR);
    R = bl.r;
    const CELL_W = R * (84 / 30);
    const CELL_H = R * (78 / 30);
    const trayCols = Math.max(1, Math.min(n, Math.floor((available - TRAY_PAD * 2) / CELL_W)));
    const trayRows = Math.ceil(n / trayCols);
    const trayContentH = 2 * TRAY_PAD + trayRows * CELL_H;
    const minContentH = Math.round(rows * bl.h + 2 * BOARD_PAD_Y + DIVIDER_H + trayContentH);
    canvasW = available;
    canvasH = Math.max(minContentH, availH);
    boardSectionH = Math.round(canvasH - DIVIDER_H - trayContentH);
    const boardPadY = Math.round((boardSectionH - rows * bl.h) / 2);
    const boardOffsetX = Math.max(0, Math.round((available - bl.canvasW) / 2));
    boardSlotPos = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const up = (row + col) % 2 === 0;
        boardSlotPos.push({
          cx: boardOffsetX + bl.padX + (col + 1) * (bl.s / 2),
          cy: boardPadY + row * bl.h + (up ? 2 * bl.h / 3 : bl.h / 3),
          up
        });
      }
    }
    const trayContentW = trayCols * CELL_W;
    const trayOffsetX = Math.max(0, (available - trayContentW) / 2);
    const trayStartY = boardSectionH + DIVIDER_H;
    traySlotPos = [];
    for (let i = 0; i < n; i++) {
      const col = i % trayCols;
      const row = Math.floor(i / trayCols);
      traySlotPos.push({
        cx: trayOffsetX + col * CELL_W + CELL_W / 2,
        cy: trayStartY + TRAY_PAD + row * CELL_H + CELL_H / 2
      });
    }
  }
  function render(ctx) {
    const isSolved = solvedMarked && boardOccupancy.length > 0 && boardOccupancy.every((p) => p !== null);
    const renderH = isSolved ? boardSectionH : canvasH;
    if (ctx.canvas.height !== renderH)
      ctx.canvas.height = renderH;
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvasW, renderH);
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
      for (const { slotA, slotB, type } of boardAdjacentPairs) {
        if (boardOccupancy[slotA] === null || boardOccupancy[slotB] === null)
          continue;
        if (adjacencyMatches(slotA, slotB, type))
          continue;
        const { cx, cy } = boardSlotPos[slotA];
        const verts = triVertices(cx, cy, R, true);
        const [v1, v2] = type === "right" ? [verts[0], verts[1]] : type === "left" ? [verts[0], verts[2]] : [verts[1], verts[2]];
        const inset = 0.1;
        const i1 = [v1[0] + inset * (v2[0] - v1[0]), v1[1] + inset * (v2[1] - v1[1])];
        const i2 = [v2[0] - inset * (v2[0] - v1[0]), v2[1] - inset * (v2[1] - v1[1])];
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
        ctx.restore();
      }
    }
    if (!isSolved) {
      const divY = boardSectionH + 8;
      ctx.fillStyle = "#e94560";
      ctx.fillRect(16, divY, canvasW - 32, 2);
      for (let i = 0; i < pieces.length; i++) {
        const { cx, cy } = traySlotPos[i];
        const isOnBoard = boardOccupancy.some((p) => p === i);
        const isDragging = drag?.pieceIdx === i;
        if (!isOnBoard && !isDragging) {
          drawPiece(ctx, cx, cy, R, rotatedValues(pieces[i], pieceRotation[i]), rotationIsUp(pieceRotation[i]));
        } else {
          drawStarSlot(ctx, cx, cy, R);
        }
      }
      if (drag) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;
        const dRot = pieceRotation[drag.pieceIdx];
        drawPiece(ctx, drag.x, drag.y, R, rotatedValues(pieces[drag.pieceIdx], dRot), rotationIsUp(dRot));
        ctx.restore();
      }
    }
    if (solvedPanelEl)
      solvedPanelEl.hidden = !isSolved;
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
  function hitBoard(x, y) {
    for (let i = 0; i < boardSlotPos.length; i++) {
      const { cx, cy, up } = boardSlotPos[i];
      if (pointInTriangle(x, y, triVertices(cx, cy, R, up)))
        return i;
    }
    return -1;
  }
  function hitTray(x, y) {
    for (let i = 0; i < pieces.length; i++) {
      if (boardOccupancy.some((p) => p === i))
        continue;
      if (drag?.pieceIdx === i)
        continue;
      const { cx, cy } = traySlotPos[i];
      if (pointInTriangle(x, y, triVertices(cx, cy, R, true)))
        return i;
      if (pointInTriangle(x, y, triVertices(cx, cy, R, false)))
        return i;
    }
    return -1;
  }
  function hitOccupiedBoard(x, y) {
    for (let i = 0; i < boardSlotPos.length; i++) {
      if (boardOccupancy[i] === null)
        continue;
      const { cx, cy, up } = boardSlotPos[i];
      if (pointInTriangle(x, y, triVertices(cx, cy, R, up)))
        return i;
    }
    return -1;
  }
  function snapTarget(x, y) {
    for (let i = 0; i < boardSlotPos.length; i++) {
      if (boardOccupancy[i] !== null)
        continue;
      const { cx, cy, up } = boardSlotPos[i];
      if (pointInTriangle(x, y, triVertices(cx, cy, R, up)))
        return i;
    }
    let best = -1;
    let bestD = R * 1.2;
    for (let i = 0; i < boardSlotPos.length; i++) {
      if (boardOccupancy[i] !== null)
        continue;
      const { cx, cy } = boardSlotPos[i];
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function attachPointerEvents(canvas, ctx) {
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const [x, y] = toCanvas(canvas, e);
      const bi = hitBoard(x, y);
      if (bi !== -1 && boardOccupancy[bi] !== null) {
        drag = { pieceIdx: boardOccupancy[bi], fromBoard: bi, x, y, startX: x, startY: y };
        boardOccupancy[bi] = null;
        canvas.setPointerCapture(e.pointerId);
        render(ctx);
        return;
      }
      const ti = hitTray(x, y);
      if (ti !== -1) {
        drag = { pieceIdx: ti, fromBoard: null, x, y, startX: x, startY: y };
        canvas.setPointerCapture(e.pointerId);
        render(ctx);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag)
        return;
      e.preventDefault();
      const [x, y] = toCanvas(canvas, e);
      drag.x = x;
      drag.y = y;
      render(ctx);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!drag)
        return;
      const [x, y] = toCanvas(canvas, e);
      const { pieceIdx, fromBoard, startX, startY } = drag;
      drag = null;
      if (Math.hypot(x - startX, y - startY) < 8) {
        pieceRotation[pieceIdx] = (pieceRotation[pieceIdx] + 1) % 6;
        if (fromBoard !== null)
          boardOccupancy[fromBoard] = pieceIdx;
        checkCompletion();
        render(ctx);
        return;
      }
      const swapSlot = hitOccupiedBoard(x, y);
      if (swapSlot !== -1) {
        const displacedIdx = boardOccupancy[swapSlot];
        const slotUp = boardSlotPos[swapSlot].up;
        if (rotationIsUp(pieceRotation[pieceIdx]) !== slotUp) {
          pieceRotation[pieceIdx] = (pieceRotation[pieceIdx] + 3) % 6;
        }
        boardOccupancy[swapSlot] = pieceIdx;
        if (fromBoard !== null) {
          const fromUp = boardSlotPos[fromBoard].up;
          if (rotationIsUp(pieceRotation[displacedIdx]) !== fromUp) {
            pieceRotation[displacedIdx] = (pieceRotation[displacedIdx] + 3) % 6;
          }
          boardOccupancy[fromBoard] = displacedIdx;
        }
      } else {
        const target = snapTarget(x, y);
        if (target !== -1) {
          const slotUp = boardSlotPos[target].up;
          if (rotationIsUp(pieceRotation[pieceIdx]) !== slotUp) {
            pieceRotation[pieceIdx] = (pieceRotation[pieceIdx] + 3) % 6;
          }
          boardOccupancy[target] = pieceIdx;
        } else if (y >= boardSectionH) {
        } else if (fromBoard !== null) {
          boardOccupancy[fromBoard] = pieceIdx;
        }
      }
      checkCompletion();
      render(ctx);
    });
    canvas.addEventListener("pointercancel", () => {
      if (!drag)
        return;
      const { pieceIdx, fromBoard } = drag;
      drag = null;
      if (fromBoard !== null)
        boardOccupancy[fromBoard] = pieceIdx;
      render(ctx);
    });
  }
  function updateSolvedPanel() {
    const difficulties = ["easy", "medium", "hard"];
    for (const d of difficulties) {
      const btn = document.getElementById(`solved-btn-${d}`);
      if (!btn)
        continue;
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
    const allDone = difficulties.every((d) => isDailyComplete(currentDateKey, d));
    const subEl = document.getElementById("solved-sub");
    const navEl = document.getElementById("solved-nav");
    const timeEl = document.getElementById("solve-time");
    if (subEl)
      subEl.textContent = allDone ? "You've solved all of today's puzzles!" : "Try a different difficulty:";
    if (navEl)
      navEl.hidden = allDone;
    if (timeEl)
      timeEl.textContent = solveTimeMs !== null ? `Solved in ${formatSolveTime(solveTimeMs)}` : "";
  }
  function getElapsed() {
    return timerElapsed + (timerActiveStart !== null ? Date.now() - timerActiveStart : 0);
  }
  function pauseTimer() {
    if (timerActiveStart === null)
      return;
    timerElapsed += Date.now() - timerActiveStart;
    timerActiveStart = null;
    if (!solvedMarked)
      saveStoredElapsed(currentDateKey, currentDifficulty, timerElapsed);
  }
  function resumeTimer() {
    if (timerActiveStart !== null || solvedMarked)
      return;
    timerActiveStart = Date.now();
  }
  function formatSolveTime(ms) {
    const totalSecs = Math.floor(ms / 1e3);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0)
      return `${secs}s`;
    return `${mins}m ${secs}s`;
  }
  function showReadyOverlay() {
    const main = document.querySelector(".puzzle-main");
    if (!main) {
      resumeTimer();
      return;
    }
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
  function checkCompletion() {
    if (solvedMarked)
      return;
    savePuzzleState(currentDateKey, currentDifficulty, boardOccupancy, pieceRotation);
    if (isPuzzleSolved()) {
      solvedMarked = true;
      solveTimeMs = getElapsed();
      timerActiveStart = null;
      clearStoredElapsed(currentDateKey, currentDifficulty);
      clearPuzzleState(currentDateKey, currentDifficulty);
      markDailyComplete(currentDateKey, currentDifficulty, solveTimeMs);
    }
  }
  function init() {
    if (DEV_MODE) {
      const banner = document.createElement("div");
      banner.className = "dev-banner";
      banner.textContent = "DEV MODE";
      document.body.appendChild(banner);
    }
    const params = new URLSearchParams(window.location.search);
    const difficulty = params.get("d") ?? "easy";
    const titleEl = document.getElementById("puzzle-title");
    if (titleEl) {
      titleEl.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    }
    solvedPanelEl = document.getElementById("solved-panel");
    const canvas = document.getElementById("puzzle-canvas");
    if (!canvas) {
      console.error("No canvas element found.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;
    currentDateKey = getUtcDateKey();
    currentDifficulty = difficulty;
    solvedMarked = false;
    solveTimeMs = null;
    timerElapsed = getStoredElapsed(currentDateKey, difficulty);
    timerActiveStart = Date.now();
    const rng = seededRng(dailySeed(currentDateKey, difficulty));
    const [min, max] = PIECE_COUNT_RANGE[difficulty];
    const count = min + Math.floor(rng() * (max - min + 1));
    const shapes = BOARD_SHAPES_FOR_COUNT[count];
    boardShape = shapes[Math.floor(rng() * shapes.length)];
    boardAdjacentPairs = computeAdjacentPairs();
    pieces = generateSolution(rng);
    pieceRotation = Array(pieces.length).fill(0);
    boardOccupancy = Array(boardShape.rows * boardShape.cols).fill(null);
    const savedState = loadPuzzleState(currentDateKey, difficulty);
    if (savedState && savedState.occupancy.length === boardOccupancy.length && savedState.rotations.length === pieceRotation.length) {
      boardOccupancy = savedState.occupancy;
      pieceRotation = savedState.rotations;
    }
    const redraw = () => {
      const canvasOffsetY = canvas.getBoundingClientRect().top + window.scrollY;
      const availH = Math.max(150, window.innerHeight - canvasOffsetY - 16);
      recomputeLayout(availH);
      canvas.width = canvasW;
      canvas.height = canvasH;
      render(ctx);
    };
    redraw();
    attachPointerEvents(canvas, ctx);
    const shareBtn = document.getElementById("share-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
        const label = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
        const homeUrl = window.location.origin + window.location.pathname.replace("puzzle.html", "index.html");
        const timeStr = solveTimeMs !== null ? ` in ${formatSolveTime(solveTimeMs)}` : "";
        const text = `I solved today's Triominoes puzzle (${label})${timeStr} \u{1F389}`;
        try {
          if (navigator.share) {
            await navigator.share({ title: "Triominoes", text, url: homeUrl });
          } else {
            await navigator.clipboard.writeText(`${text}
${homeUrl}`);
            shareBtn.textContent = "Copied!";
            setTimeout(() => {
              shareBtn.textContent = "Share result";
            }, 2e3);
          }
        } catch {
        }
      });
    }
    if (isDailyComplete(currentDateKey, difficulty)) {
      solvedMarked = true;
      solveTimeMs = getDailySolveTime(currentDateKey, difficulty);
      for (let i = 0; i < boardOccupancy.length; i++) {
        boardOccupancy[i] = i;
        if (!boardSlotPos[i].up)
          pieceRotation[i] = 3;
      }
      render(ctx);
    } else if (timerElapsed >= 1e4) {
      pauseTimer();
      showReadyOverlay();
    } else {
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
      if (!solvedMarked)
        savePuzzleState(currentDateKey, currentDifficulty, boardOccupancy, pieceRotation);
    });
    let lastWidth = window.innerWidth;
    let resizeTimer;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth)
        return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 150);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
