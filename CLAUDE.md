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
index.html          Main page — difficulty nav, how-to-play, "View all 56 tiles" modal
puzzle.html         Puzzle page — single canvas with board + tray
rules.html          Static rules/tutorial page — SVG diagrams, no JS
style.css           Shared CSS (all pages, CSS custom properties for theming)
src/
  pieces.ts         Piece data — PieceValues type, ALL_PIECES const (56 pieces)
  draw.ts           Canvas primitives — triVertices, drawPiece, drawEmptySlot, drawStarSlot, getPalette
  layout.ts         Responsive layout maths — computeGridLayout, computeBoardLayout
  main.ts           Main page logic — 56-piece grid modal, theme toggle, streak badge
  puzzle.ts         Puzzle page — board, tray, drag-and-drop, rotation, generation, constraints
  daily.ts          Daily seed, completion tracking, streak (localStorage)
docs/               Build output — deployed to GitHub Pages
```

## Piece model
- `PieceValues = readonly [number, number, number]` — three corner values 0–5 in canonical (a ≤ b ≤ c) order
- 56 total pieces (multiset combinations with repetition: C(8,3))
- Corners stored clockwise from the top vertex in canonical form

## Rotation model (6 orientations)
- `rotation` ∈ {0,1,2,3,4,5}, incremented by 1 on each tap (cycles)
- `rotationIsUp(r)` → `r % 2 === 0` (0,2,4 = ▲; 1,3,5 = ▽)
- `rotatedValues(piece, r)` → `shift = r % 3`; returns `[piece[shift], piece[(shift+1)%3], piece[(shift+2)%3]]`
- When dropping onto a board slot, rotation is auto-adapted if up/down doesn't match:
  `pieceRotation[i] = (rotation + 3) % 6` (flips orientation, preserves corner shift)

## Board geometry
- Triangular grid: alternating ▲/▽ — slot `(row, col)` is up when `(row+col) % 2 === 0`
- Centroid y: `padY + row * h + (up ? 2h/3 : h/3)`, x: `padX + (col+1) * (s/2)`
- `R` = circumradius; `s = R√3` (side); `h = 1.5R` (row height)
- `computeBoardLayout(rows, cols)` in `layout.ts` returns `{ r, s, h, canvasW, canvasH, padX, padY }`

## Drawing
- `triVertices(cx, cy, r, up)` — returns 3 vertices; vertex 0 is always the apex
  - ▲ (up=true):  v[0]=top-apex, v[1]=bottom-right, v[2]=bottom-left
  - ▽ (up=false): v[0]=bottom-apex, v[1]=top-left, v[2]=top-right
- `drawPiece(ctx, cx, cy, r, values, up)` — cream fill (#FFF8EE), black labels at 42% of centroid→vertex
- `drawEmptySlot` / `drawStarSlot` — both call `getPalette()` for theme-aware colours
- `getPalette()` in draw.ts — reads `document.documentElement.classList.contains('light')` at render time;
  returns `{ canvasBg, slotFill, slotStroke, solvedOverlay }` for dark or light mode
- `TEXT_FRAC = 0.42` — label position fraction (inradius = R/2, so 0.42 keeps text inside)

## Theming (light / dark mode)
- CSS custom properties in style.css: `:root` sets dark defaults; `html.light` overrides to light palette
- Anti-flash inline `<script>` in each HTML `<head>` applies `.light` class before CSS renders
- Canvas colours served by `getPalette()` — called fresh on every render, no caching
- User preference stored in localStorage key `triominoes-theme` (`'light'` | `'dark'` | null = device default)
- Device default via `window.matchMedia('(prefers-color-scheme: light)')`
- Theme toggle button: fixed top-right (0.75rem from top and right), shows ☀/☾

## Adjacency matching (core rule)
Shared corners per edge direction (▲ = slotA, ▽ = slotB — always by convention):
| Direction | ▲ vertex ↔ ▽ vertex |
|-----------|----------------------|
| right  (▲ left, ▽ right)  | v[0] ↔ v[1], v[1] ↔ v[0] |
| left   (▲ right, ▽ left)  | v[0] ↔ v[2], v[2] ↔ v[0] |
| below  (▲ above, ▽ below) | v[1] ↔ v[2], v[2] ↔ v[1] |

`boardAdjacentPairs: AdjacentPair[]` — all internal edges, computed once from boardShape.
Mismatched edges: red dotted line (inset 10%, half-width) + ✕ mark on a dark disc (colorblind-safe).
Win condition: every slot filled **and** every shared edge matches **and** all extra constraints pass.

## Extra constraints (`boardConstraints` in puzzle.ts)
Generated after `generateSolution()` from the known solution — always satisfiable; seeded for reproducibility.

| Kind | Rule | Badge |
|------|------|-------|
| `sum` (1 slot) | Sum of 3 corners = target | number |
| `sum` (2 slots) | Sum of 6 corners across both adjacent slots = target | number |
| `all-different` | All 3 corners distinct | `≠` |
| `all-same` | All 3 corners equal | `≡` |

Count: easy=1, medium=2, hard=4. Kinds: easy→sum-single; medium→sum-single/pair/all-diff; hard→all.
`CONSTRAINT_COLORS = ['#7c3aed', '#ea580c', '#16a34a', '#0891b2']` (violet, orange, green, cyan).
Badge turns green (✓) when satisfied, red (✗) when violated (shape+colour, colorblind-safe).

## Puzzle generation (`generateSolution` in puzzle.ts)
Backtracking fill left-to-right, top-to-bottom:
1. Shuffle remaining unused pieces, try each with valid rotations
2. Check ≤2 already-placed neighbours (left + above); commit if adjacency passes
3. Backtrack on failure; capture `solutionValues[]` for constraint generation
4. Shuffle piece array so tray order doesn't reveal board order
Returns `{ pieces, solutionValues }`; all pieces start at rotation 0 in the tray.

## Puzzle page state (module-level)
- `pieces`, `pieceRotation[]`, `boardOccupancy[]`, `boardAdjacentPairs[]`, `boardConstraints[]`
- `boardShape: { rows, cols }`, `drag: DragState | null`, `solvedMarked: boolean`

## Tray layout (`recomputeLayout` in puzzle.ts)
Binary search finds the largest `R` where board + tray fits both screen height and width.
- `minTrayCols`: hard mode = 4 (enforces 4-wide tray so board stays large on small phones)
- `maxTrayCols = Math.ceil(n / 2)` (caps at half piece count — avoids wide single-row on desktop)
- Width guard in loop: `if (minTrayCols * cellW > trayAvail) continue`
- `TRAY_CELL_W_RATIO`: hard=`56/30` (tight), others=`68/30` (more spacing)

## Difficulty settings
| Difficulty | Count range | Constraints |
|------------|-------------|-------------|
| easy       | 4–6         | 1 (sum-single only) |
| medium     | 7–9         | 2 (sum-single/pair/all-diff) |
| hard       | 10–12       | 4 (all kinds) |

`BOARD_SHAPES_FOR_COUNT` maps count → array of `{ rows, cols }`; one chosen by daily RNG.

## Interaction
- **Drag**: `pointerdown` → `pointermove` → `pointerup` snaps to nearest empty slot
  - Snap: exact point-in-triangle first, then nearest centroid within 1.2R
  - Drop on occupied slot → swap; drop in tray → return to tray; no valid slot → restore
  - Snap preview: 40% opacity ghost at target slot while dragging (after 8px movement)
- **Tap** (movement < 8px): rotates +1 mod 6; both tap and drop call `checkCompletion()`

## Key localStorage keys
| Key | Value |
|-----|-------|
| `triominoes-daily-v1` | per-difficulty: `true` (legacy) or `number` (solve time ms) |
| `triominoes-theme` | `'light'` \| `'dark'` \| null (device default) |
| `triominoes-hint-dismissed` | present = hint permanently hidden |
| `triominoes-constraint-tip-v1` | present = in-game constraint legend dismissed |
| `triominoes-streak-v1` | streak state JSON |

## CSS / layout notes
- `BODY_MARGIN = 16` in puzzle.ts must match `padding: 1rem 8px` in style.css (8px × 2 sides)
- `touch-action: none` on `#puzzle-canvas`; `touch-action: pan-y` on `#board` (modal scroll)
- Canvas `width`/`height` set in JS, not CSS
- Resize handler ignores height-only changes (mobile keyboard)

