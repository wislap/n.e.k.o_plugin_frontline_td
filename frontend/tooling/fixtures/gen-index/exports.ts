// File header: this line documents the module, not any single export.

export const CONSTANT = 1; // trailing comment of the previous line must not leak

// Doc for the const export.
export const ANSWER = 42;

/** JSDoc doc for the arrow export (e.g. helpers). Second sentence dropped. */
export const helper = (): number => 1;

// Sentence one ends here; clauses after semicolons and colons: stay intact
// because only '。' or '. ' terminate the sentence.
export const tagged = 'x';

// A comment separated by a blank line belongs to nothing.

export const plain = 0;

export interface Shape {
  a: number;
}
