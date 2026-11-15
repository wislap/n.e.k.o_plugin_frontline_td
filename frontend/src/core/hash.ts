// Deterministic 64-bit hash kept as two 32-bit lanes, murmur3-style mixing
// built on Math.imul (32-bit ops are IEEE-exact and therefore deterministic).

export interface Hasher {
  u32(n: number): void;
  f64(n: number): void;
  str(s: string): void;
  digest(): string;
}

const SEED_A = 0x9747b28c;
const SEED_B = 0x238f1a4d;

export function createHasher(): Hasher {
  let h1 = SEED_A;
  let h2 = SEED_B;
  let count = 0;
  const view = new DataView(new ArrayBuffer(8));

  const mix = (n: number): void => {
    count++;
    let k = n >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h1 ^= k;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;

    k = n >>> 0;
    k = Math.imul(k, 0x85ebca6b);
    k = (k << 16) | (k >>> 16);
    k = Math.imul(k, 0xc2b2ae35);
    h2 ^= k;
    h2 = (h2 << 11) | (h2 >>> 21);
    h2 = (Math.imul(h2, 5) + 0x27d4eb2f) | 0;
  };

  return {
    u32(n) {
      mix(n);
    },
    f64(n) {
      view.setFloat64(0, n, true);
      mix(view.getUint32(0, true));
      mix(view.getUint32(4, true));
    },
    str(s) {
      mix(s.length);
      for (let i = 0; i < s.length; i++) {
        mix(s.charCodeAt(i));
      }
    },
    digest() {
      let a = (h1 ^ count) >>> 0;
      let b = (h2 ^ count) >>> 0;
      a ^= b;
      a = Math.imul(a, 0x9e3779b1);
      a ^= a >>> 16;
      b ^= a;
      b = Math.imul(b, 0x85ebca6b);
      b ^= b >>> 13;
      const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
      return hex(a) + hex(b);
    },
  };
}

const TYPED_ARRAY_TAGS = new Map<string, string>([
  ['Int8Array', 'i8'],
  ['Uint8Array', 'u8'],
  ['Uint8ClampedArray', 'u8c'],
  ['Int16Array', 'i16'],
  ['Uint16Array', 'u16'],
  ['Int32Array', 'i32'],
  ['Uint32Array', 'u32'],
  ['Float32Array', 'f32'],
  ['Float64Array', 'f64'],
  ['BigInt64Array', 'i64'],
  ['BigUint64Array', 'u64'],
]);

function hashValue(hasher: Hasher, value: unknown): void {
  if (value === null) {
    hasher.str('n');
    return;
  }
  if (typeof value === 'boolean') {
    hasher.str('b');
    hasher.u32(value ? 1 : 0);
    return;
  }
  if (typeof value === 'number') {
    hasher.str('f');
    hasher.f64(value);
    return;
  }
  if (typeof value === 'string') {
    hasher.str('s');
    hasher.str(value);
    return;
  }
  if (Array.isArray(value)) {
    hasher.str('a');
    hasher.u32(value.length);
    for (const item of value as unknown[]) {
      if (item === undefined) {
        throw new TypeError('hashCanonical: undefined is not allowed inside arrays');
      }
      hashValue(hasher, item);
    }
    return;
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      throw new TypeError('hashCanonical: DataView is not supported');
    }
    const tag = TYPED_ARRAY_TAGS.get(value.constructor.name);
    if (tag === undefined) {
      throw new TypeError(`hashCanonical: unsupported typed array ${value.constructor.name}`);
    }
    hasher.str('t');
    hasher.str(tag);
    const elements = value as unknown as { length: number; [i: number]: number | bigint };
    hasher.u32(elements.length);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (typeof element === 'bigint') {
        throw new TypeError('hashCanonical: BigInt typed arrays are not supported');
      }
      hasher.f64(element ?? 0);
    }
    return;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== null && proto !== Object.prototype) {
      throw new TypeError('hashCanonical: class instances are not supported');
    }
    const record = value as Record<string, unknown>;
    hasher.str('o');
    const keys = Object.keys(record).sort();
    hasher.u32(keys.length);
    for (const key of keys) {
      const item = record[key];
      if (item === undefined) {
        throw new TypeError(`hashCanonical: undefined value for key '${key}'`);
      }
      hasher.str(key);
      hashValue(hasher, item);
    }
    return;
  }
  throw new TypeError(`hashCanonical: unsupported value of type ${typeof value}`);
}

// Hashes plain data only: null, boolean, number (as f64 bits), string, arrays,
// TypedArrays (tagged by type), and plain objects (keys sorted). Anything else
// throws so non-deterministic or ambiguous values can never be hashed.
export function hashCanonical(value: unknown): string {
  const hasher = createHasher();
  hashValue(hasher, value);
  return hasher.digest();
}