## Dev flags (puzzle.ts)
- `DEV_MODE` — shows dev banner and Reset button (clears progress, theme, increments date offset)
- `DEV_SKIP_ADJACENCY` — set `true` to bypass adjacency checks for UI testing; **never commit as true**

## What's been built
- [x] Full puzzle game: board, tray, drag-and-drop, tap-to-rotate, swap, adjacency matching
- [x] Backtracking generator — every puzzle guaranteed solvable; seeded daily RNG
- [x] Extra constraints (sum, all-different, all-same) with colour tint + badge UI
- [x] In-game constraint legend (first-encounter tooltip, dismissed on "Got it")
- [x] Win condition, solved overlay, solve timer, share button (Web Share + clipboard fallback)
- [x] Solve time persisted — shown on revisit; share text includes date + competitive hook
- [x] Daily streak with "streak ended" state after missed day
- [x] Random board shape per day (BOARD_SHAPES_FOR_COUNT)
- [x] Hard mode: 4-wide tray minimum, tight horizontal spacing, binary search with width guard
- [x] Max ceil(n/2) tray columns — avoids single-row on wide/desktop screens
- [x] Controls hint ("tap to rotate · drag to board") — shown first puzzle, dismissed on solve
- [x] Drag snap preview (40% ghost at target slot)
- [x] Colorblind-safe mismatch markers (✕ disc + ✓/✗ badge labels)
- [x] Full rules/tutorial page (rules.html) — SVG diagrams, all 6 rotations, constraint examples
- [x] "View all 56 tiles" modal (lazy-rendered, re-renders on theme change or re-open)
- [x] Light / dark mode toggle — CSS variables, getPalette() for canvas, anti-flash inline script,
  localStorage + device preference default; applied across all pages and canvases
- [x] "Developed by Jheps Games" footer (fixed bottom-right, links to jheps-games site)
- [x] PWA support — manifest.json + service worker for home-screen install and offline use
- [x] Daily completion badges on difficulty buttons (pulsing glow until completed)
- [x] Pause timer when page is not active

## What's planned next
- [ ] Leaderboard or social comparison (e.g. "X% solved Hard today")
- [ ] Difficulty-specific colour themes or icons for stronger visual distinction
- [ ] Onboarding tutorial / guided first puzzle for new users
