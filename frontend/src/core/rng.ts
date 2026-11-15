// Seeded, serializable RNG: sfc32 over a Uint32Array(4) state. Streams are
// derived from (seed, streamName) so each registered stream is independent
// (ADR 0006, ADR 0023).

export type RngState = Uint32Array;

const ID_SPACE = 4294967296; // 2^32 as a literal ('**' is forbidden here)

function stringToUint32(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(state: { v: number }): number {
  state.v = (state.v + 0x9e3779b9) >>> 0;
  let z = state.v;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

export function createRngState(seed: number, streamName: string): RngState {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`rng seed must be a safe integer, got ${seed}`);
  }
  const sm = { v: (seed ^ stringToUint32(streamName)) >>> 0 };
  const state = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    state[i] = splitmix32(sm);
  }
  // Discard the first outputs so weak initial states warm up.
  for (let i = 0; i < 12; i++) {
    rngNextUint32(state);
  }
  return state;
}

export function rngNextUint32(state: RngState): number {
  const a = state[0] ?? 0;
  const b = state[1] ?? 0;
  const c = state[2] ?? 0;
  const d = state[3] ?? 0;
  const t = (a + b + d) >>> 0;
  state[3] = (d + 1) >>> 0;
  state[0] = (b ^ (b >>> 9)) >>> 0;
  state[1] = (c + (c << 3)) >>> 0;
  const rotated = ((c << 21) | (c >>> 11)) >>> 0;
  state[2] = (rotated + t) >>> 0;
  return t;
}

// Unbiased integer in [0, n) via rejection sampling; n in 1..2^32.
export function rngNextIntBelow(state: RngState, n: number): number {
  if (!Number.isSafeInteger(n) || n < 1 || n > ID_SPACE) {
    throw new RangeError(`rngNextIntBelow: n must be an integer in 1..${ID_SPACE}, got ${n}`);
  }
  const limit = Math.floor(ID_SPACE / n) * n;
  let r = rngNextUint32(state);
  while (r >= limit) {
    r = rngNextUint32(state);
  }
  return r % n;
}
