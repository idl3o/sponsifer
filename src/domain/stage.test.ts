import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from '../store/sample';
import { DEFAULT_BOARD } from './board';
import { DEFAULT_EMBLEM } from './emblem';
import { overlayFor } from './overlay';
import { DEFAULT_TERMS } from './pricing';
import { parseStage } from './stage';
import type { Deal } from './types';
import { parseWorkspace, workspaceOf } from './workspace';

const DEAL: Deal = {
  id: 'dl-104', prospectId: 'pr-2', brand: 'Hetzner', outcome: 'won', lostReason: null, closedOn: '2026-09-10',
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 0.6, tier2: 0.3, tier3: 0.1 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 450,
  flooredByProduction: true, fitAtClose: 72, agreed: 400, deliveredOn: '', paidOn: '', seal: null, sightings: [],
  sponsorArt: { image: '', imageAspect: 0, wording: 'powered-by', accent: '#5fc3d4' }, notes: '',
};

/** The file as the server holds it: JSON, round-tripped. */
const file = (deals: unknown[] = [DEAL], extra: Record<string, unknown> = {}): Record<string, unknown> =>
  JSON.parse(JSON.stringify({
    ...workspaceOf({ profile: SAMPLE_PROFILE, terms: DEFAULT_TERMS, prospects: SAMPLE_PROSPECTS, deals: [], board: DEFAULT_BOARD, emblem: DEFAULT_EMBLEM }),
    deals,
    ...extra,
  })) as Record<string, unknown>;

describe('parseStage', () => {
  it('reads the stream part of a file exactly as parseWorkspace does', () => {
    const whole = parseWorkspace(file());
    const stage = parseStage(file());
    if (!whole.ok || !stage.ok) throw new Error('both should parse');
    expect(stage.stage.emblem).toEqual(whole.workspace.emblem);
    const [deal] = whole.workspace.deals;
    expect(stage.stage.deals).toEqual([{
      id: deal?.id, brand: deal?.brand, outcome: deal?.outcome, closedOn: deal?.closedOn,
      deliveredOn: deal?.deliveredOn, sponsorArt: deal?.sponsorArt,
    }]);
  });

  it('still draws the overlay when a pricing field is one the app cannot read', () => {
    const broken = file([{ ...DEAL, medianViews: 'lots', platform: 'myspace' }], { profile: { channels: 'none' } });
    expect(parseWorkspace(broken).ok).toBe(false);
    const stage = parseStage(broken);
    if (!stage.ok) throw new Error(stage.error);
    const view = overlayFor(stage.stage, 'dl-104');
    expect(view?.disclosure).toBe('Ad');
    expect(view?.line).toBe('Powered by Hetzner');
    expect(view?.style.accent).toBe('#5fc3d4');
  });

  it('refuses what it does read, as the app would', () => {
    expect(parseStage(file([], { emblem: { ...DEFAULT_EMBLEM, accent: 'gold' } }))).toEqual({
      ok: false, error: 'emblem.accent should be a colour like #e2b658',
    });
    expect(parseStage(file([{ ...DEAL, outcome: 'maybe' }])).ok).toBe(false);
    expect(parseStage(file([{ ...DEAL, sponsorArt: { image: 'data:image/svg+xml;base64,PHN2Zz4=' } }])).ok).toBe(false);
  });

  it('gives a file from before the emblem the default style, as the app does', () => {
    const old = file([], { emblem: undefined });
    const stage = parseStage(old);
    expect(stage.ok && stage.stage.emblem).toEqual(DEFAULT_EMBLEM);
  });
});
