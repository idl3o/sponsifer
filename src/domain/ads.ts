/**
 * The ads a creator has made, as a library to search rather than a list to
 * scroll. An ad is a won deal seen from the stream's side: whose it is, what
 * was sold, whether its art is in, whether it has been delivered.
 *
 * Nothing new is stored. The library is a view of the deals, so an ad cannot
 * exist that the log, the report and the overlay do not also know about.
 */

import { FORMAT_LABEL, PLATFORM_LABEL } from './benchmarks';
import { madeDirectly } from './deals';
import type { Deal } from './types';

export interface Ad {
  dealId: string;
  brand: string;
  /** What was sold, e.g. "Stream segment on Twitch". */
  placement: string;
  closedOn: string;
  delivered: boolean;
  /** Whether the sponsor's own image or wording has been added to the emblem. */
  hasArt: boolean;
  /** Made directly, rather than closed from a prospect. */
  direct: boolean;
}

export type AdFilter = 'all' | 'to-deliver' | 'delivered';
export type AdSort = 'sponsor' | 'newest';

export const AD_FILTERS: ReadonlyArray<{ value: AdFilter; label: string }> = [
  { value: 'all', label: 'Every ad' },
  { value: 'to-deliver', label: 'Still to deliver' },
  { value: 'delivered', label: 'Delivered' },
];

export const AD_SORTS: ReadonlyArray<{ value: AdSort; label: string }> = [
  { value: 'sponsor', label: 'Sponsor, A to Z' },
  { value: 'newest', label: 'Newest first' },
];

/** Every won deal, as an ad. Lost deals have nothing to put on stream. */
export function adsOf(deals: readonly Deal[]): Ad[] {
  return deals
    .filter((deal) => deal.outcome === 'won')
    .map((deal) => ({
      dealId: deal.id,
      brand: deal.brand,
      placement: `${FORMAT_LABEL[deal.format]} on ${PLATFORM_LABEL[deal.platform]}`,
      closedOn: deal.closedOn,
      delivered: deal.deliveredOn !== '',
      hasArt: deal.sponsorArt !== null,
      direct: madeDirectly(deal),
    }));
}

/** Lower-cased and stripped of accents, so "Núcleo" is found by "nucleo". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * The ads matching a search, in a stable order. Every word of the query must
 * appear somewhere in the sponsor, the placement or the deal id, so "hetz
 * stream" narrows rather than widens.
 */
export function findAds(
  ads: readonly Ad[],
  { query, filter, sort }: { query: string; filter: AdFilter; sort: AdSort },
): Ad[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = ads.filter((ad) => {
    if (filter === 'delivered' && !ad.delivered) return false;
    if (filter === 'to-deliver' && ad.delivered) return false;
    const haystack = fold(`${ad.brand} ${ad.placement} ${ad.dealId}`);
    return words.every((word) => haystack.includes(word));
  });
  const bySponsor = (a: Ad, b: Ad) => fold(a.brand).localeCompare(fold(b.brand)) || a.dealId.localeCompare(b.dealId);
  const byNewest = (a: Ad, b: Ad) => b.closedOn.localeCompare(a.closedOn) || b.dealId.localeCompare(a.dealId);
  return [...matches].sort(sort === 'sponsor' ? bySponsor : byNewest);
}
