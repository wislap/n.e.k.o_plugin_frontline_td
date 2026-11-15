// A tiny schema DSL deriving both the TS type and the runtime validator.
// Hand-written because the simulation layer may not import npm packages (R9).
// No coercion: a value either matches the schema exactly or fails with a path.
import { parseContentId, type ContentId } from './content-id';
import type { FactionId } from './faction';
import { MAX_FACTION_ID } from './faction';
import type { EntityHandle } from './handle';

export type ValidationFailure = { ok: false; path: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

export interface Schema<T> {
  readonly _infer?: T;
}

export interface IntSchema extends Schema<number> {
  kind: 'int';
  min?: number;
  max?: number;
}
export interface BoolSchema extends Schema<boolean> {
  kind: 'bool';
}
export interface StringSchema extends Schema<string> {
  kind: 'string';
  maxLength?: number;
  pattern?: RegExp;
}
export interface LiteralSchema<T> extends Schema<T> {
  kind: 'literal';
  value: T;
}
export interface EnumSchema<T extends string> extends Schema<T> {
  kind: 'enum';
  values: readonly T[];
}
export interface ContentIdSchema extends Schema<ContentId> {
  kind: 'contentId';
}
export interface HandleSchema extends Schema<EntityHandle> {
  kind: 'handle';
}
export interface FactionIdSchema extends Schema<FactionId> {
  kind: 'factionId';
}
export interface ArraySchema<I extends AnySchema> extends Schema<Infer<I>[]> {
  kind: 'array';
  item: I;
  maxLength?: number;
}
export interface OptionalSchema<I extends AnySchema> extends Schema<Infer<I> | undefined> {
  kind: 'optional';
  inner: I;
}
export interface ObjectSchema<F extends Record<string, AnySchema>> extends Schema<InferObject<F>> {
  kind: 'object';
  fields: F;
}

export type AnySchema =
  | IntSchema
  | BoolSchema
  | StringSchema
  | LiteralSchema<unknown>
  | EnumSchema<string>
  | ContentIdSchema
  | HandleSchema
  | FactionIdSchema
  | ArraySchema<AnySchema>
  | OptionalSchema<AnySchema>
  | ObjectSchema<Record<string, AnySchema>>;

export type Infer<S> = S extends Schema<infer T> ? T : never;

type OptionalKeys<F extends Record<string, AnySchema>> = {
  [K in keyof F]: F[K] extends OptionalSchema<AnySchema> ? K : never;
}[keyof F];

type InferObject<F extends Record<string, AnySchema>> = {
  [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]>;
} & {
  [K in OptionalKeys<F>]?: Infer<F[K]>;
};

export function int(opts: { min?: number; max?: number } = {}): IntSchema {
  const schema: IntSchema = { kind: 'int' };
  if (opts.min !== undefined) {
    schema.min = opts.min;
  }
  if (opts.max !== undefined) {
    schema.max = opts.max;
  }
  return schema;
}

export function bool(): BoolSchema {
  return { kind: 'bool' };
}

export function string(opts: { maxLength?: number; pattern?: RegExp } = {}): StringSchema {
  const schema: StringSchema = { kind: 'string' };
  if (opts.maxLength !== undefined) {
    schema.maxLength = opts.maxLength;
  }
  if (opts.pattern !== undefined) {
    schema.pattern = opts.pattern;
  }
  return schema;
}

export function literal<T extends string | number | boolean>(value: T): LiteralSchema<T> {
  return { kind: 'literal', value };
}

export function enumOf<T extends string>(values: readonly T[]): EnumSchema<T> {
  return { kind: 'enum', values };
}

export function contentId(): ContentIdSchema {
  return { kind: 'contentId' };
}

export function handle(): HandleSchema {
  return { kind: 'handle' };
}

export function factionId(): FactionIdSchema {
  return { kind: 'factionId' };
}

export function array<I extends AnySchema>(
  item: I,
  opts: { maxLength?: number } = {},
): ArraySchema<I> {
  const schema: ArraySchema<I> = { kind: 'array', item };
  if (opts.maxLength !== undefined) {
    schema.maxLength = opts.maxLength;
  }
  return schema;
}

// Only meaningful as an object field: the key may be absent entirely.
export function optional<I extends AnySchema>(inner: I): OptionalSchema<I> {
  return { kind: 'optional', inner };
}

export function object<F extends Record<string, AnySchema>>(fields: F): ObjectSchema<F> {
  return { kind: 'object', fields };
}

function fail(path: string, message: string): ValidationFailure {
  return { ok: false, path, message };
}

function check(schema: AnySchema, value: unknown, path: string): ValidationFailure | null {
  switch (schema.kind) {
    case 'int': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return fail(path, 'expected a safe integer');
      }
      if (schema.min !== undefined && value < schema.min) {
        return fail(path, `must be >= ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        return fail(path, `must be <= ${schema.max}`);
      }
      return null;
    }
    case 'bool':
      return typeof value === 'boolean' ? null : fail(path, 'expected a boolean');
    case 'string': {
      if (typeof value !== 'string') {
        return fail(path, 'expected a string');
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return fail(path, `length must be <= ${schema.maxLength}`);
      }
      if (schema.pattern !== undefined && !schema.pattern.test(value)) {
        return fail(path, `must match ${schema.pattern}`);
      }
      return null;
    }
    case 'literal':
      return value === schema.value ? null : fail(path, `must be ${String(schema.value)}`);
    case 'enum':
      return (schema.values as readonly unknown[]).includes(value)
        ? null
        : fail(path, `must be one of ${schema.values.join(', ')}`);
    case 'contentId':
      return typeof value === 'string' && parseContentId(value) !== null
        ? null
        : fail(path, 'expected a valid content id');
    case 'handle':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? null
        : fail(path, 'expected an entity handle');
    case 'factionId':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= MAX_FACTION_ID
        ? null
        : fail(path, `expected a faction id in 0..${MAX_FACTION_ID}`);
    case 'array': {
      if (!Array.isArray(value)) {
        return fail(path, 'expected an array');
      }
      const items = value as unknown[];
      if (schema.maxLength !== undefined && items.length > schema.maxLength) {
        return fail(path, `length must be <= ${schema.maxLength}`);
      }
      for (let i = 0; i < items.length; i++) {
        const failure = check(schema.item, items[i], `${path}[${i}]`);
        if (failure !== null) {
          return failure;
        }
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'expected an object');
      }
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!(key in schema.fields)) {
          return fail(`${path}.${key}`, 'unknown key');
        }
      }
      for (const [key, field] of Object.entries(schema.fields)) {
        const present = key in record;
        if (field.kind === 'optional') {
          if (present) {
            const failure = check(field.inner, record[key], `${path}.${key}`);
            if (failure !== null) {
              return failure;
            }
          }
          continue;
        }
        if (!present) {
          return fail(`${path}.${key}`, 'missing required key');
        }
        const failure = check(field, record[key], `${path}.${key}`);
        if (failure !== null) {
          return failure;
        }
      }
      return null;
    }
    case 'optional':
      return fail(path, 'optional() is only valid as an object field');
  }
}

export function validate<S extends AnySchema>(
  schema: S,
  value: unknown,
): ValidationResult<Infer<S>> {
  const failure = check(schema, value, '$');
  if (failure !== null) {
    return failure;
  }
  return { ok: true, value: value as Infer<S> };
}
