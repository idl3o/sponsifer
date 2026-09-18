import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from '../store/sample';
import { DEFAULT_BOARD } from './board';
import { DEFAULT_EMBLEM, EMBLEM_INSET, EMBLEM_SIZE, emblemGeometry, emblemView, lineFor, sizeFromHeight, snapToCorner } from './emblem';
import { DEFAULT_TERMS } from './pricing';
import type { Deal } from './types';
import { workspaceOf, type Workspace } from './workspace';

const DEAL: Deal = {
  id: 'dl-104', prospectId: 'pr-2', brand: 'Hetzner', outcome: 'won', lostReason: null, closedOn: '2026-09-10',
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 0.6, tier2: 0.3, tier3: 0.1 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 450,
  flooredByProduction: true, fitAtClose: 72, agreed: 400, deliveredOn: '', paidOn: '', seal: null, sightings: [],
  sponsorArt: null, notes: 'Agreed £400 after a counter.',
};

const withDeals = (...deals: Deal[]): Workspace =>
  workspaceOf({ profile: SAMPLE_PROFILE, terms: DEFAULT_TERMS, prospects: SAMPLE_PROSPECTS, deals, board: DEFAULT_BOARD, emblem: DEFAULT_EMBLEM });

describe('emblemView', () => {
  it('always carries the Ad label, and nothing that is or leads to a price', () => {
    const view = emblemView(withDeals(DEAL), 'dl-104')!;
    expect(view.disclosure).toBe('Ad');
    expect(Object.keys(view).sort()).toEqual(['brand', 'disclosure', 'image', 'imageAspect', 'line', 'style']);
    expect(JSON.stringify(view)).not.toMatch(/400|450|£|agreed|quoted/);
  });

  it('draws nothing for a lost deal or an unknown id', () => {
    const lost: Deal = { ...DEAL, id: 'dl-105', outcome: 'lost', lostReason: 'budget' };
    expect(emblemView(withDeals(DEAL, lost), 'dl-105')).toBeNull();
    expect(emblemView(withDeals(DEAL), 'dl-999')).toBeNull();
  });

  it('uses the house style, letting the sponsor art override only the accent', () => {
    const art = { image: 'data:image/png;base64,iVBORw0KGgo=', imageAspect: 2, wording: 'powered-by' as const, accent: '#ff0000' };
    const view = emblemView(withDeals({ ...DEAL, sponsorArt: art }), 'dl-104')!;
    expect(view.style.accent).toBe('#ff0000');
    expect(view.style.corner).toBe(DEFAULT_EMBLEM.corner);
    expect(view.line).toBe('Powered by Hetzner');
    expect(view.image).toBe(art.image);
  });

  it('drops the line, never the label, for a bare logo', () => {
    const ws = withDeals(DEAL);
    const view = emblemView({ ...ws, emblem: { ...ws.emblem, bareLogo: true } }, 'dl-104')!;
    expect(view.line).toBe('');
    expect(view.disclosure).toBe('Ad');
  });
});

describe('lineFor', () => {
  it('writes each wording, and falls back when the deal names no brand', () => {
    expect(lineFor('sponsored-by', 'Hetzner')).toBe('Sponsored by Hetzner');
    expect(lineFor('with-thanks-to', 'Hetzner')).toBe('With thanks to Hetzner');
    expect(lineFor('brand-only', 'Hetzner')).toBe('Hetzner');
    expect(lineFor('brand-only', '  ')).toBe('');
    expect(lineFor('powered-by', '')).toBe('Sponsored');
  });
});

describe('geometry', () => {
  it('scales everything from the frame height alone, so two frames agree', () => {
    const small = emblemGeometry(DEFAULT_EMBLEM, 540);
    const big = emblemGeometry(DEFAULT_EMBLEM, 1080);
    expect(big.heightPx).toBeCloseTo(small.heightPx * 2);
    expect(big.insetPx).toBeCloseTo(small.insetPx * 2);
    expect(big.fontPx).toBeCloseTo(small.fontPx * 2);
  });

  it('gives a pill a radius of half its height and a square none', () => {
    expect(emblemGeometry({ ...DEFAULT_EMBLEM, shape: 'pill' }, 540).radiusPx).toBeCloseTo(DEFAULT_EMBLEM.size * 540 / 2);
    expect(emblemGeometry({ ...DEFAULT_EMBLEM, shape: 'square' }, 540).radiusPx).toBe(0);
  });
});

describe('snapToCorner', () => {
  const frame = { w: 960, h: 540 };

  it('picks the nearest corner', () => {
    expect(snapToCorner({ x: 40, y: 40 }, frame).corner).toBe('top-left');
    expect(snapToCorner({ x: 900, y: 40 }, frame).corner).toBe('top-right');
    expect(snapToCorner({ x: 40, y: 500 }, frame).corner).toBe('bottom-left');
    expect(snapToCorner({ x: 900, y: 500 }, frame).corner).toBe('bottom-right');
  });

  it('never lets the inset leave the frame', () => {
    expect(snapToCorner({ x: 0, y: 0 }, frame).inset).toBe(EMBLEM_INSET.min);
    expect(snapToCorner({ x: 480, y: 270 }, frame).inset).toBe(EMBLEM_INSET.max);
  });

  it('measures in reference units whatever the frame size', () => {
    const at540 = snapToCorner({ x: 80, y: 80 }, frame);
    const at1080 = snapToCorner({ x: 160, y: 160 }, { w: 1920, h: 1080 });
    expect(at1080).toEqual(at540);
  });
});

describe('sizeFromHeight', () => {
  it('clamps to the allowed range', () => {
    expect(sizeFromHeight(1, 540)).toBe(EMBLEM_SIZE.min);
    expect(sizeFromHeight(540, 540)).toBe(EMBLEM_SIZE.max);
    expect(sizeFromHeight(54, 540)).toBe(0.1);
  });
});
