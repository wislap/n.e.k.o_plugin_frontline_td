import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAIL_BYTES, main, WARN_BYTES } from './check-size';

let dir = '';

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
    dir = '';
  }
});

function dirWithBytes(bytes: number): string {
  dir = mkdtempSync(join(tmpdir(), 'check-size-'));
  mkdirSync(join(dir, 'app'));
  // Sparse file: statSync().size reports the logical size without allocating.
  const fd = openSync(join(dir, 'app', 'f.bin'), 'w');
  ftruncateSync(fd, bytes);
  closeSync(fd);
  return dir;
}

describe('check-size', () => {
  it('passes silently under the warn threshold', () => {
    expect(main(dirWithBytes(1024))).toBe(0);
  });

  it('warns but exits 0 over 24 MiB', () => {
    expect(main(dirWithBytes(WARN_BYTES + 1))).toBe(0);
  });

  it('fails over 32 MiB', () => {
    expect(main(dirWithBytes(FAIL_BYTES + 1))).toBe(1);
  });
});
