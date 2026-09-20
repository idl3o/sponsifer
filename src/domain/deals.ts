import { PRODUCT } from '../brand';
import { FORMAT_LABEL, NICHE_LABEL, PAID_USAGE, PAID_USAGE_DAYS, PLATFORM_LABEL } from './benchmarks';
import { daysBetween, gbp } from './pitch';
import { hasGeo, normaliseGeo, periodFee, priceLine, roundHard, roundToNegotiable } from './pricing';

export { roundHard };
import { verdictFor } from './scoring';
import type {
  CreatorProfile,
  Deal,
  DealOutcome,
  DealTerms,
  LostReason,
  Prospect,
  RateLine,
  Sighting,
  UsageRights,
  Verdict,
} from './types';

/**
 * The deal log: what actually happened, set against what the tool said.
 *
 * Every function here is pure. The log is the one source of ground truth this
 * project has. It calibrates a single creator's asks against their own closes,
 * and, only if the creator chooses, feeds an anonymised data point back to the
 * shared benchmarks.
 */

export const REPO_URL = 'https://github.com/idl3o/sponsifer';

/** A tier's paid-usage window as JSON can carry it: null for unlimited. */
export function paidDaysFor(usageRights: UsageRights): number | null {
  const days = PAID_USAGE_DAYS[usageRights];
  return Number.isFinite(days) ? days : null;
}

export interface CloseInput {
  id: string;
  outcome: DealOutcome;
  /** GBP agreed. Ignored when lost. */
  agreed: number;
  lostReason: LostReason;
  closedOn: string;
  fitAtClose: number;
}

/**
 * Freeze a closed prospect into a deal record.
 * @param line the placement the conversation was about, priced at close.
 * @returns null when the line's channel no longer exists on the profile.
 */
export function closeDeal(
  profile: CreatorProfile,
  prospect: Prospect,
  line: RateLine,
  terms: DealTerms,
  input: CloseInput,
): Deal | null {
  return freeze(profile, { id: prospect.id, brand: prospect.brand }, line, terms, input);
}

export interface DirectInput {
  id: string;
  /** The sponsor's name, as it should read on the ad. */
  brand: string;
  /** GBP agreed, or 0 when the creator has not recorded a fee. */
  agreed: number;
  closedOn: string;
}

/**
 * A won deal made directly, for a sponsor who never was a prospect: an ad to
 * put on stream without walking the pipeline first. It is a deal like any
 * other, so the overlay, the log and the report work unchanged. It has no
 * prospect, which is how `calibrate` knows it never had a fit score.
 * @returns null when the brand is blank or the line's channel no longer exists.
 */
export function directDeal(profile: CreatorProfile, line: RateLine, terms: DealTerms, input: DirectInput): Deal | null {
  const brand = input.brand.trim();
  if (!brand) return null;
  const close: CloseInput = { id: input.id, outcome: 'won', agreed: input.agreed, lostReason: 'other', closedOn: input.closedOn, fitAtClose: 0 };
  return freeze(profile, { id: '', brand }, line, terms, close);
}

/** True for a deal made directly rather than closed from a prospect. */
export function madeDirectly(deal: Deal): boolean {
  return deal.prospectId === '';
}

function freeze(
  profile: CreatorProfile,
  prospect: { id: string; brand: string },
  line: RateLine,
  terms: DealTerms,
  input: CloseInput,
): Deal | null {
  const channel = profile.channels.find((c) => c.id === line.channelId);
  if (!channel) return null;
  const won = input.outcome === 'won';
  return {
    id: input.id,
    prospectId: prospect.id,
    brand: prospect.brand,
    outcome: input.outcome,
    lostReason: won ? null : input.lostReason,
    closedOn: input.closedOn,
    platform: line.platform,
    format: line.format,
    niche: profile.niche,
    geo: { ...profile.geo },
    followers: channel.followers,
    medianViews: channel.medianViews,
    engagementRate: channel.engagementRate,
    terms: { ...terms },
    paidUsageDays: paidDaysFor(terms.usageRights),
    quoted: line.target,
    flooredByProduction: line.flooredByProduction,
    fitAtClose: input.fitAtClose,
    agreed: won ? Math.max(0, input.agreed) : 0,
    deliveredOn: '',
    paidOn: '',
    seal: null,
    sightings: [],
    sponsorArt: null,
    notes: '',
  };
}

/** Median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/** Below this many won deals, a close ratio is an anecdote. */
export const MIN_DEALS_TO_READ = 3;

export interface Calibration {
  won: number;
  lost: number;
  /** Median of agreed ÷ quoted across won deals with a fee recorded, or null when there are none. */
  closeRatio: number | null;
  /** True when there are enough won deals for the ratio to mean something. */
  readable: boolean;
  /** One sentence the creator can act on. */
  sentence: string;
  byVerdict: Record<Verdict, { won: number; total: number }>;
  lostReasons: Partial<Record<LostReason, number>>;
}

