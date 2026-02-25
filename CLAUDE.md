# Triominoes — Project Context

## What this is
A mobile-first browser puzzle game based on the real triominoes tile set.
Targeted at GitHub Pages (static files only — no server, no build step needed by the host).

## Tech stack
- **TypeScript** compiled with **esbuild** (no framework, no runtime dependencies)
- **HTML5 Canvas 2D** for all rendering — no DOM elements for pieces or slots
- **Pointer Events API** for drag-and-drop (works on both touch and mouse)
- Build: `npm run build` → bundles into `docs/` and copies HTML/CSS there
- Dev:   `npm run dev`   → same but in watch mode

## File structure
```
index.html          Main page — shows all 56 pieces + difficulty nav buttons
puzzle.html         Puzzle page — single canvas with board + tray
rules.html          Static rules/tutorial page — SVG diagrams, no JS
style.css           Shared CSS (all pages)
src/
  pieces.ts         Piece data model — PieceValues type, ALL_PIECES const (56 pieces)
  draw.ts           Canvas drawing primitives (triVertices, drawPiece, drawEmptySlot, drawStarSlot)
  layout.ts         Responsive layout maths (computeGridLayout, computeBoardLayout)
  main.ts           Main page logic — renders 56-piece grid
  puzzle.ts         Puzzle page logic — board, tray, drag-and-drop, rotation, generation
  daily.ts          Daily seed, completion tracking (localStorage)
docs/               Build output — deployed to GitHub Pages
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
  - ▲ (up=true):  v[0]=top-apex, v[1]=bottom-right, v[2]=bottom-left
  - ▽ (up=false): v[0]=bottom-apex, v[1]=top-left, v[2]=top-right
- `drawPiece(ctx, cx, cy, r, values, up)` — cream fill (#FFF8EE), black labels at 42% of centroid→vertex
- `drawEmptySlot(ctx, cx, cy, r, up)` — dashed blue outline (#5577aa), dark fill (#1e2d50)
- `drawStarSlot(ctx, cx, cy, r)` — ▲+▽ overlaid (used for tray ghost slots when piece is elsewhere)
- `TEXT_FRAC = 0.42` — label position; keeps text inside since inradius = R/2 and 0.42 < 0.5

## Adjacency matching (core rule)
When two placed pieces share an edge, their corner values at the two shared vertices must match —
identical to dominoes but with two matching numbers per edge instead of one.

Shared corners per edge direction (▲ = slotA, ▽ = slotB — always, by convention):
| Direction | ▲ vertex | ▽ vertex |
|-----------|----------|----------|
| right  (▲ left, ▽ right in same row)    | v[0] ↔ v[1], v[1] ↔ v[0] |
| left   (▲ right, ▽ left in same row)    | v[0] ↔ v[2], v[2] ↔ v[0] |
| below  (▲ above, ▽ below, same col)     | v[1] ↔ v[2], v[2] ↔ v[1] |

`boardAdjacentPairs: AdjacentPair[]` — all internal edges, computed once from boardShape.
Mismatched placed edges are drawn with a red dotted line (inset 10%, half-width) during play.
Win condition: every slot filled **and** every shared edge matches **and** all extra constraints pass.

## Extra constraints (`boardConstraints` in puzzle.ts)
Generated after `generateSolution()` using the known solution values so they are always satisfiable.
Targets are read directly from the solution; the seeded RNG picks and shuffles candidates.

| Kind | Rule | Badge label |
|------|------|-------------|
| `sum` (1 slot) | Sum of the 3 corner values = target | target number |
| `sum` (2 slots) | Sum of all 6 corner values across both adjacent slots = target | target number |
| `all-different` | All 3 corner values are distinct | `≠` |
| `all-same` | All 3 corner values are equal | `≡` |

Count by difficulty: **easy = 1**, **medium = 2**, **hard = 4**.
Allowed kinds: easy → sum-single only; medium → sum-single, sum-pair, all-different; hard → all.

`generateConstraints(solutionValues, rng)` builds a candidate pool, Fisher-Yates shuffles it,
then greedily picks non-overlapping constraints (no slot used by two constraints).

**Visual**: constrained slots get a semi-transparent colour tint (28% alpha). A filled circle badge
(radius `R × 0.22`) sits at the centroid of the slot(s) — midpoint of both centroids for pairs.
Badge colour: constraint colour while unfilled → green (#22c55e) when satisfied → red (#ef4444) when violated.
Palette: `CONSTRAINT_COLORS = ['#7c3aed', '#ea580c', '#16a34a', '#0891b2']` (violet, orange, green, cyan).

`constraintSatisfied(c)` returns true if any constrained slot is still empty (no early penalty).

## Puzzle generation (`generateSolution` in puzzle.ts)
Backtracking fill (left-to-right, top-to-bottom):
1. For each slot, shuffle remaining unused pieces from ALL_PIECES, try each with valid rotations
2. Check at most 2 already-placed neighbours (left + above); commit if constraints pass
3. Backtrack on failure (rare — 56 pieces, ≤12 slots, ≤2 constraints)
4. Before shuffling, capture `solutionValues: PieceValues[]` (rotated values per slot) for constraint generation
5. Shuffle the resulting piece array so tray order doesn't reveal board order
6. Returns `{ pieces, solutionValues }`; all pieces start at rotation 0 in the tray

This guarantees every daily puzzle is solvable. The seeded RNG makes puzzles reproducible per date+difficulty.

## Puzzle page state (module-level, persists across resize)
- `pieces: PieceValues[]` — set once by `generateSolution()` on load
- `pieceRotation: number[]` — current rotation (0–5) per piece, all start at 0
- `boardOccupancy: (number|null)[]` — which pieceIdx is in each board slot (null = empty)
- `boardAdjacentPairs: AdjacentPair[]` — all internal shared edges, computed once from boardShape
- `boardConstraints: Constraint[]` — extra constraints generated after solution; checked in `isPuzzleSolved()`
- `boardShape: { rows, cols }` — set from BOARD_SHAPE_FOR_COUNT[count]
- `drag: DragState | null` — current drag including `startX/startY` for tap detection
- `solvedMarked: boolean` — set true once on first valid solve; gates the SOLVED overlay

## Difficulty settings
Piece count is seeded-random within a range; board shape follows from piece count.

| Difficulty | Count range | Example board shapes |
|------------|-------------|----------------------|
| easy       | 4–6         | 2×2, 1×5, 2×3        |
| medium     | 7–9         | 1×7, 2×4, 3×3        |
| hard       | 10–12       | 2×5, 1×11, 3×4       |

`BOARD_SHAPES_FOR_COUNT` maps each count to an array of `{ rows, cols }` options; one is chosen
randomly via the daily RNG so the board shape varies each day.

## Interaction
- **Drag**: `pointerdown` on piece → `pointermove` → `pointerup` snaps to nearest empty slot
  - Snap: exact point-in-triangle first, then nearest centroid within 1.2R
  - Drop on occupied slot → **swap**: dragged piece takes that slot, displaced piece goes to origin slot (or tray)
  - Drop in tray area (y ≥ boardSectionH) → returns piece to tray
  - Drop on board with no valid slot → restores to original slot
- **Tap** (movement < 8px): rotates piece by one step (+1 mod 6), restores to origin slot
- Both drag-drop and tap call `checkCompletion()` so rotation can trigger the win condition

## What's been built
- [x] Main page displaying all 56 pieces in a responsive grid
- [x] Easy/Medium/Hard difficulty nav on main page
- [x] Puzzle page with triangular board + tray on a single canvas
- [x] Drag-and-drop between tray and board (and back)
- [x] Swap pieces by dragging one onto another already-placed piece
- [x] Tap-to-rotate (6 orientations, 60° each)
- [x] Star ghost slot in tray when a piece is placed on the board
- [x] Daily seeded puzzles with localStorage completion tracking
- [x] Adjacency matching constraint: shared edges between placed pieces must have equal corner values
- [x] Red dotted highlight on mismatched edges during play (inset 10%, half-width)
- [x] Backtracking puzzle generator — every daily puzzle is guaranteed solvable
- [x] Win condition: all slots filled AND all adjacency constraints AND all extra constraints satisfied
- [x] Random board shape per day — `BOARD_SHAPES_FOR_COUNT` holds multiple options per piece count,
  selected by the daily RNG (e.g. 2×3, 3×2, or 1×6 for 6-piece easy puzzles)
- [x] How-to-play card on home page (between nav and piece grid)
- [x] Pulsing glow animation on difficulty buttons until that difficulty is completed
- [x] Share button on solved panel — Web Share API on mobile, clipboard fallback on desktop
- [x] Hidden solve timer — starts on page load, stops on first valid solve
- [x] Solve time displayed on solved panel ("Solved in 3m 42s") and included in share text
- [x] Solve time persisted in localStorage — shown correctly when revisiting a completed puzzle
- [x] `DEV_SKIP_ADJACENCY` flag in puzzle.ts — set to `true` to skip adjacency checks for UI
- [x] Pause timer when page/puzzle is not active
- [x] Daily streak count
- [x] Extra board constraints (sum, all-different, all-same) — 1/2/4 per easy/medium/hard
  - Generated from solution values so always satisfiable; seeded for daily reproducibility
  - Coloured tint overlay on affected slots; badge at centroid turns green/red on fill
  - Constraint rules documented in how-to-play card on home page with matching badge colours
- [x] Full rules/tutorial page (`rules.html`) — static page linked from home page
  - Section 1: tile anatomy SVG with corner labels
  - Section 2: adjacency rule with matching (green) and mismatching (red dotted) SVG examples
  - Section 3: all 6 rotations of a sample piece in a 3×2 CSS grid
  - Section 4: extra constraint types with tinted SVG examples and explanatory text
  - "← Back" link returns to home; "Play today's puzzle" CTA at bottom

## What's planned next
- [ ] **Curated shapes per difficulty** — currently shapes are random across all difficulties;
  could weight or restrict options so easy always gets compact shapes and hard gets elongated ones

## CSS / layout notes
- `BODY_MARGIN = 16` in puzzle.ts must match `padding: 1rem 8px` in style.css (8px × 2 sides)
- `touch-action: none` on `#puzzle-canvas` (drag); `touch-action: pan-y` on `#board` (main page scroll)
- Canvas dimensions are set in JS (`canvas.width/height`), not CSS
- Resize handler is width-only (ignores height-only changes, e.g. mobile keyboard)
