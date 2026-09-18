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
  }
}

/** The emblem for a deal: only a won deal is on air. Null for a lost or unknown deal. */
export function emblemView(workspace: Workspace, dealId: string): EmblemView | null {
  const deal = workspace.deals.find((d) => d.id === dealId);
  if (!deal || deal.outcome !== 'won') return null;
  const art = deal.sponsorArt ?? DEFAULT_ART;
  const style = { ...workspace.emblem, accent: art.accent ?? workspace.emblem.accent };
  return {
    disclosure: 'Ad',
    brand: deal.brand.trim(),
    line: style.bareLogo ? '' : lineFor(art.wording, deal.brand),
    image: art.image,
    imageAspect: art.imageAspect,
    style,
  };
}

/** The badge's pixel geometry in a frame of this height. Everything scales from the height alone. */
export interface EmblemGeometry {
  corner: EmblemCorner;
  insetPx: number;
  heightPx: number;
  /** The label's font size, from which the line and the image follow. */
  fontPx: number;
  radiusPx: number;
}

export function emblemGeometry(style: EmblemStyle, frameHeight: number): EmblemGeometry {
  const unit = frameHeight / FRAME.h;
  const heightPx = style.size * frameHeight;
  const radius = style.shape === 'pill' ? heightPx / 2 : style.shape === 'rounded' ? heightPx * 0.22 : 0;
  return {
    corner: style.corner,
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
