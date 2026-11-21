// Circle line strips for overlay layers (M5 batch D): ring segments on
// the XZ plane around (cx, cy). Lives in render/ — the sim purity rules
// forbid transcendental math in features/*/rules.

// Flat ring strip: `segments` line segments approximating a circle of
// `radius` at height `y`.
export function ringStrip(
  cx: number,
  cy: number,
  y: number,
  radius: number,
  segments: number,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    pts.push(
      cx + Math.cos(a0) * radius,
      y,
      cy + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius,
      y,
      cy + Math.sin(a1) * radius,
    );
  }
  return pts;
}

// Progress arc strip: a partial ring covering `frac` of the circle,
// drawn slightly wider by duplicating each segment at radius ±0.08.
export function arcStrip(
  cx: number,
  cy: number,
  y: number,
  radius: number,
  frac: number,
  segments: number,
): number[] {
  const n = Math.max(1, Math.round(segments * Math.min(1, Math.max(0, frac))));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    for (const rr of [radius - 0.08, radius + 0.08]) {
      pts.push(
        cx + Math.cos(a0) * rr,
        y,
        cy + Math.sin(a0) * rr,
        cx + Math.cos(a1) * rr,
        y,
        cy + Math.sin(a1) * rr,
      );
    }
  }
  return pts;
}

function writeSegment(
  positions: Float32Array,
  colors: Float32Array | null,
  cursor: number,
  x0: number,
  y: number,
  z0: number,
  x1: number,
  z1: number,
  r: number,
  g: number,
  b: number,
): number {
  positions[cursor] = x0;
  positions[cursor + 1] = y;
  positions[cursor + 2] = z0;
  positions[cursor + 3] = x1;
  positions[cursor + 4] = y;
  positions[cursor + 5] = z1;
  if (colors !== null) {
    colors[cursor] = r;
    colors[cursor + 1] = g;
    colors[cursor + 2] = b;
    colors[cursor + 3] = r;
    colors[cursor + 4] = g;
    colors[cursor + 5] = b;
  }
  return cursor + 6;
}

// Zero-allocation flat ring writer: writes xyz (and optional rgb) triples
// directly into preallocated typed arrays, stopping before overflowing
// `positions.length`. When `dashed` is true, odd segments are skipped.
export function writeRingVertices(
  positions: Float32Array,
  colors: Float32Array | null,
  cursor: number,
  cx: number,
  cy: number,
  y: number,
  radius: number,
  segments: number,
  r: number,
  g: number,
  b: number,
  dashed?: boolean,
): number {
  const limit = colors !== null ? Math.min(positions.length, colors.length) : positions.length;
  for (let i = 0; i < segments; i++) {
    if (dashed === true && i % 2 === 1) {
      continue;
    }
    if (cursor + 6 > limit) {
      break;
    }
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    cursor = writeSegment(
      positions,
      colors,
      cursor,
      cx + Math.cos(a0) * radius,
      y,
      cy + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius,
      cy + Math.sin(a1) * radius,
      r,
      g,
      b,
    );
  }
  return cursor;
}

// Zero-allocation progress arc writer: matches `arcStrip` geometry
// (double radius `radius ± 0.08`) directly into preallocated typed arrays,
// stopping safely before overflowing `positions.length`.
export function writeArcVertices(
  positions: Float32Array,
  colors: Float32Array | null,
  cursor: number,
  cx: number,
  cy: number,
  y: number,
  radius: number,
  frac: number,
  segments: number,
  r: number,
  g: number,
  b: number,
): number {
  const n = Math.max(1, Math.round(segments * Math.min(1, Math.max(0, frac))));
  const limit = colors !== null ? Math.min(positions.length, colors.length) : positions.length;
  for (let i = 0; i < n; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const rInner = radius - 0.08;
    if (cursor + 6 > limit) {
      break;
    }
    cursor = writeSegment(
      positions,
      colors,
      cursor,
      cx + cos0 * rInner,
      y,
      cy + sin0 * rInner,
      cx + cos1 * rInner,
      cy + sin1 * rInner,
      r,
      g,
      b,
    );
    const rOuter = radius + 0.08;
    if (cursor + 6 > limit) {
      break;
    }
    cursor = writeSegment(
      positions,
      colors,
      cursor,
      cx + cos0 * rOuter,
      y,
      cy + sin0 * rOuter,
      cx + cos1 * rOuter,
      cy + sin1 * rOuter,
      r,
      g,
      b,
    );
  }
  return cursor;
}