function calibrationSentence(ratio: number | null, won: number): string {
  if (ratio === null) return 'No won deals recorded yet. Record outcomes as they close.';
  const pct = Math.round(ratio * 100);
  const basis = `Across ${won} won deal${won === 1 ? '' : 's'} you agreed a median of ${pct}% of the quoted target.`;
  if (won < MIN_DEALS_TO_READ) return `${basis} Too few to read anything into yet.`;
  if (ratio < 0.9) {
    return `${basis} You are being negotiated down. Open at the stretch price, or treat the target as your real walk-away.`;
  }
  if (ratio > 1.1) return `${basis} Sponsors are paying above the card. Your benchmarks are low; raise them.`;
  return `${basis} The card is landing where it should.`;
}

/**
 * How this creator's deals actually close, against what the tool quoted.
 * Pure function of the log.
 */
export function calibrate(deals: Deal[]): Calibration {
  const won = deals.filter((d) => d.outcome === 'won' && d.quoted > 0);
  const lost = deals.filter((d) => d.outcome === 'lost');
  // A won deal with no fee recorded says nothing about the card. Counting it as
  // a close at 0% would tell a creator they are being negotiated down.
  const paid = won.filter((d) => d.agreed > 0);
  const closeRatio = paid.length > 0 ? median(paid.map((d) => d.agreed / d.quoted)) : null;

  const byVerdict: Calibration['byVerdict'] = {
    strong: { won: 0, total: 0 },
    'worth-a-shot': { won: 0, total: 0 },
    weak: { won: 0, total: 0 },
  };
  for (const deal of deals) {
    // A deal made directly never had a fit score, so it cannot test whether the score predicts anything.
    if (madeDirectly(deal)) continue;
    const bucket = byVerdict[verdictFor(deal.fitAtClose)];
    bucket.total += 1;
    if (deal.outcome === 'won') bucket.won += 1;
  }

  const lostReasons: Calibration['lostReasons'] = {};
  for (const deal of lost) {
    const reason = deal.lostReason ?? 'other';
    lostReasons[reason] = (lostReasons[reason] ?? 0) + 1;
  }

  return {
    won: won.length,
    lost: lost.length,
    closeRatio,
    readable: paid.length >= MIN_DEALS_TO_READ,
    sentence: calibrationSentence(closeRatio, paid.length),
    byVerdict,
    lostReasons,
  };
}

/** "Q3 2026" from an ISO date. */
export function quarterOf(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  if (!year || !month) return '';
  return `Q${Math.ceil(month / 3)} ${year}`;
}

/** Labels exactly as the rate-data issue form spells its dropdown options. */
const FORM_RIGHTS: Record<UsageRights, string> = {
  'organic-only': 'Organic only, my channel',
  'whitelisting-30': 'Paid whitelisting, roughly 30 days',
  'whitelisting-90': 'Paid whitelisting, roughly 90 days',
  'full-buyout': 'Full buyout, anywhere, indefinitely',
};

function geographyPhrase(deal: Deal): string {
  if (!hasGeo(deal.geo)) return 'not recorded';
  const g = normaliseGeo(deal.geo);
  const five = (x: number) => Math.round((x * 100) / 5) * 5;
  return `about ${five(g.tier1)}% top-spend markets, ${five(g.tier2)}% second tier, ${five(g.tier3)}% elsewhere`;
}

/**
 * A link that opens the rate-data issue form, pre-filled from a won deal.
 *
 * Only rounded, unattributed figures go in: no brand, no handle, no exact view
 * count, no exact date. The creator still reads the form and presses submit,
 * but the figures travel to GitHub in the address as soon as the page opens,
 * and the interface says so.
 * @returns null for a lost deal, which has no paid price to report.
 */
