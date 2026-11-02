import { encode } from 'uqr';
import type { BoardSpec, CreatorProfile } from './types';

/**
 * The shop board: the creator's visible mark on clip previews.
 *
 * Pure. The layout is computed in the reference units of the design canvas
 * (a 960 × 540 landscape frame and a 405 × 720 vertical one) and scaled to
 * the output. Text is measured by a function the caller supplies, so the
 * geometry can be tested without a canvas.
 *
 * Two things hold whatever the creator designs: every preview carries the
 * PREVIEW label and the tiled pattern, and a public preview carries the link.
 * No price is ever drawn, because prices change and pixels do not.
 */

export type Aspect = 'landscape' | 'vertical';

/** Who a preview is for. A sponsored moment is offered only to its sponsor. */
export type Audience = { kind: 'public' } | { kind: 'sponsor'; sponsor: string };

export const CTA_OPTIONS = ['License this moment', 'License this clip', 'Use this moment in your ads'] as const;
export const ACCENT_OPTIONS = ['#e2b658', '#5fc3d4', '#6fcf97'] as const;
export const PATTERN_RANGE = { min: 0.04, max: 0.3 } as const;

// The image cap is shared with the sponsor art, and lives with the parser that enforces it.
export { MAX_IMAGE_CHARS } from './parse';

export const DEFAULT_BOARD: BoardSpec = {
  mark: 'monogram',
  monogram: '',
  image: '',
  imageAspect: 0,
  handle: '',
  cta: CTA_OPTIONS[0],
  linkBase: '',
  showQr: true,
  landscape: 'lower-left',
  vertical: 'middle-left',
  accent: ACCENT_OPTIONS[0],
  pattern: 0.12,
};

/** The size each preview is exported at. */
export const OUTPUT_SIZE: Record<Aspect, { w: number; h: number }> = {
  landscape: { w: 1280, h: 720 },
  vertical: { w: 720, h: 1280 },
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Areas of a 9:16 frame that TikTok, Reels and Shorts cover with their own
 * UI, in reference units: the top bar, the right-hand buttons, the caption.
 */
export const VERTICAL_UI_ZONES: readonly Box[] = [
  { x: 0, y: 0, w: 405, h: 80 },
  { x: 343, y: 330, w: 62, h: 250 },
  { x: 0, y: 570, w: 405, h: 150 },
];

/** Reference geometry for each frame, taken from the design canvas. */
const METRICS = {
  landscape: {
    w: 960, h: 540, padX: 14, padY: 12, gap: 14, mark: 46, logoH: 52, logoMaxW: 118, qr: 92,
    label: 11, handle: 12.5, cta: 21, link: 13.5, note: 13, wholeW: 400, wholeImgH: 92, bandH: 30, margin: 26,
  },
  vertical: {
    w: 405, h: 720, padX: 11, padY: 10, gap: 10, mark: 38, logoH: 42, logoMaxW: 58, qr: 68,
    label: 10, handle: 0, cta: 16, link: 12, note: 11.5, wholeW: 318, wholeImgH: 74, bandH: 26, margin: 14,
  },
} as const;

type Metrics = (typeof METRICS)[Aspect];

export type Measure = (text: string, font: string) => number;

export type RunColour = 'accent' | 'ink' | 'muted' | 'link';

/** One line of text to draw, with its top-left corner. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  font: string;
  size: number;
  /** Extra space after each character, in px. */
  tracking: number;
  colour: RunColour;
}

export interface BoardLayout {
  aspect: Aspect;
  width: number;
  height: number;
  board: Box;
  /** The creator's image fills the board, and the tool's band sits beneath it. */
  whole: boolean;
  /** The monogram or logo slot, or the whole-board image area. */
  mark: Box | null;
  qr: Box | null;
  runs: TextRun[];
  monogram: { text: string; font: string } | null;
}

/** What the board says, resolved from the spec, the profile and the audience. */
export interface BoardText {
  label: string;
  handle: string;
  cta: string;
  link: string | null;
  note: string | null;
  monogram: string;
  pattern: string;
}

const SANS = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

/** A CSS font string. */
export function fontFor(size: number, weight: number, mono = false): string {
  return `${weight} ${Math.round(size * 100) / 100}px ${mono ? MONO : SANS}`;
}

/** Up to three initials from a name, e.g. "Kernow Builds" gives "KB". */
export function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map((word) => word[0] ?? '');
  return letters.join('').slice(0, 3).toUpperCase();
}

