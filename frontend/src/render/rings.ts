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