export function rateSubmissionUrl(deal: Deal): string | null {
  if (deal.outcome !== 'won' || deal.agreed <= 0) return null;
  const params = new URLSearchParams({
    template: 'rate-data.yml',
    title: `rate: ${PLATFORM_LABEL[deal.platform]} ${FORMAT_LABEL[deal.format].toLowerCase()}, ${roundHard(deal.medianViews).toLocaleString('en-GB')} views`,
    platform: PLATFORM_LABEL[deal.platform],
    format: FORMAT_LABEL[deal.format],
    views: roundHard(deal.medianViews).toLocaleString('en-GB'),
    followers: deal.followers > 0 ? roundHard(deal.followers).toLocaleString('en-GB') : '',
    category: NICHE_LABEL[deal.niche].replace(/ & /g, ' and '),
    geography: geographyPhrase(deal),
    paid: gbp(roundHard(deal.agreed)),
    rights: FORM_RIGHTS[deal.terms.usageRights],
    exclusivity: deal.terms.exclusivityDays > 0 ? `${deal.terms.exclusivityDays} days` : 'none',
    when: quarterOf(deal.closedOn),
    source: deal.paidOn ? 'Mine, money received' : 'Mine, agreed but not yet paid',
    notes: `Submitted from the ${PRODUCT} deal log. The tool quoted ${gbp(roundHard(deal.quoted))}${deal.flooredByProduction ? ', set by the production floor rather than reach' : ''}.`,
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export interface Overrun {
  /** Days of paid running the sighting shows. */
  daysRun: number;
  /** Days of paid running the licence permitted. Infinity for a buyout. */
  permitted: number;
  /** Further periods of paid usage the sponsor took beyond the licence. */
  periodsOver: number;
  /** What each further period costs, GBP, at the rate already agreed. */
  perPeriod: number;
  /** What is owed, in GBP. Zero when within terms. */
  owed: number;
  /** The email paragraph that asks for it. Empty when within terms. */
  sentence: string;
}

/** Re-price a closed deal's placement under different usage rights, from its snapshot. */
function repriceAt(deal: Deal, usageRights: UsageRights): number {
  const channel = {
    id: 'snapshot',
    platform: deal.platform,
    handle: '',
    followers: deal.followers,
    medianViews: deal.medianViews,
    engagementRate: deal.engagementRate,
    formats: [deal.format],
  };
  const profile: CreatorProfile = {
    name: '',
    tagline: '',
    niche: deal.niche,
    geo: deal.geo,
    channels: [channel],
    proofPoints: [],
    contactEmail: '',
  };
  return priceLine(profile, channel, deal.format, { ...deal.terms, usageRights }).target;
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function longDate(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? iso : LONG_DATE.format(t);
}

/**
 * What one further period of paid usage costs on this deal: the same
 * per-period fee that priced the licence, on the organic price as it stood at
 * close, scaled by the discount the sponsor already negotiated, and never
 * below the minimum. Where the sponsor declared a spend, its per-period share
 * counts too.
 */
function overrunPeriodRate(deal: Deal, permitted: number): number {
  const discount = deal.quoted > 0 ? deal.agreed / deal.quoted : 1;
  const organic = repriceAt(deal, 'organic-only');
  const grantedPeriods = permitted / PAID_USAGE.periodDays;
  const spendRate =
    deal.terms.declaredSpend > 0 && grantedPeriods > 0
      ? (PAID_USAGE.shareOfDeclaredSpend * deal.terms.declaredSpend) / grantedPeriods
      : 0;
  const rate = Math.max(periodFee(organic), spendRate) * discount;
  return roundToNegotiable(Math.max(rate, PAID_USAGE.minimumPerPeriod));
}

/**
 * Price a sponsor running an asset beyond its licence.
 *
 * Paid usage is sold by the period, so an overrun is priced as the further
 * periods the sponsor took, at the per-period rate the licence was priced on.
 * That is the defensible number: what they would have paid had they asked, on
 * terms they had already accepted. Market assumptions come from the same
 * benchmarks that priced the deal, applied to the audience as it was when the
 * deal closed.
 */
export function priceOverrun(deal: Deal, sighting: Sighting): Overrun {
  const daysRun = Math.max(0, daysBetween(sighting.startedOn, sighting.seenOn));
  const permitted = deal.paidUsageDays ?? Number.POSITIVE_INFINITY;

  if (daysRun <= permitted || deal.outcome !== 'won') {
    return { daysRun, permitted, periodsOver: 0, perPeriod: 0, owed: 0, sentence: '' };
  }

  const periodsOver = Math.ceil((daysRun - permitted) / PAID_USAGE.periodDays);
  const perPeriod = overrunPeriodRate(deal, permitted);
  const owed = perPeriod * periodsOver;

  const granted =
    permitted === 0 ? 'organic use on my channel only, with no paid running' : `${permitted} days of paid usage from the first paid run`;
  const periods = `${periodsOver} further ${PAID_USAGE.periodDays}-day period${periodsOver === 1 ? '' : 's'} of paid usage`;

  return {
    daysRun,
    permitted,
    periodsOver,
    perPeriod,
    owed,
    sentence: `Our agreement covered ${granted}. The ad started running on ${longDate(sighting.startedOn)} and was still live on ${longDate(sighting.seenOn)}, ${daysRun} days in all, which is ${periods}. At the rate we agreed, that is ${gbp(perPeriod)} a period and ${gbp(owed)} in total. I will send an invoice for it.`,
  };
}
