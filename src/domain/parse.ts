/**
 * The primitives every parser of the workspace file is built from. Each one
 * throws `Invalid` with a readable path, and the parser's edge catches it.
 *
 * Nothing here imports anything, so the overlay and the dock can parse the
 * part of the file they read without loading the pricing engine.
 */

/** Thrown inside a parser and caught at its edge, carrying a readable path. */
export class Invalid extends Error {}

export type Obj = Record<string, unknown>;

export function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Invalid(`${path} should be an object`);
  }
  return value as Obj;
}

export function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Invalid(`${path} should be a list`);
  return value;
}

export function str(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new Invalid(`${path} should be text`);
  return value;
}

export function num(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Invalid(`${path} should be a number`);
  }
  return value;
}

export function bool(value: unknown, path: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') throw new Invalid(`${path} should be true or false`);
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Invalid(`${path} should be one of ${allowed.join(', ')}`);
}

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function colour(value: unknown, path: string, fallback: string): string {
  const c = str(value, path, fallback);
  if (!HEX_COLOUR.test(c)) throw new Invalid(`${path} should be a colour like #e2b658`);
  return c;
}

/** The largest uploaded image kept, as a data URL, in characters. About 300 KB of PNG. */
export const MAX_IMAGE_CHARS = 400_000;

const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** An uploaded image: a PNG, JPEG or WebP data URL within the size cap, or empty. */
export function parseImage(value: unknown, path: string): string {
  const image = str(value, path, '');
  if (image && (!IMAGE_URL.test(image) || image.length > MAX_IMAGE_CHARS)) {
    throw new Invalid(`${path} should be a PNG, JPEG or WebP image under ${Math.round(MAX_IMAGE_CHARS / 1000)} KB`);
  }
  return image;
}
