/**
 * Core domain vocabulary for Sponsifer.
 *
 * Everything here is plain data: no clock reads, no randomness, no I/O.
 * The pricing and scoring engines are pure functions over these shapes, so a
 * given profile always yields the same rate card — a creator can defend a
 * number in a negotiation because the derivation is reproducible.
 */

export type Platform =
  | 'youtube'
  | 'youtube-shorts'
  | 'tiktok'
  | 'instagram'
  | 'twitch'
  | 'x'
  | 'newsletter'
  | 'podcast';

export type Format =
  | 'dedicated'
  | 'integration'
  | 'mention'
  | 'short'
  | 'reel'
  | 'story'
  | 'post'
  | 'stream'
  | 'primary-slot'
  | 'classified'
  | 'episode-read';

/** Broad advertiser category. Drives willingness-to-pay per impression. */
export type Niche =
  | 'finance'
  | 'b2b-software'
  | 'technology'
  | 'health-fitness'
  | 'education'
  | 'beauty'
  | 'food-drink'
  | 'travel'
  | 'gaming'
  | 'entertainment'
  | 'lifestyle';

/** Audience geography tiers, by advertiser spend per head. */
export interface GeoSplit {
  /** US, UK, CA, AU, DE, NO, CH, SG — highest advertiser spend. */
  tier1: number;
  /** Western/Northern Europe, JP, KR, NZ, IE, NL and similar. */
  tier2: number;
  /** Everywhere else. */
  tier3: number;
}

/** One place a creator can sell an ad slot. */
export interface Channel {
  id: string;
  platform: Platform;
  /** Display handle, e.g. "@kernowbuilds". */
  handle: string;
  followers: number;
  /**
   * Median views (or opens, or concurrent viewers) on a recent representative
   * post. Median, not mean — one viral outlier should not price the next deal.
   */
  medianViews: number;
  /** Engagement actions (likes + comments + shares) as a fraction of views, 0..1. */
  engagementRate: number;
  /** Formats this channel actually sells. */
  formats: Format[];
}

export interface CreatorProfile {
  name: string;
  tagline: string;
  niche: Niche;
  /** Audience country mix; shares should sum to 1 but are normalised anyway. */
  geo: GeoSplit;
  channels: Channel[];
  /** Free-text proof: past sponsors, campaign results, testimonials. */
  proofPoints: ProofPoint[];
  contactEmail: string;
}

export interface ProofPoint {
  id: string;
  /** e.g. "Notion, Mar 2026 — 60s integration". */
  label: string;
  /** e.g. "4,100 clicks, 380 signups, £2.10 CAC". */
  result: string;
}

/** Commercial terms that move the price away from raw media value. */
export interface DealTerms {
  /** Days of category exclusivity granted to the sponsor. 0 = none. */
  exclusivityDays: 0 | 30 | 60 | 90 | 180;
  /** What the sponsor may do with the asset once it exists. */
  usageRights: UsageRights;
  /** Included revisions beyond the first cut. */
  revisions: number;
  /** True if the sponsor wants delivery inside two weeks. */
  rush: boolean;
  /** Number of assets bought together; volume earns a discount. */
  bundleSize: number;
  /**
   * The sponsor's declared paid spend behind the asset, GBP. Zero when not
   * declared. When known, paid usage is priced against it as well as against
   * the placement, because that spend is what the usage is worth to them.
   */
  declaredSpend: number;
  /**
   * Offer the introductory rate. Honoured only while the creator has no
   * results on record; after the first, it lapses whatever this says.
   */
  introductory: boolean;
}

export type UsageRights =
  /** Lives on the creator's channel only. */
  | 'organic-only'
  /** Sponsor may run paid spend behind the creator's handle. */
  | 'whitelisting-30'
  | 'whitelisting-90'
  /** Sponsor may re-cut and run the footage anywhere, in perpetuity. */
  | 'full-buyout';

