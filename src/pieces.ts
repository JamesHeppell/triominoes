/**
 * A triomino piece is a triangular tile with a number (0–5) at each corner.
 * The canonical form stores the three values in clockwise-ascending order,
 * so a ≤ b ≤ c.  Every unique combination of three values (with repetition)
 * from the set {0, 1, 2, 3, 4, 5} appears exactly once in a full set.
 *
 * Total pieces: C(6+3-1, 3) = C(8,3) = 56
 */

/** The three corner values of a triomino, in clockwise-ascending order (a ≤ b ≤ c). */
export type PieceValues = readonly [number, number, number];

/** Generate all 56 pieces of a standard triomino set. */
function generateAllPieces(): readonly PieceValues[] {
  const pieces: PieceValues[] = [];
  for (let a = 0; a <= 5; a++) {
    for (let b = a; b <= 5; b++) {
      for (let c = b; c <= 5; c++) {
        pieces.push([a, b, c]);
      }
    }
  }
  return Object.freeze(pieces);
}

/** All 56 triomino pieces in a standard set, in canonical (a ≤ b ≤ c) order. */
export const ALL_PIECES: readonly PieceValues[] = generateAllPieces();

/** Returns a human-readable label for a piece, e.g. "0-1-2" or "4-4-5". */
export function pieceLabel([a, b, c]: PieceValues): string {
  return `${a}-${b}-${c}`;
}

/**
 * Returns true if two PieceValues represent the same piece.
 * (Both must already be in canonical form.)
 */
export function piecesEqual(p: PieceValues, q: PieceValues): boolean {
  return p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
}

/**
 * Returns the canonical form of any three corner values
 * (sorts ascending so the result is always a ≤ b ≤ c).
 */
export function canonical(a: number, b: number, c: number): PieceValues {
  const sorted = [a, b, c].sort((x, y) => x - y);
  return [sorted[0], sorted[1], sorted[2]];
}
