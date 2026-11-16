// The 8-neighbour edge rule (ADR 0015): a step is allowed when both cells
// are passable for the class and either the heights are equal, or |dh| = 1
// and the LOWER cell is a ramp. Diagonals additionally need both orthogonal
// legs passable (no corner cutting).
export function heightStepPassable(
  heightA: number,
  heightB: number,
  rampA: number,
  rampB: number,
): boolean {
  if (heightA === heightB) {
    return true;
  }
  if (Math.abs(heightA - heightB) !== 1) {
    return false;
  }
  return heightA < heightB ? rampA === 1 : rampB === 1;
}
