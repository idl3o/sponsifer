# New-creator sponsorship economics: evidence, September 2026

A sweep of what creators with small audiences are actually paid, gathered to test the assumptions in `src/domain/benchmarks.ts`. It separates **asking** prices (rate cards, agency guides) from **paid** prices (transactions, verified reviews) wherever the source allows. Those are different quantities, and conflating them is how creator rate discourse became unreliable.

GBP conversions use $1.33 = £1. Reliability: **high** for primary, peer-checkable data; **medium** for vendor marketplace data with large samples; **low** for guides that recycle one another.

## The one curve worth building on

Smith, *Influencer Dynamics*, working paper, 29 April 2026. The figures below were checked against the paper itself.

- It regresses log pay per deliverable on log followers across **15,047** accepted, verified deal reviews from FYPM. Declined collaborations are excluded.
- The coefficient is **0.489** (s.e. 0.006), with R² 0.33. It rises to 0.509 on Instagram followers alone.
- Predicted pay is **$145 per deliverable at 10,000 followers**, and **$448 at 100,000**.

Pay grows roughly with the square root of audience: doubling followers raises pay by about 40%. Sponsifer's media value is linear in views, and the production floor flattens it at the bottom. The paid market is a smooth concave curve. Follower count explains about a third of the variation, so this is a reference line, not a price.

This data is mostly Instagram and TikTok deliverables. It does not validate YouTube, newsletter or podcast pricing.

## Paid and asking prices

| Format | Platform | Audience | Price | Asking or paid | Source | Reliability |
|---|---|---|---|---|---|---|
| Per deliverable | Instagram, TikTok | 1k / 10k / 100k followers | $47 / $145 / $448 | Paid | Smith 2026 (FYPM) | High |
| Per collaboration | Instagram | Mostly nano and micro | $214 ask, $193 paid | Both | Collabstr 2026 report (2025 data, ~21k deals) | Medium |
| Per collaboration | TikTok | Same | $182 ask, $186 paid | Both | Collabstr 2026 | Medium |
| Per collaboration | YouTube | Same | $311 ask, $255 paid | Both | Collabstr 2026 | Medium |
| UGC video | Any | No audience | $180 ask, $154 paid | Both | Collabstr 2026 | Medium |
| UGC video, bundled | Billo, Influee | No audience | $36–83 | Posted to brands | ppc.io, Jan 2026 | Medium |
| Feed / reel / story | Instagram, UK | 1–5k | £250–350 / £300–400 / £150–200 | Asking | SevenSix report 2023 | Medium |
| Dedicated video | YouTube, UK | 1–5k subscribers | £200–450; integration ≈ 40% of this | Asking | SevenSix 2023 | Medium |
| Host-read, 60s | Podcast | Network-wide | CPM $21–22 (£16–17) | Paid | AdvertiseCast / Libsyn 2024 | High |
| Primary slot | Newsletter | 3k / 5k / 10k subscribers | $75–150 / $125–250 / $250–500 | Marketplace guidance | Paved, July 2026 | Medium |

Across Collabstr's deals, 80% cost under $300 and 2% over $1,000. No primary per-view CPM data was found for YouTube, TikTok or Instagram. Every per-view figure found traces back to listicles.

## How new creators get paid

- **Christin and Lu (2023), 631 exchanges, 40% UK:** 65% involved cash, 31% gifts, 4% a discount code only, 0.6% commission only, and 4.8% nothing. It is not a representative sample, and it is skewed upward because respondents were asked for their highest deal.
- **Linktree (2022, 9,500+ creators):** two-thirds had never done a brand deal. Of those who had, 53% earned under $100 per deal.
- **Collabstr:** UGC rose from 15% to 35% of campaigns between 2024 and 2025, and asking prices fell 13–44% by platform. Volume is shifting towards the asset market, and prices in it are falling.
- **Affiliate:** TikTok Shop's average commission is about 13% (low reliability). Amazon pays 1–20% by category (its own schedule).

## Usage rights and whitelisting

- **The convention is a percentage of the base fee per 30-day period:** 20–30% for whitelisting, 30–50% for usage, 2–3× for perpetual. These are **guide and asking figures only**, and no transaction data was found.
- **51% of influencers charge extra for whitelisting** (Lumanu / Collectively survey, 400+). Smaller accounts charge less often.
- **UGC marketplaces bundle perpetual rights into the base price.** For creators paid for the asset, usage is currently priced at close to nothing.
- **The only structures found that scale usage fees with the buyer's reach belong to represented performers.** Equity's UseFee calculator prices use by the ad buy's TVRs or impressions. SevenSix's formula adds territory, media and term percentages. Neither depends on the creator's own audience.

## Prior art for a pooled, explainable benchmark

| Project | What it is | How it differs |
|---|---|---|
| FYPM | Verified deal reviews, paywalled | Lookup only; no model, no per-factor rationale |
| @InfluencerPayGap | Anonymous posts | Unstructured; skewed to each creator's best deal |
| NUJ Rate for the Job | Pooled, confidential, **paid** rates | A table, not a model; journalism |
| SevenSix report | Agency survey with an **explicit usage formula** | Asking prices |
| Equity UseFee | Open calculator, usage indexed to impressions | Structure without market data |
| Smith 2026 | An explainable elasticity from pooled paid data | A paper, not a tool |

Nothing found combines open access, pooled paid deals and a rationale for every factor. That is an absence in one search, not proof none exists, and it should be checked again before any claim of novelty.

## Weak sources to discount

- Collabstr's 2026 report repeats a UGC figure from its 2025 report ($209 → $197) that contradicts its own $154 table. It also calls a fall from $418 to $255 63%, when it is 39%.
- A widely repeated eMarketer figure ("49.9% of US spend goes to nano and micro creators") could not be traced to its original.
