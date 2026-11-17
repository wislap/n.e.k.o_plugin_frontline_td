// Latest ground point under the cursor in map coordinates, updated by the
// canvas dispatch on cursor.move and read by the build ghost each frame.
// Mutable module state, never React/zustand (per-frame reads).
export const cursorGround: { x: number; y: number; valid: boolean } = {
  x: 0,
  y: 0,
  valid: false,
};
