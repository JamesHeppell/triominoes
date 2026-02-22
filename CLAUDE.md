# Triominoes — Project Context

## What this is
A mobile-first browser puzzle game based on the real triominoes tile set.
Targeted at GitHub Pages (static files only — no server, no build step needed by the host).

## Tech stack
- **TypeScript** compiled with **esbuild** (no framework, no runtime dependencies)
- **HTML5 Canvas 2D** for all rendering — no DOM elements for pieces or slots
- **Pointer Events API** for drag-and-drop (works on both touch and mouse)
- Build: `npm run build` → bundles into `dist/` and copies HTML/CSS there
- Dev:   `npm run dev`   → same but in watch mode

## File structure
```
index.html          Main page — shows all 56 pieces + difficulty nav buttons
puzzle.html         Puzzle page — single canvas with board + tray
style.css           Shared CSS (both pages)
src/
  pieces.ts         Piece data model — PieceValues type, ALL_PIECES const (56 pieces)
  draw.ts           Canvas drawing primitives (triVertices, drawPiece, drawEmptySlot, drawStarSlot)
  layout.ts         Responsive layout maths (computeGridLayout, computeBoardLayout)
  main.ts           Main page logic — renders 56-piece grid
  puzzle.ts         Puzzle page logic — board, tray, drag-and-drop, rotation
dist/               Build output (gitignored in spirit; deployed to GitHub Pages)
```

## Piece model
- `PieceValues = readonly [number, number, number]` — three corner values 0–5 in canonical (a ≤ b ≤ c) order
- 56 total pieces (multiset combinations with repetition: C(8,3))
- Corners stored clockwise from the top vertex in canonical form

## Rotation model (6 orientations)
- `rotation` ∈ {0,1,2,3,4,5}, incremented by 1 on each tap (cycles)
- `rotationIsUp(r)` → `r % 2 === 0` (0,2,4 = ▲; 1,3,5 = ▽)
- `rotatedValues(piece, r)` → shifts which corner is "top": `shift = r % 3`
  - returns `[piece[shift], piece[(shift+1)%3], piece[(shift+2)%3]]`
- When dropping onto a board slot, rotation is auto-adapted if up/down doesn't match:
  `pieceRotation[i] = (rotation + 3) % 6` (flips orientation, preserves corner shift)

## Board geometry
- Triangular grid: alternating ▲/▽ — slot `(row, col)` is up when `(row+col) % 2 === 0`
- Centroid y: `padY + row * h + (up ? 2h/3 : h/3)`, x: `padX + (col+1) * (s/2)`
- `R` = circumradius (capped at 60px); `s = R√3` (side); `h = 1.5R` (row height)
- `computeBoardLayout(rows, cols)` in `layout.ts` returns `{ r, s, h, canvasW, canvasH, padX, padY }`

## Drawing
- `triVertices(cx, cy, r, up)` — returns 3 vertices `[number, number][]`, vertex 0 is always the apex
- `drawPiece(ctx, cx, cy, r, values, up)` — cream fill (#FFF8EE), black labels at 42% of centroid→vertex
- `drawEmptySlot(ctx, cx, cy, r, up)` — dashed blue outline (#5577aa), dark fill (#1e2d50)
- `drawStarSlot(ctx, cx, cy, r)` — ▲+▽ overlaid (used for tray ghost slots when piece is elsewhere)
- `TEXT_FRAC = 0.42` — label position; keeps text inside since inradius = R/2 and 0.42 < 0.5

## Puzzle page state (module-level, persists across resize)
- `pieces: PieceValues[]` — randomly selected on load
- `pieceRotation: number[]` — current rotation (0–5) per piece, all start at 0
- `boardOccupancy: (number|null)[]` — which pieceIdx is in each board slot (null = empty)
- `drag: DragState | null` — current drag including `startX/startY` for tap detection

## Difficulty settings
| Difficulty | Pieces | Board shape |
|------------|--------|-------------|
| easy       | 3      | 1 row × 3 cols |
| medium     | 5      | 1 row × 5 cols |
| hard       | 10     | 2 rows × 5 cols |

## Interaction
- **Drag**: `pointerdown` on piece → `pointermove` → `pointerup` snaps to nearest empty slot
  - Snap: exact point-in-triangle first, then nearest centroid within 1.2R
  - Drop in tray area (y ≥ boardSectionH) → returns piece to tray
  - Drop on board with no valid slot → restores to original slot
- **Tap** (movement < 8px): rotates piece by one step (+1 mod 6), restores to origin slot

## What's been built
- [x] Main page displaying all 56 pieces in a responsive grid
- [x] Easy/Medium/Hard difficulty nav on main page
- [x] Puzzle page with triangular board + tray on a single canvas
- [x] Drag-and-drop between tray and board (and back)
- [x] Tap-to-rotate (6 orientations, 60° each)
- [x] Star ghost slot in tray when a piece is placed on the board

## What's planned next
- [ ] **Puzzle constraints** — generated constraints that define a unique (or near-unique) solution
  - Constraint types: corners that sum to N, corners that are all equal, corners that are all different
  - Visual: colour-coded arcs drawn at the relevant corners of each board slot
  - Constraint colours: e.g. orange = sum, green = all-equal, purple = all-different
  - Difficulty tuning: easy = fewer/looser constraints (more valid solutions); hard = tight constraints (few solutions)
  - Puzzle generation: work backwards from a valid random placement → derive constraints → verify uniqueness
  - Win detection: check all constraints after every drop → show "Solved!" overlay when all pass
- [ ] Possibly: a "new puzzle" button to regenerate without leaving the page
- [ ] Possibly: timer or move counter

## CSS / layout notes
- `BODY_MARGIN = 16` in puzzle.ts must match `padding: 1rem 8px` in style.css (8px × 2 sides)
- `touch-action: none` on `#puzzle-canvas` (drag); `touch-action: pan-y` on `#board` (main page scroll)
- Canvas dimensions are set in JS (`canvas.width/height`), not CSS
- Resize handler is width-only (ignores height-only changes, e.g. mobile keyboard)
