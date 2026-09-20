import { describe, expect, it } from 'vitest';
import { adsOf, findAds, type Ad } from './ads';
import { DEFAULT_TERMS } from './pricing';
import type { Deal } from './types';

const deal = (over: Partial<Deal>): Deal => ({
  id: 'dl-104', prospectId: 'p1', brand: 'Hetzner', outcome: 'won', lostReason: null, closedOn: '2026-09-10',
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 1, tier2: 0, tier3: 0 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 450,
  flooredByProduction: true, fitAtClose: 70, agreed: 400, deliveredOn: '', paidOn: '', seal: null, sightings: [],
  sponsorArt: null, notes: '', ...over,
});

const deals = [
  deal({ id: 'dl-104', brand: 'Hetzner', closedOn: '2026-09-10' }),
  deal({ id: 'dl-101', brand: 'Linear', closedOn: '2026-08-01', deliveredOn: '2026-08-20', platform: 'youtube', format: 'dedicated' }),
  deal({ id: 'dl-102', brand: 'Glossier', outcome: 'lost', lostReason: 'budget' }),
  deal({ id: 'dl-107', brand: 'Núcleo', closedOn: '2026-09-18', prospectId: '' }),
  deal({ id: 'dl-105', brand: 'hetzner', closedOn: '2026-09-12' }),
];
const ads = adsOf(deals);
const ids = (found: Ad[]) => found.map((ad) => ad.dealId);
const everything = { query: '', filter: 'all', sort: 'sponsor' } as const;

describe('adsOf', () => {
  it('is every won deal and no lost one, because a lost deal has nothing to put on stream', () => {
    expect(ids(ads).sort()).toEqual(['dl-101', 'dl-104', 'dl-105', 'dl-107']);
  });

  it('says what was sold, whether it is delivered, and whether it was made directly', () => {
    const linear = ads.find((ad) => ad.dealId === 'dl-101');
    expect(linear?.placement).toBe('Dedicated video on YouTube');
    expect(linear?.delivered).toBe(true);
    expect(ads.find((ad) => ad.dealId === 'dl-107')?.direct).toBe(true);
    expect(linear?.direct).toBe(false);
  });
});

describe('findAds', () => {
  it('lists by sponsor, A to Z, whatever the capitals and accents, and breaks ties the same way every time', () => {
    expect(ids(findAds(ads, everything))).toEqual(['dl-104', 'dl-105', 'dl-101', 'dl-107']);
  });

  it('or newest first', () => {
    expect(ids(findAds(ads, { ...everything, sort: 'newest' }))).toEqual(['dl-107', 'dl-105', 'dl-104', 'dl-101']);
  });

  it('finds a sponsor by part of its name, in any case, with or without the accent', () => {
    expect(ids(findAds(ads, { ...everything, query: 'HETZ' }))).toEqual(['dl-104', 'dl-105']);
    expect(ids(findAds(ads, { ...everything, query: 'nucleo' }))).toEqual(['dl-107']);
  });

  it('finds by what was sold and by deal id, and every word has to match', () => {
    expect(ids(findAds(ads, { ...everything, query: 'youtube' }))).toEqual(['dl-101']);
    expect(ids(findAds(ads, { ...everything, query: 'dl-105' }))).toEqual(['dl-105']);
    expect(ids(findAds(ads, { ...everything, query: 'hetzner youtube' }))).toEqual([]);
  });

  it('separates what is still to deliver from what is done', () => {
    expect(ids(findAds(ads, { ...everything, filter: 'delivered' }))).toEqual(['dl-101']);
    expect(ids(findAds(ads, { ...everything, filter: 'to-deliver' }))).not.toContain('dl-101');
  });

  it('never reorders the list it was given', () => {
    const before = ids(ads);
    findAds(ads, everything);
    expect(ids(ads)).toEqual(before);
  });
});
