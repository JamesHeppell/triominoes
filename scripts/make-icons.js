#!/usr/bin/env node
// Generates docs/icon-192.png and docs/icon-512.png
// Uses only Node.js built-ins — no extra packages needed.
// Run once: node scripts/make-icons.js
'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ─── Minimal PNG encoder ─────────────────────────────────────────────────────

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA

  // Build raw scanlines (filter byte 0 = None prepended to each row)
  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (1 + w * 4) + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function inTriangle(px, py, x0, y0, x1, y1, x2, y2) {
  const s = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = s(px, py, x0, y0, x1, y1);
  const d2 = s(px, py, x1, y1, x2, y2);
  const d3 = s(px, py, x2, y2, x0, y0);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx*dx + dy*dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / l2));
  return Math.hypot(px - ax - t*dx, py - ay - t*dy);
}

// ─── Icon drawing ─────────────────────────────────────────────────────────────

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Game colours
  const BG     = [22,  33,  62,  255]; // #16213e — dark navy
  const FILL   = [255, 248, 238, 255]; // #FFF8EE — cream (same as tiles)
  const STROKE = [233, 69,  96,  255]; // #e94560 — red outline
  const LINE   = [85,  119, 170, 255]; // #5577aa — inner dashed lines

  // Equilateral triangle pointing up, circumradius R, centred at (cx, cy)
  const R  = size * 0.40;
  const cx = size / 2;
  const cy = size / 2 + R * 0.06; // tiny downward shift for visual balance

  const ax = cx + R * Math.cos(-Math.PI / 2);         // top apex
  const ay = cy + R * Math.sin(-Math.PI / 2);
  const bx = cx + R * Math.cos(Math.PI / 6);          // bottom-right
  const by = cy + R * Math.sin(Math.PI / 6);
  const ccx = cx + R * Math.cos(5 * Math.PI / 6);     // bottom-left
  const ccy = cy + R * Math.sin(5 * Math.PI / 6);

  const strokeW = Math.max(2.5, size * 0.028);

  // 4×4 supersampling for smooth edges
  const SAMPLES = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;

          const inside = inTriangle(px, py, ax, ay, bx, by, ccx, ccy);
          const dEdge  = Math.min(
            distToSeg(px, py, ax, ay, bx, by),
            distToSeg(px, py, bx, by, ccx, ccy),
            distToSeg(px, py, ccx, ccy, ax, ay)
          );

          let col;
          if (dEdge < strokeW) col = STROKE;
          else if (inside)     col = FILL;
          else                 col = BG;

          r += col[0]; g += col[1]; b += col[2]; a += col[3];
        }
      }
      const n = SAMPLES * SAMPLES;
      const idx = (y * size + x) * 4;
      pixels[idx] = r/n; pixels[idx+1] = g/n; pixels[idx+2] = b/n; pixels[idx+3] = a/n;
    }
  }

  // Draw the three medians as dashed lines (matching the logo's inner markings)
  // Each median runs from a vertex to the midpoint of the opposite edge.
  const medians = [
    [ax,  ay,  (bx+ccx)/2, (by+ccy)/2],
    [bx,  by,  (ax+ccx)/2, (ay+ccy)/2],
    [ccx, ccy, (ax+bx)/2,  (ay+by)/2 ],
  ];

  const dashLen  = size * 0.028;
  const gapLen   = dashLen * 1.6;
  const lineR    = Math.max(0.9, size * 0.009);
  const innerPad = strokeW + 1; // don't draw over the outline

  for (const [lx0, ly0, lx1, ly1] of medians) {
    const totalLen = Math.hypot(lx1-lx0, ly1-ly0);
    let along = 0, drawing = true;

    while (along < totalLen) {
      const segEnd = along + (drawing ? dashLen : gapLen);
      if (drawing) {
        const steps = Math.ceil((Math.min(segEnd, totalLen) - along) * 2);
        for (let i = 0; i <= steps; i++) {
          const t   = (along + (Math.min(segEnd, totalLen) - along) * i / steps) / totalLen;
          const lx  = lx0 + t * (lx1 - lx0);
          const ly  = ly0 + t * (ly1 - ly0);
          const r   = Math.ceil(lineR + 1);

          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = Math.round(lx + dx), ny = Math.round(ly + dy);
              if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
              if (!inTriangle(nx, ny, ax, ay, bx, by, ccx, ccy)) continue;
              const dEdge = Math.min(
                distToSeg(nx, ny, ax, ay, bx, by),
                distToSeg(nx, ny, bx, by, ccx, ccy),
                distToSeg(nx, ny, ccx, ccy, ax, ay)
              );
              if (dEdge < innerPad) continue; // don't overwrite the outline

              const dist  = Math.hypot(dx, dy);
              const alpha = Math.max(0, Math.min(1, lineR + 1 - dist));
              if (alpha <= 0) continue;

              const idx = (ny * size + nx) * 4;
              pixels[idx]   = Math.round(pixels[idx]   * (1-alpha) + LINE[0] * alpha);
              pixels[idx+1] = Math.round(pixels[idx+1] * (1-alpha) + LINE[1] * alpha);
              pixels[idx+2] = Math.round(pixels[idx+2] * (1-alpha) + LINE[2] * alpha);
            }
          }
        }
      }
      along = segEnd;
      drawing = !drawing;
    }
  }

  return Buffer.from(pixels.buffer);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'docs');
for (const size of [192, 512]) {
  const rgba = drawIcon(size);
  const png  = encodePng(size, size, rgba);
  const dest = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`  icon-${size}.png  (${(png.length / 1024).toFixed(1)} KB)`);
}
console.log('Done.');