/** One priced line on a rate card. */
export interface RateLine {
  channelId: string;
  platform: Platform;
  format: Format;
  /** Impressions the sponsor should expect to pay for. */
  effectiveImpressions: number;
  /** Base CPM before any adjustment, in GBP. */
  baseCpm: number;
  /** Ordered, named multipliers and uplifts applied to the base. */
  adjustments: Adjustment[];
  /** What the audience alone is worth, before any production floor applies. */
  mediaValue: number;
  /** The least this asset can sell for and still be worth making. */
  productionFloor: number;
  /**
   * True when the labour of making the asset, not the size of the audience,
   * is setting the price. Small creators are almost always in this case, and
   * the interface says so rather than quietly quoting a media number.
   */
  flooredByProduction: boolean;
  /** Recommended asking price, rounded to a negotiable increment. */
  target: number;
  /** Walk-away price. Below this, decline. */
  floor: number;
  /** Opening ask when the sponsor is large or the brief is demanding. */
  stretch: number;
  /** True when the introductory rate is applied to this line. */
  introductory: boolean;
  /** What creators of this size are typically paid, where evidence exists. */
  market: MarketReference | null;
}

/**
 * What the paid market pays a creator of this size for this kind of
 * deliverable. A reference beside the price, never an input to it.
 */
export interface MarketReference {
  /** Typical pay per deliverable, GBP, rounded. */
  typical: number;
  followers: number;
  /** Whether the card's organic price sits below, near or above it. */
  position: 'below' | 'in-line' | 'above';
  /** One sentence the creator can use, naming the source. */
  sentence: string;
}

export interface Adjustment {
  label: string;
  /** Multiplicative factor, e.g. 1.15 for a +15% uplift. */
  factor: number;
  /** One line the creator can say out loud to justify it. */
  rationale: string;
}

export type PipelineStage =
  | 'researching'
  | 'contacted'
  | 'replied'
  | 'negotiating'
  | 'won'
  | 'lost';

/** A brand worth pitching, plus everything known about the conversation. */
export interface Prospect {
  id: string;
  brand: string;
  product: string;
  niche: Niche;
  /** Named person, if known. Blank means "still researching". */
  contactName: string;
  contactEmail: string;
  /** What the sponsor is believed to pay per placement, in GBP. */
  budgetBand: [number, number];
  /** Countries the sponsor actually sells into. */
  sellsInto: Array<keyof GeoSplit>;
  /** Evidence they already sponsor creators: links, campaign notes. */
  evidence: string;
  stage: PipelineStage;
  /** ISO date (YYYY-MM-DD) of last outbound contact, or empty. */
  lastContactedOn: string;
  notes: string;
}

export type Verdict = 'strong' | 'worth-a-shot' | 'weak';

export interface FitScore {
  /** 0..100. */
  total: number;
  components: Array<{ label: string; score: number; max: number; note: string }>;
  verdict: Verdict;
}

export type DealOutcome = 'won' | 'lost';

export type LostReason = 'budget' | 'timing' | 'no-reply' | 'poor-fit' | 'i-declined' | 'other';

/**
 * A closed conversation, frozen at the moment it closed.
 *
 * Everything the price depended on is copied in rather than referenced, so the
 * record still means the same thing after the profile, the prospect or the
 * benchmarks change. Won deals are the ground truth the benchmarks lack; lost
 * deals are the half of it no public rate survey ever sees.
 */
export interface Deal {
  id: string;
  /** The prospect this closed, which may since have been deleted. */
  prospectId: string;
  brand: string;
  outcome: DealOutcome;
  /** Why it was lost. Null when won. */
  lostReason: LostReason | null;
  /** ISO date the outcome was recorded. */
  closedOn: string;
  platform: Platform;
  format: Format;
  niche: Niche;
  geo: GeoSplit;
  followers: number;
  medianViews: number;
  engagementRate: number;
  terms: DealTerms;
  /**
   * Days of paid running the licence granted, counted from the first paid run.
   * Frozen at close, because the licence is what was agreed, not what the
   * benchmarks later say the tier means. Null means unlimited.
   */
  paidUsageDays: number | null;
  /** The tool's target price when the deal closed, in GBP. */
  quoted: number;
  flooredByProduction: boolean;
  /** Fit score when the outcome was recorded, 0..100. */
  fitAtClose: number;
  /** GBP actually agreed. Zero when lost. */
  agreed: number;
  /** ISO date the asset was delivered, or empty. */
  deliveredOn: string;
  /** ISO date the invoice was paid, or empty. */
  paidOn: string;
  /** Present only when the creator chose to seal the delivered asset. */
  seal: SealSummary | null;
  sightings: Sighting[];
  /** The sponsor's emblem for the stream overlay. Null until the creator adds one. */
  sponsorArt: SponsorArt | null;
  notes: string;
}