/** The address a moment's listing is published at, without the scheme. */
export function linkFor(spec: BoardSpec, momentId: string): string | null {
  const base = spec.linkBase.trim().replace(/^https?:\/\//i, '');
  return base ? `${base}${momentId}` : null;
}

/** Resolve everything the board will say, filling blanks from the profile. */
export function boardText(spec: BoardSpec, profile: CreatorProfile, audience: Audience, momentId: string): BoardText {
  const handle = spec.handle.trim() || profile.channels[0]?.handle || '';
  const monogram = spec.monogram.trim().slice(0, 3).toUpperCase() || initials(profile.name) || '?';
  if (audience.kind === 'sponsor') {
    const sponsor = audience.sponsor.trim().toUpperCase() || 'YOUR SPONSOR';
    return {
      label: `PREVIEW FOR ${sponsor}`, handle: '', cta: spec.cta, link: null,
      note: 'Terms and price are in your delivery report.', monogram, pattern: `PREVIEW · FOR ${sponsor}`,
    };
  }
  const pattern = handle ? `PREVIEW · ${handle.toUpperCase()}` : 'PREVIEW';
  return { label: 'PREVIEW', handle, cta: spec.cta, link: linkFor(spec, momentId), note: null, monogram, pattern };
}

/** The mark slot's size: a square monogram, or a logo scaled to its aspect. */
function markSize(m: Metrics, spec: BoardSpec): { w: number; h: number } {
  if (spec.mark === 'monogram') return { w: m.mark, h: m.mark };
  const w = spec.imageAspect > 0 ? m.logoH * spec.imageAspect : m.logoMaxW;
  return { w: Math.min(m.logoMaxW, Math.max(24, w)), h: m.logoH };
}

/** The compact text column's runs, relative to its own top-left, and its size. */
function textColumn(m: Metrics, text: BoardText, measure: Measure) {
  const lines: TextRun[] = [];
  const labelFont = fontFor(m.label, 500, true);
  const labelW = measure(text.label, labelFont) + text.label.length * m.label * 0.16;
  lines.push({ text: text.label, x: 0, y: 0, font: labelFont, size: m.label, tracking: m.label * 0.16, colour: 'accent' });
  let width = labelW;
  if (text.handle && m.handle > 0) {
    const font = fontFor(m.handle, 400);
    lines.push({ text: text.handle, x: labelW + 8, y: -1, font, size: m.handle, tracking: 0, colour: 'muted' });
    width = labelW + 8 + measure(text.handle, font);
  }
  let y = m.label * 1.3 + 3;
  const ctaFont = fontFor(m.cta, 650);
  lines.push({ text: text.cta, x: 0, y, font: ctaFont, size: m.cta, tracking: 0, colour: 'ink' });
  width = Math.max(width, measure(text.cta, ctaFont));
  y += m.cta * 1.25 + 3;
  const tail = text.link ?? text.note ?? '';
  const tailSize = text.link ? m.link : m.note;
  const tailFont = fontFor(tailSize, 400, Boolean(text.link));
  lines.push({ text: tail, x: 0, y, font: tailFont, size: tailSize, tracking: 0, colour: text.link ? 'link' : 'muted' });
  width = Math.max(width, measure(tail, tailFont));
  return { lines, width, height: y + tailSize * 1.3 };
}

/** Where the board's top-left corner goes, in reference units. */
function placeBoard(m: Metrics, aspect: Aspect, spec: BoardSpec, w: number, h: number): { x: number; y: number } {
  if (aspect === 'landscape') {
    const x = spec.landscape === 'lower-right' ? m.w - m.margin - w : m.margin;
    const y = spec.landscape === 'upper-left' ? m.margin : m.h - m.margin - h;
    return { x, y };
  }
  // Anchored to the app's own UI: just under the top bar, or just above the
  // button column, where the board's width cannot collide with the buttons.
  const topBar = VERTICAL_UI_ZONES[0]?.h ?? 80;
  const buttonsTop = VERTICAL_UI_ZONES[1]?.y ?? 330;
  const y = spec.vertical === 'upper-left' ? topBar + 16 : spec.vertical === 'middle-left' ? buttonsTop - 12 - h : m.h - 34 - h;
  return { x: m.margin, y };
}

/** The compact board: mark, text column and QR code in a row. */
function compactLayout(aspect: Aspect, spec: BoardSpec, text: BoardText, measure: Measure) {
  const m = METRICS[aspect];
  const mark = markSize(m, spec);
  const column = textColumn(m, text, measure);
  const qrSize = spec.showQr && text.link ? m.qr : 0;
  const inner = Math.max(mark.h, column.height, qrSize);
  const w = m.padX * 2 + mark.w + m.gap + column.width + (qrSize ? m.gap + qrSize : 0);
  const h = m.padY * 2 + inner;
  const at = placeBoard(m, aspect, spec, w, h);
  const colX = at.x + m.padX + mark.w + m.gap;
  const colY = at.y + m.padY + (inner - column.height) / 2;
  return {
    board: { x: at.x, y: at.y, w, h },
    mark: { x: at.x + m.padX, y: at.y + m.padY + (inner - mark.h) / 2, w: mark.w, h: mark.h },
    qr: qrSize ? { x: at.x + w - m.padX - qrSize, y: at.y + m.padY + (inner - qrSize) / 2, w: qrSize, h: qrSize } : null,
    runs: column.lines.map((run) => ({ ...run, x: run.x + colX, y: run.y + colY })),
    monogram: spec.mark === 'monogram' ? { text: text.monogram, font: fontFor(mark.h * 0.37, 720) } : null,
  };
}

/** The whole-board image, with the tool's band of label and link beneath it. */
function wholeLayout(aspect: Aspect, spec: BoardSpec, text: BoardText, measure: Measure) {
  const m = METRICS[aspect];
  const imageH = spec.imageAspect > 0 ? Math.min(m.wholeImgH * 1.6, Math.max(40, m.wholeW / spec.imageAspect)) : m.wholeImgH;
  const h = imageH + m.bandH;
  const at = placeBoard(m, aspect, spec, m.wholeW, h);
  const labelFont = fontFor(m.label, 500, true);
  const tail = text.link ?? 'Terms in your delivery report';
  const tailFont = fontFor(m.link, 400, true);
  const bandY = at.y + imageH + (m.bandH - m.link * 1.2) / 2;
  const runs: TextRun[] = [
    { text: text.label, x: at.x + m.padX, y: bandY + 1, font: labelFont, size: m.label, tracking: m.label * 0.16, colour: 'accent' },
    { text: tail, x: at.x + m.wholeW - m.padX - measure(tail, tailFont), y: bandY, font: tailFont, size: m.link, tracking: 0, colour: 'link' },
  ];
  return { board: { x: at.x, y: at.y, w: m.wholeW, h }, mark: { x: at.x, y: at.y, w: m.wholeW, h: imageH }, qr: null, runs, monogram: null };
}

function scaleBox(box: Box, s: number): Box {
  return { x: box.x * s, y: box.y * s, w: box.w * s, h: box.h * s };
}

/** A CSS font string with its pixel size multiplied by s. */
function scaleFont(font: string, s: number): string {
  return font.replace(/^(\d+) ([\d.]+)px/, (_, weight: string, px: string) => `${weight} ${Math.round(Number(px) * s * 100) / 100}px`);
}

/**
 * Lay the board out for one frame at its output size.
 * @param measure measures text in a font string at reference size.
 */
export function layoutBoard(spec: BoardSpec, text: BoardText, aspect: Aspect, measure: Measure): BoardLayout {
  const whole = spec.mark === 'board-image';
  const ref = whole ? wholeLayout(aspect, spec, text, measure) : compactLayout(aspect, spec, text, measure);
  const s = OUTPUT_SIZE[aspect].w / METRICS[aspect].w;
  const runs = ref.runs.map((r) => ({ ...r, x: r.x * s, y: r.y * s, size: r.size * s, tracking: r.tracking * s, font: scaleFont(r.font, s) }));
  return {
    aspect,
    width: OUTPUT_SIZE[aspect].w,
    height: OUTPUT_SIZE[aspect].h,
    board: scaleBox(ref.board, s),
    whole,
    mark: ref.mark ? scaleBox(ref.mark, s) : null,
    qr: ref.qr ? scaleBox(ref.qr, s) : null,
    runs,
    monogram: ref.monogram ? { text: ref.monogram.text, font: scaleFont(ref.monogram.font, s) } : null,
  };
}

/**
 * The QR code for a listing link, as rows of dark modules, without its quiet
 * zone. Medium error correction, since previews get recompressed.
 */
export function qrMatrix(link: string): boolean[][] {
  return encode(`https://${link}`, { ecc: 'M', border: 0 }).data;
}

/** Reference units per output pixel, for converting a layout back to the design's zones. */
export function referenceScale(aspect: Aspect): number {
  return METRICS[aspect].w / OUTPUT_SIZE[aspect].w;
}
