import { assertNever } from './assert';
import type { EmblemCorner, EmblemShape, EmblemStyle, SponsorArt, Wording } from './types';
import type { Workspace } from './workspace';

/**
 * The sponsor emblem on stream: the creator's house style composed with the
 * sponsor's art for one deal.
 *
 * Pure. Geometry is in the reference units of a 960 x 540 frame, as the shop
 * board's is, and scaled to whatever frame draws it, so the editor's preview
 * and the OBS source agree to the pixel at the same height.
 *
 * Two things hold whatever the creator designs: the "Ad" label is always in
 * the view, and nothing in the view is or leads to a price.
 */

export const FRAME = { w: 960, h: 540 } as const;

export const CORNERS: ReadonlyArray<{ value: EmblemCorner; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export const SHAPES: ReadonlyArray<{ value: EmblemShape; label: string }> = [
  { value: 'pill', label: 'Pill' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
];

export const WORDINGS: ReadonlyArray<{ value: Wording; label: string }> = [
  { value: 'sponsored-by', label: 'Sponsored by' },
  { value: 'powered-by', label: 'Powered by' },
  { value: 'with-thanks-to', label: 'With thanks to' },
  { value: 'brand-only', label: 'Name only' },
];

/**
 * The kinds of placement a sponsor can buy on a stream. Each is its own OBS
 * browser source, so the on-air log can say how long each one was up.
 *
 * The kind is not stored: it is named in the overlay's address, its look comes
 * from the house style and its content from the deal's sponsor art.
 */
export type PlacementKind = 'emblem' | 'lower-third' | 'slate' | 'card';

export interface Placement {
  value: PlacementKind;
  label: string;
  /** The name to give the browser source in OBS. `sponsifer log` watches these names. */
  sourceName: string;
  hint: string;
}

export const PLACEMENTS: readonly Placement[] = [
  { value: 'emblem', label: 'Corner emblem', sourceName: 'Sponsor overlay', hint: 'Up for the whole sponsored stretch.' },
  { value: 'lower-third', label: 'Lower third', sourceName: 'Sponsor lower third', hint: 'A band along the bottom, for while you talk about the sponsor.' },
  { value: 'slate', label: 'Segment slate', sourceName: 'Sponsor slate', hint: 'Full frame for a few seconds, to open a sponsored segment.' },
  { value: 'card', label: 'Break card', sourceName: 'Sponsor card', hint: 'A card for starting-soon and be-right-back scenes.' },
];

/** A kind named in an address, or the corner emblem when it names none or nonsense. */
export function placementKind(value: string | null | undefined): PlacementKind {
  return PLACEMENTS.find((p) => p.value === value)?.value ?? 'emblem';
}

/** How much larger than the corner emblem each kind's unit is, at the same house size. */
const KIND_SCALE: Record<PlacementKind, number> = { emblem: 1, 'lower-third': 1.7, slate: 2.2, card: 1.6 };

export const RESHOW_OPTIONS = [0, 5, 10, 20] as const;
export const EMBLEM_SIZE = { min: 0.03, max: 0.12 } as const;
export const EMBLEM_INSET = { min: 0, max: 120 } as const;

export const DEFAULT_EMBLEM: EmblemStyle = {
  corner: 'top-left',
  inset: 24,
  size: 0.06,
  accent: '#e2b658',
  background: '#0d0f13',
  text: '#f4f1ea',
  shape: 'rounded',
  bareLogo: false,
  entrance: true,
  reshowEveryMinutes: 10,
};

export const DEFAULT_ART: SponsorArt = { image: '', imageAspect: 0, wording: 'sponsored-by', accent: null };

/** Everything the overlay draws for one deal. No price, and no field that leads to one. */
export interface EmblemView {
  kind: PlacementKind;
  /** Always present. The one part of the emblem the creator does not choose. */
  disclosure: 'Ad';
  brand: string;
  /** The line beside the label, or empty for a bare logo or a brand with no name. */
  line: string;
  image: string;
  imageAspect: number;
  style: EmblemStyle;
}

/** The sentence beside the label, in the sponsor's chosen wording. */
export function lineFor(wording: Wording, brand: string): string {
  const name = brand.trim();
  switch (wording) {
    case 'sponsored-by':
      return name ? `Sponsored by ${name}` : 'Sponsored';
    case 'powered-by':
      return name ? `Powered by ${name}` : 'Sponsored';
    case 'with-thanks-to':
      return name ? `With thanks to ${name}` : 'Sponsored';
    case 'brand-only':
      return name;
    default:
      return assertNever(wording);
  }
}

/**
 * A placement for a deal: only a won deal is on air. Null for a lost or
 * unknown deal. `bareLogo` belongs to the corner emblem alone; a band, a slate
 * or a card with no words on it says nothing.
 */
export function emblemView(workspace: Workspace, dealId: string, kind: PlacementKind = 'emblem'): EmblemView | null {
  const deal = workspace.deals.find((d) => d.id === dealId);
  if (!deal || deal.outcome !== 'won') return null;
  const art = deal.sponsorArt ?? DEFAULT_ART;
  const style = { ...workspace.emblem, accent: art.accent ?? workspace.emblem.accent };
  return {
    kind,
    disclosure: 'Ad',
    brand: deal.brand.trim(),
    line: kind === 'emblem' && style.bareLogo ? '' : lineFor(art.wording, deal.brand),
    image: art.image,
    imageAspect: art.imageAspect,
    style,
  };
}

/** The badge's pixel geometry in a frame of this height. Everything scales from the height alone. */
export interface EmblemGeometry {
  /** Where it anchors. A lower third always sits at the bottom, on the house corner's side. */
  corner: EmblemCorner;
  insetPx: number;
  /** The kind's unit: the badge's height, the band's, or a slate's or card's label row. */
  heightPx: number;
  /** The label's font size, from which the line and the image follow. */
  fontPx: number;
  radiusPx: number;
}

export function emblemGeometry(style: EmblemStyle, frameHeight: number, kind: PlacementKind = 'emblem'): EmblemGeometry {
  const unit = frameHeight / FRAME.h;
  const heightPx = style.size * KIND_SCALE[kind] * frameHeight;
  const radius = style.shape === 'pill' ? heightPx / 2 : style.shape === 'rounded' ? heightPx * 0.22 : 0;
  const side = style.corner.endsWith('left') ? 'left' : 'right';
  return {
    corner: kind === 'lower-third' ? `bottom-${side}` : style.corner,
    insetPx: style.inset * unit,
    heightPx,
    fontPx: heightPx * 0.42,
    radiusPx: radius,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Where a dragged badge should settle: the nearest corner, and the distance
 * from it, in reference units. A position can never be off the frame, because
 * the inset is clamped and the corner is one of four.
 * @param point the badge's centre, in pixels of a frame of the given size.
 */
export function snapToCorner(point: { x: number; y: number }, frame: { w: number; h: number }): { corner: EmblemCorner; inset: number } {
  const unit = FRAME.h / frame.h;
  const left = point.x < frame.w / 2;
  const top = point.y < frame.h / 2;
  const dx = (left ? point.x : frame.w - point.x) * unit;
  const dy = (top ? point.y : frame.h - point.y) * unit;
  const corner: EmblemCorner = top ? (left ? 'top-left' : 'top-right') : left ? 'bottom-left' : 'bottom-right';
  // The inset is the distance from the corner along the shorter axis, less half a
  // typical badge so the badge's edge rather than its centre lands there.
  return { corner, inset: Math.round(clamp(Math.min(dx, dy) - 24, EMBLEM_INSET.min, EMBLEM_INSET.max)) };
}

/** A size from a drag on the resize handle: the badge's new height as a share of the frame's. */
export function sizeFromHeight(heightPx: number, frameHeight: number): number {
  return Math.round(clamp(heightPx / frameHeight, EMBLEM_SIZE.min, EMBLEM_SIZE.max) * 1000) / 1000;
}