/**
 * What the `sponsifer seal` CLI records about a sealed asset. The full signed
 * receipt lives in the CLI's ledger and with the sponsor; this is enough for
 * the app to show the deal is sealed and to match a verified sighting.
 */
export interface SealSummary {
  /** Watermark payload, hex. A pointer to the receipt, never the terms. */
  serial: string;
  /** SHA-256 of the canonical receipt, hex. */
  commitment: string;
  sealedOn: string;
  /** ISO timestamp from the timestamp authority. */
  timestampedAt: string;
}

/** A paid ad found running the creator's asset, e.g. in a public ad library. */
export interface Sighting {
  id: string;
  /** Where it was seen: an ad library link or a note. */
  source: string;
  /** The date the ad library says the ad started running. */
  startedOn: string;
  /** The date it was last seen still running. */
  seenOn: string;
  /**
   * True only when `sponsifer verify` decoded the watermark and checked the
   * timestamp. A sighting without it is still a claim the contract supports;
   * it is just not evidence a sponsor cannot argue with.
   */
  verified: boolean;
}

/** How the creator's own mark appears on the shop board. */
export type MarkMode = 'monogram' | 'logo' | 'board-image';

/** Where the board sits on a landscape preview. */
export type LandscapePosition = 'lower-left' | 'upper-left' | 'lower-right';

/** Where the board sits on a vertical preview. The bottom sits under the app's own UI. */
export type VerticalPosition = 'upper-left' | 'middle-left' | 'bottom';

/**
 * The creator's visible mark on clip previews: the board that advertises
 * their shop window. The creator designs it; the renderer always adds the
 * PREVIEW label, and on public previews the link, whatever the design says.
 */
export interface BoardSpec {
  mark: MarkMode;
  /** Up to three characters. Empty means the profile name's initials. */
  monogram: string;
  /** The uploaded image as a PNG data URL, downscaled on upload. Empty when none. */
  image: string;
  /** The image's width divided by its height. Zero when there is no image. */
  imageAspect: number;
  /** Empty means the first channel's handle. */
  handle: string;
  cta: string;
  /** Where each moment's listing lives, without the scheme, e.g. "kernow.build/m/". */
  linkBase: string;
  showQr: boolean;
  landscape: LandscapePosition;
  vertical: VerticalPosition;
  /** The board's accent, as #rrggbb. */
  accent: string;
  /** Strength of the tiled PREVIEW pattern, 0.04 to 0.3. Never zero on a preview. */
  pattern: number;
}

/** Which corner of the stream frame the emblem sits in. */
export type EmblemCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type EmblemShape = 'pill' | 'rounded' | 'square';

/** How the line beside the Ad label names the sponsor. The label itself is not a choice. */
export type Wording = 'sponsored-by' | 'powered-by' | 'with-thanks-to' | 'brand-only';

/**
 * The creator's house style for the stream emblem: where it sits, how big,
 * what colours, and how it moves. One per workspace, applied to every deal's
 * overlay. The sponsor's own image and wording live on the deal.
 */
export interface EmblemStyle {
  corner: EmblemCorner;
  /** Distance from the corner, in reference units of a 960 x 540 frame, 0 to 120. */
  inset: number;
  /** The badge's height as a share of the frame's height, 0.03 to 0.12. */
  size: number;
  /** #rrggbb. The label's colour, unless the deal's art names its own. */
  accent: string;
  background: string;
  text: string;
  shape: EmblemShape;
  /** Draw only the image and the label, with no line of text. */
  bareLogo: boolean;
  /** Slide in when the source first appears. */
  entrance: boolean;
  /** Pulse the label every so often, so a viewer who joined late still sees it. 0 is off. */
  reshowEveryMinutes: number;
}

/** The sponsor's part of the emblem, kept on their deal. */
export interface SponsorArt {
  /** A PNG data URL, downscaled on upload. Empty for no image. */
  image: string;
  imageAspect: number;
  wording: Wording;
  /** The sponsor's brand colour for the label, or null for the house accent. */
  accent: string | null;
}
