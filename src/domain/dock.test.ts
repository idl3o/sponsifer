import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD } from './board';
import { dockDeals, dockUrl, dockView, pickDockDeal, type DockDeal } from './dock';
import { DEFAULT_EMBLEM } from './emblem';
import type { LoggerStatus } from './onair';
import { DEFAULT_TERMS } from './pricing';
import type { Deal } from './types';
import { workspaceOf } from './workspace';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from '../store/sample';

const deal = (over: Partial<Deal>): Deal => ({
  id: 'dl-104', prospectId: '', brand: 'Hetzner', outcome: 'won', lostReason: null, closedOn: '2026-09-10',
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 1, tier2: 0, tier3: 0 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 450,
  flooredByProduction: true, fitAtClose: 70, agreed: 400, deliveredOn: '', paidOn: '', seal: null, sightings: [],
  sponsorArt: null, notes: 'rate is confidential', ...over,
});

const workspace = (deals: Deal[]) =>
  workspaceOf({ profile: SAMPLE_PROFILE, terms: DEFAULT_TERMS, prospects: SAMPLE_PROSPECTS, deals, board: DEFAULT_BOARD, emblem: DEFAULT_EMBLEM });

const idle: LoggerStatus = {
  running: false, deal: null, since: null, sources: [], missing: [], error: null, needsPassword: false,
  streamLive: false, placements: [], warnings: [],
};
const hetzner: DockDeal = { id: 'dl-104', brand: 'Hetzner' };
const stateOf = (view: ReturnType<typeof dockView>, source: string) => view.placements.find((p) => p.sourceName === source)?.state;

describe('dockDeals', () => {
  it('lists won deals not yet delivered, the most recently closed first', () => {
    const deals = dockDeals(workspace([
      deal({ id: 'dl-101', brand: 'Linear', closedOn: '2026-08-01' }),
      deal({ id: 'dl-102', brand: 'Glossier', outcome: 'lost' }),
      deal({ id: 'dl-103', brand: 'Tailscale', deliveredOn: '2026-09-01' }),
      deal({ id: 'dl-104', brand: 'Hetzner', closedOn: '2026-09-10' }),
    ]));
    expect(deals).toEqual([{ id: 'dl-104', brand: 'Hetzner' }, { id: 'dl-101', brand: 'Linear' }]);
  });
});

describe('no price can reach the dock', () => {
  it('a listed deal is an id and a brand, and nothing else', () => {
    const [listed] = dockDeals(workspace([deal({})]));
    expect(Object.keys(listed ?? {}).sort()).toEqual(['brand', 'id']);
  });

  it('the view has no field a price could travel in, and carries none of the deal’s money', () => {
    const view = dockView(hetzner, { ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay'] });
    expect(Object.keys(view).sort()).toEqual(['brand', 'dealId', 'headline', 'placements', 'tone']);
    expect(Object.keys(view.placements[0] ?? {}).sort()).toEqual(['kind', 'label', 'since', 'sourceName', 'state']);
    expect(JSON.stringify(view)).not.toMatch(/450|400|£|confidential/);
  });
});

describe('pickDockDeal', () => {
  const deals = [hetzner, { id: 'dl-101', brand: 'Linear' }];

  it('opens on the deal being logged, because that is the one on stream', () => {
    expect(pickDockDeal(deals, 'dl-104', 'dl-101')).toBe('dl-101');
  });

  it('otherwise the one asked for, otherwise the most recent', () => {
    expect(pickDockDeal(deals, 'dl-101', null)).toBe('dl-101');
    expect(pickDockDeal(deals, 'dl-999', null)).toBe('dl-104');
    expect(pickDockDeal(deals, null, 'dl-gone')).toBe('dl-104');
    expect(pickDockDeal([], 'dl-104', null)).toBeNull();
  });
});

describe('dockView', () => {
  const running: LoggerStatus = {
    ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay', 'Sponsor slate'],
    missing: ['Sponsor lower third', 'Sponsor card'],
    placements: [
      { source: 'Sponsor overlay', inProgram: false, onAirSince: null },
      { source: 'Sponsor slate', inProgram: false, onAirSince: null },
    ],
  };

  it('knows nothing when no logger is running, and says so', () => {
    const view = dockView(hetzner, idle);
    expect(view.headline).toBe('Not logging.');
    expect(view.tone).toBe('idle');
    expect(new Set(view.placements.map((p) => p.state))).toEqual(new Set(['unknown']));
    expect(dockView(hetzner, null).headline).toBe('Not logging.');
  });

  it('says when the logger is busy with another deal', () => {
    expect(dockView({ id: 'dl-101', brand: 'Linear' }, running).headline).toBe('Logging dl-104, not this one.');
  });

  it('names a placement OBS does not have, because the log will never see it', () => {
    const view = dockView(hetzner, running);
    expect(stateOf(view, 'Sponsor lower third')).toBe('not-in-obs');
    expect(stateOf(view, 'Sponsor overlay')).toBe('watched');
    expect(view.headline).toBe('Logging. The stream is not live, so nothing counts yet.');
  });

  it('tells in the program feed from on air: showing before the stream is live counts for nothing', () => {
    const showing = { ...running, placements: [{ source: 'Sponsor overlay', inProgram: true, onAirSince: null }] };
    const view = dockView(hetzner, showing);
    expect(stateOf(view, 'Sponsor overlay')).toBe('in-program');
    expect(view.tone).toBe('logging');
  });

  it('says what is on air now, and since when', () => {
    const view = dockView(hetzner, {
      ...running, streamLive: true,
      placements: [
        { source: 'Sponsor overlay', inProgram: true, onAirSince: '2026-09-20T14:05:00.000+00:00' },
        { source: 'Sponsor slate', inProgram: false, onAirSince: null },
      ],
    });
    expect(view.headline).toBe('On air: Corner emblem.');
    expect(view.tone).toBe('on-air');
    expect(view.placements.find((p) => p.kind === 'emblem')?.since).toBe('2026-09-20T14:05:00.000+00:00');
    expect(dockView(hetzner, { ...running, streamLive: true }).headline).toBe('Live and logging. No placement is on air.');
  });
});

describe('dockUrl', () => {
  it('is one address for every deal, and a page Vite serves too', () => {
    expect(dockUrl('http://127.0.0.1:5180')).toBe('http://127.0.0.1:5180/dock.html');
  });
});
