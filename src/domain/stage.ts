import { DEFAULT_ART, DEFAULT_EMBLEM, EMBLEM_INSET, EMBLEM_SIZE } from './emblem';
import { Invalid, arr, bool, colour, num, obj, oneOf, parseImage, str } from './parse';
import type { Deal, EmblemStyle, SponsorArt } from './types';

/**
 * The part of the workspace a stream reads: the house style, and for each deal
 * what the overlay and the dock show. Nothing about pricing.
 *
 * The overlay and the dock parse only this. A pricing field the app cannot
 * read never blanks what is on stream, and neither page ships the pricing
 * engine. `parseWorkspace` parses these parts with the same functions, so the
 * app and the stream cannot read them differently.
 *
 * It never writes, so unlike `parseWorkspace` it does not refuse a file from a
 * newer format: what it can parse it shows, and what it cannot it refuses,
 * and the overlay keeps its last frame.
 */

export type StageDeal = Pick<Deal, 'id' | 'brand' | 'outcome' | 'closedOn' | 'deliveredOn' | 'sponsorArt'>;

/** A whole Workspace is a Stage too, so the app hands its own to the same functions. */
export interface Stage {
  readonly deals: readonly StageDeal[];
  readonly emblem: EmblemStyle;
}

export type StageResult = { ok: true; stage: Stage } | { ok: false; error: string };

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const SHAPES = ['pill', 'rounded', 'square'] as const;
const WORDINGS = ['sponsored-by', 'powered-by', 'with-thanks-to', 'brand-only'] as const;

/** The stream emblem's house style. Absent before format 5, when it takes the defaults. */
export function parseEmblem(value: unknown): EmblemStyle {
  if (value === undefined) return { ...DEFAULT_EMBLEM };
  const o = obj(value, 'emblem');
  const d = DEFAULT_EMBLEM;
  const reshow = num(o.reshowEveryMinutes, 'emblem.reshowEveryMinutes', d.reshowEveryMinutes);
  return {
    corner: oneOf(o.corner ?? d.corner, CORNERS, 'emblem.corner'),
    inset: Math.min(EMBLEM_INSET.max, Math.max(EMBLEM_INSET.min, num(o.inset, 'emblem.inset', d.inset))),
    size: Math.min(EMBLEM_SIZE.max, Math.max(EMBLEM_SIZE.min, num(o.size, 'emblem.size', d.size))),
    accent: colour(o.accent, 'emblem.accent', d.accent),
    background: colour(o.background, 'emblem.background', d.background),
    text: colour(o.text, 'emblem.text', d.text),
    shape: oneOf(o.shape ?? d.shape, SHAPES, 'emblem.shape'),
    bareLogo: bool(o.bareLogo, 'emblem.bareLogo', d.bareLogo),
    entrance: bool(o.entrance, 'emblem.entrance', d.entrance),
    reshowEveryMinutes: Math.max(0, reshow),
  };
}

/** A deal's sponsor art. Null, and absent before format 5, means none yet. */
export function parseSponsorArt(value: unknown, path: string): SponsorArt | null {
  if (value === undefined || value === null) return null;
  const o = obj(value, path);
  const accent = o.accent === null || o.accent === undefined ? null : colour(o.accent, `${path}.accent`, DEFAULT_EMBLEM.accent);
  return {
    image: parseImage(o.image, `${path}.image`),
    imageAspect: Math.max(0, num(o.imageAspect, `${path}.imageAspect`, DEFAULT_ART.imageAspect)),
    wording: oneOf(o.wording ?? DEFAULT_ART.wording, WORDINGS, `${path}.wording`),
    accent,
  };
}

function parseStageDeal(value: unknown, path: string): StageDeal {
  const o = obj(value, path);
  return {
    id: str(o.id, `${path}.id`),
    brand: str(o.brand, `${path}.brand`, ''),
    outcome: oneOf(o.outcome, ['won', 'lost'] as const, `${path}.outcome`),
    closedOn: str(o.closedOn, `${path}.closedOn`),
    deliveredOn: str(o.deliveredOn, `${path}.deliveredOn`, ''),
    sponsorArt: parseSponsorArt(o.sponsorArt, `${path}.sponsorArt`),
  };
}

/** The stream's part of a workspace file, checked as `parseWorkspace` checks it, and nothing else. */
export function parseStage(input: unknown): StageResult {
  try {
    const o = obj(input, 'file');
    return {
      ok: true,
      stage: {
        deals: arr(o.deals ?? [], 'deals').map((d, i) => parseStageDeal(d, `deals[${i}]`)),
        emblem: parseEmblem(o.emblem),
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}
