# Triominoes — Daily Puzzles

A mobile-first browser puzzle game based on the classic triominoes tile set. A new puzzle is available every day across three difficulty levels.

**Play it:** [JamesHeppell.github.io/triominoes](https://jamesheppell.github.io/triominoes)

---

## How to play

Each puzzle gives you a set of triangular tiles from the 56-piece triominoes set. Every tile has three corners, each labelled 0–5.

- **Place tiles** onto the board by dragging them from the tray
- **Rotate tiles** by tapping them (6 orientations: 3 pointing up, 3 pointing down)
- **Adjacency rule:** where two tiles share an edge, the two touching corners must match
- **Extra constraints** appear on some tiles (sum targets, all-different, all-same) — satisfy them all to win

The puzzle is solved when every slot is filled, every shared edge matches, and all extra constraints are met.

---

## Features

- **Daily puzzles** — three difficulty levels (Easy / Medium / Hard), new puzzles every day
- **Guaranteed solvable** — backtracking generator with seeded daily RNG
- **Extra constraints** — sum, all-different, and all-same rules add an extra layer of challenge on harder difficulties
- **Drag & drop** with snap-to-slot, swap between slots, and a ghost preview while dragging
- **Tap to rotate** — cycles through all 6 orientations
- **Solve timer** — tracks and persists your solve time; included in the share text
- **Daily streak** tracking
- **Light / dark mode** — follows device preference, toggleable, no flash on load
- **PWA** — installable as a home screen app, works offline
- **View all 56 tiles** modal on the home page
- **Full rules page** with SVG diagrams explaining rotations, adjacency, and constraints
- **Colorblind-safe** mismatch markers (✕ disc) and constraint badges (✓/✗)

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Bundler | esbuild |
| Rendering | HTML5 Canvas 2D |
| Input | Pointer Events API |
| Hosting | GitHub Pages (static files) |
| Runtime deps | None |

---

## Project structure

```
index.html        Home page — difficulty nav, streak badge, "View all 56 tiles" modal
puzzle.html       Puzzle page — single canvas with board + tray
rules.html        Rules/tutorial — SVG diagrams, no JS required
style.css         Shared CSS — all pages, CSS custom properties for theming
src/
  pieces.ts       Piece data — 56 canonical pieces
  draw.ts         Canvas primitives — drawPiece, drawEmptySlot, getPalette
  layout.ts       Responsive layout maths — computeGridLayout, computeBoardLayout
  main.ts         Home page logic
  puzzle.ts       Puzzle page — board, tray, drag-and-drop, generation, constraints
  daily.ts        Daily seed, completion tracking, streak (localStorage)
docs/             Build output — deployed to GitHub Pages
```

---

## Development

**Prerequisites:** Node.js (any recent LTS)

```bash
# Install dependencies
npm install

# Build once (outputs to docs/)
npm run build

# Watch mode for development
npm run dev
```

Open `docs/index.html` directly in a browser, or serve the `docs/` folder locally:

```bash
npx serve docs
```

### Dev flags (in `src/puzzle.ts`)

| Flag | Purpose |
|------|---------|
| `DEV_MODE` | Shows a dev banner and a Reset button that clears progress and advances the date |
| `DEV_SKIP_ADJACENCY` | Bypasses adjacency checks for UI testing — **never commit as `true`** |

---

## Deployment

The `docs/` folder is the deployment target. Push to `master` and GitHub Pages will serve it automatically (configure Pages to serve from `docs/` on `master`).

---

## License

MIT — see [LICENSE](LICENSE) if present, otherwise feel free to fork and adapt.

---

*Developed by [Jheps Games](https://sites.google.com/view/jheps-games/home)*
