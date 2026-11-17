// Square spiral offsets around (cx,cy), ring by ring, fixed traversal order.
// Generated on the fly per call; ends when a ring can no longer intersect
// the map, so nothing is cached between calls.
export function* spiralOffsets(
  cx: number,
  cy: number,
  width: number,
  height: number,
): Generator<readonly [number, number]> {
  yield [0, 0] as const;
  for (let r = 1; ; r++) {
    // A ring has on-map cells only while at least one of its four outline
    // edges crosses the map; stop once every edge is outside.
    if (cx - r < 0 && cx + r >= width && cy - r < 0 && cy + r >= height) {
      return;
    }
    for (let x = -r; x <= r; x++) {
      yield [x, -r] as const;
    }
    for (let y = -r + 1; y <= r; y++) {
      yield [r, y] as const;
    }
    for (let x = r - 1; x >= -r; x--) {
      yield [x, r] as const;
    }
    for (let y = r - 1; y >= -r + 1; y--) {
      yield [-r, y] as const;
    }
  }
}
