# Streams and overlays: what the evidence supports, September 2026

Gathered to answer one question — should `src/domain/benchmarks.ts` carry a price for a sponsor's logo sitting in the corner of a live stream? — and a second that arrived with it: do the Twitch numbers already in the file survive contact with transaction data?

It follows the house rule. Every figure is marked **asking** (rate cards, guides, calculators) or **paid** (a transaction actually happened), with a reliability rating and a source. GBP conversions use $1.33 = £1. The conclusions are at the top because both are negative, and a negative result is a result.

## Two findings

**One: there is no primary evidence of what a persistent on-screen placement sells for, and the only hard evidence about whether anyone looks at one argues against pricing it by time or by impressions.** No overlay format is added to the benchmarks.

**Two: the Twitch figures already in the file are cross-checked by two independent paid sources, and survive.** The £12 stream-segment CPM sits inside the lower of the two incompatible pricing worlds the literature describes, and the £120 production floor lands within a few pounds of the average Twitch deal that actually completes.

A third thing, which is not a price but changes how the rate card should be read: **Twitch creators ask about three times what they are paid.**

## The asking-and-paid gap, which is the most useful number here

Collabstr's marketplace data is the only dataset found with a stated sample, explicit transaction prices, and both sides of the gap.

| Figure | Asking or paid | Source | Reliability |
|---|---|---|---|
| Twitch: **$398 listed, $127 realised — a 32% capture rate** | Both | Collabstr 2026 report, via Tubefilter and PocketGamer.biz, 8 Sep 2026 | **Medium-high.** 21,000+ completed, paid collaborations; each rate cell backed by at least three completed orders |
| YouTube: **$311 listed, $255 realised — 82% capture** | Both | Same | Medium-high |
| Twitch gaming, **$165.70 average per completed deal**; YouTube gaming $203.35 | Paid | Same | Medium-high |
| Twitch quarterly: $87.50 (2023 Q4) → $244.23 (2025 Q4) → $215.50 (2026 Q1) | Paid | Same | Medium |
| **About 80% of all influencer collaborations are priced under $300** | Paid | Same | Medium-high |

The caveat matters: Collabstr is a self-serve gig marketplace, its deliverable is a sponsored post rather than a live sponsored segment, and it holds roughly fifteen times more YouTube deals than Twitch ones. **$165 is not the price of a sponsored hour.** What it is good evidence for is the shape of the market: small deals, and a far wider gap between ask and settlement on Twitch than on YouTube.

That gap is the opposite of the reassurance a rate-card tool usually offers. A creator told to ask £400 should know the median Twitch ask is discounted by about two thirds before money moves. Sponsifer's own walk-away price exists for exactly this, and this is the first external evidence that the walk-away number, not the ask, is where a Twitch negotiation lands.

## The $1 per concurrent viewer per hour rule

The most-repeated number in live-stream sponsorship, and its provenance does not exist.

- The earliest attributable use found is a streamer's own blog, **Psyche Plays, 16 March 2022**, quoting **$1.50 per CCV per hour** as her own rate, sourced explicitly to "I know this to be a common rate amongst other content creators of similar size to me". Peer hearsay, honestly labelled as such. *Asking.*
- **StreamScheme's rate card** (26 December 2025) gives $0.80–1.20 per CCV per hour as a "commonly-cited starting range" and **cites nothing**. The Wayback index holds one snapshot of it, from February 2026, so it restates the rule rather than originating it.
- **influencerfee.com** gives per-tier rates and then discloses in its own footer that they are "generated **algorithmically**… they do not constitute a binding offer, valuation, or guarantee of actual market rates". These are synthetic numbers wearing the clothes of evidence.
- **inStreamly**, a company that actually runs these campaigns and could cite its own data, repeats "around one dollar per concurrent viewer per hour" in a June 2026 post **without citing its own campaigns**.

**And the corpus contradicts itself by two orders of magnitude.** Against $1 per CCV per hour, one cluster of guides quotes **$0.01–0.05 per viewer per hour**, and another **$10–25 per thousand average viewers** for a sponsored segment. The first is $1,000 per thousand concurrent viewers per hour; the others are $10–50. These are not variations, they are incompatible pricing worlds, and no source reconciles them. Averaging is not available.

**Where Sponsifer sits, and why that is reassuring.** The engine prices a Twitch stream segment at a **£12 CPM on concurrent viewers**. That is squarely inside the $10–25 per thousand cluster (£7.50–19), and about sixty times below the $1-per-CCV folklore. The engine is consistent with the half of the literature that has any arithmetic behind it, and inconsistent with the half that admits to being generated. No change is warranted; the coincidence is worth recording so the next person to find the $1 rule knows it was considered and declined.

**Second cross-check.** The production floor for a stream segment is **£120**. Collabstr's average completed Twitch deal is **$165.70, about £125**. A floor derived from the hours the work costs lands within a few pounds of the observed average transaction, from an unrelated source and a different method. That is the strongest evidence the floor has ever had.

## What the sponsor's side looks like

**Huang and Morozov, "The Promotional Effects of Live Streams by Twitch Influencers," *Marketing Science* 44(4): 916–932 (2025).** Top 60,000 Twitch streamers, polled every ten minutes, May to December 2021.

- **Median return on investment for a sponsored stream is about −95%.** Only about 16% of games show positive returns.
- Organic streams move game usage about **six times** more than sponsored ones.
- Viewership-to-player elasticity is **0.027**.
- The paper estimates streamers earn about **$144 an hour from subscriptions**, and uses it as a floor for what a sponsorship must beat. The authors call their cost side "a crude estimate". **It is not an observed sponsorship price and must not be used as one.**

**Reliability: high** for the ROI and elasticity results.

This is uncomfortable evidence for anyone selling sponsored streams, and it belongs in a tool that claims to be honest. If the median sponsored stream loses the sponsor most of its money, the ceiling on stream sponsorship prices is not set by what creators can justify but by what sponsors keep discovering. It also sharpens the case for the production floor: a market that disappoints its buyers is one where price pressure comes downward hard, and where a creator needs a number below which the answer is simply no.

## What a persistent overlay sells for

Nothing that can be cited.

| Figure | Asking or paid | Source | Reliability |
|---|---|---|---|
| Passive overlay and chat-bot sponsorship, $500–1,500 a month | Asking | Launchpoint rate guide, March 2026 | **Low.** Its cited sources are another rate-guide site and "GitHub README guides" |
| Overlay packages $500–5,000 a month; retainers $3,000–30,000 | Asking | influencerfee.com, 2026 | **None.** Declared algorithmically generated by its own publisher |
| A logo overlay is worth "20–40% of an hourly rate" | Asking | Repeated across several guides; no origin located | **None.** The most-repeated claim about persistent placement, provenance unestablished. Folklore |
| Logo overlay listed as an add-on with **no price**, needing a quote per deal | — | StreamScheme rate card, 26 December 2025 | **High as a negative finding.** The one long-standing human-written guide declines to price it |

No transaction, no leak, no survey, no brand-side disclosure, and no observed effective CPM for a persistent stream logo was found. Quoting the first three as market evidence would be laundering synthetic data.

**A propagating error worth naming.** Several 2025–2026 guides still state that Twitch caps on-screen brand overlays at 3% of screen size. Those guidelines were published on **6 June 2023 and withdrawn on 7 June 2023** after creator backlash, Twitch calling them "overly broad" and its chief executive saying "we messed up". Anything citing the 3% rule as current is repeating a policy that lasted a day, three years ago.

## What the adjacent market does, and how it values the same thing

Sports and esports are the established market for persistent brand presence. NBA jersey patches run to roughly **$20M a year** for a single deal (Lakers/Bibigo, Nets/Webull, Warriors/Rakuten, all paid and reported), against a market of about $350M a year. Esports team sponsorships are quoted at €10,000 regional to €750,000–1.2M at the top (asking, vendor-published, low-medium reliability).

**None of it is a unit rate.** No per-second, per-hour or per-impression price appears anywhere. What the contracts specify instead is **geometry**: logo size, position and visibility as contractual obligations. That is the real analogue for an overlay specification — a spec, not a price.

Valuation after the fact is a different industry, and it is opaque in an instructive way:

- **Nielsen's QI Media Value** captures impressions and time on screen, applies a proprietary Quality Index discounting each exposure for size, position and clarity, then applies advertising rates. The shape is public; **the weights are not**.
- **Relo Metrics' Sponsor Media Value** discounts exposure by six named factors — clarity, visibility, prominence, size, share of voice, placement. Its own methodology post contains no formula, no weightings and no per-second rate.
- **Cost per Exposure Second**, spend divided by qualified on-screen seconds, is the only named unit that prices persistent placement by time. Its only traceable advocate is a computer-vision vendor, and the industry citation it rests on could not be verified. It is a ratio computed after a deal, not a price anyone quotes.

Both methods exist **because raw exposure-seconds overstate value**. Neither will say by how much. And one figure deserves suspicion rather than reuse: a patch costs about $20M a year and Nielsen values its exposure at about $20M a year. A media-value number that lands on the fee it justifies is either a coincidence or a calibration, and no source found interrogates it.

## Whether anyone looks at it

The strongest evidence in this note is academic, and it is unflattering to time-on-screen pricing.

**Mancini et al., "Esports and Visual Attention: Evaluating In-Game Advertising through Eye-Tracking during the Game Viewing Experience," *Brain Sciences* 12(10):1345, 4 October 2022.** Open access, DOI 10.3390/brainsci12101345.

- 47 participants, mean age 23, watching four three-minute Twitch streams of a FIFA20 match, on a Tobii Pro X2-30 eye tracker.
- Share of total visual attention: **all in-game advertising together, 3.49%**. The **chat box took 10.68%**; the streamer's face, 4.60%.
- The two static banners took **1.30%** and **0.61%**, by position. Animated beat static, 1.46% against 1.12%.

**Reliability: high.** Peer-reviewed, apparatus and areas of interest specified, figures read from the paper. Its limits are stated: an all-male sample matched to Twitch's demographics, familiar brands only, one game, three-minute clips. Its corresponding author works for the neuromarketing firm that ran it, which promotes the result commercially; the authors declare no conflict.

Two findings point the same way. A YouTube banner study found nearly every viewer fixated on the banner at least once, but **fewer than 10% could recall what it said**. A mobile-sports study found placement position predicted recall better than fixation duration did. Fixation is not attention, and duration is not recall.

**What that means for a price.** A persistent banner held between 0.6% and 1.3% of viewer attention, and every persistent placement together held less than the chat box. Pricing one on impressions times a CPM overstates it by something like an order of magnitude. And nobody has measured what the sixth hour of the same logo is worth — which is exactly the number an hourly overlay rate would need.

## Disclosure, which is required whatever it is worth

- **The FTC** is the only regulator that addresses the live-stream problem directly: "Since viewers can start watching at any time, they could easily miss a disclosure at the beginning of the stream… If there are multiple, periodic disclosures throughout the stream, people are more likely to see them no matter when they tune in." Responsibility rests with the creator and the brand, never the platform's tool. This is the strongest existing argument for a **persistent** disclosure, and it is about the label, not the logo.
- **The ASA** lists "banners overlaid on the video" as a live-stream ad format (August 2020), and said in January 2024 that it **has never ruled on influencer labelling on Twitch**. CAP's influencer guidance requires a prominent "Ad" label up front, advises **against** "Sponsored", "Spon" and "In partnership with", and never uses the words "live", "logo" or "duration". There is no UK precedent for a persistent on-screen sponsor logo.
- **The CMA** (updated 3 September 2025) requires disclosure at the beginning of video content, obvious as soon as anyone engages with it; a platform tool suffices only if its label is clear and easy to see.
- **Twitch** has a Branded Content Disclosure tool whose viewer notification shows for about ten seconds and carries to the archive. *Unverified: the primary policy page could not be retrieved, so every detail of Twitch's own rules here is secondary.*

The overlay this project ships draws "Ad" and the sponsor's name for as long as it is on screen, which satisfies the strictest reading of all four and costs nothing to keep.

## What this changes in the engine

**Nothing, deliberately.** The Twitch stream segment keeps its £12 CPM on concurrent viewers and its £120 production floor, both now cross-checked. No overlay format is added.

What would change that, in order of how much it would take:

1. **Transaction data on overlays.** Ten or more deals with the fee, the concurrent viewers, the hours on screen, and whether a read was sold alongside. None exists publicly. The deal log this tool already keeps is the most likely place for it to come from.
2. **An attention discount that is not a guess.** The 0.6–1.3% figures are one study, one game, three minutes, and they measure broadcaster-inserted advertising rather than the corner logo a creator adds themselves. Repeating that study for a creator-added overlay across a multi-hour stream is the single most useful piece of research this market lacks.
3. **A published valuation method.** If Nielsen or Relo ever publish their weights, a defensible discount on exposure-seconds becomes possible.

Two open questions for the calibration sweep, recorded rather than acted on:

- Should a Twitch line show the ask differently, given the 32% capture rate? The tool already reports a walk-away price; whether it should say out loud that Twitch asks settle near it is a product decision, not a benchmark change.
- Does the median −95% sponsor ROI belong in the interface? It is true, it is high-reliability, and a creator who knows it negotiates differently. It is also the kind of fact that talks a creator out of asking properly.

## What is declined

- **Inventing an overlay CPM.** The engine prices a segment because there is evidence for a segment. There is none for a logo.
- **Repeating the guide figures as prices.** They are recorded above as artefacts, with the reason at each one.
- **Pricing by screen time.** No transaction data supports it, the attention evidence argues against it, and the adjacent market that does value time on screen does so to justify fees agreed on other grounds.
- **Treating time on screen as delivery evidence on its own.** The on-air log records it because a sponsor asks "was it up?", not because the minutes carry a price.
- **Kick, and YouTube Live as distinct from YouTube video.** Both are evidential blanks. No rate data of any kind was found for either.

## What was searched for and not found

1. Any published rate card, from a named streamer or agency, pricing a persistent logo overlay. Every result was a generated rate-guide page.
2. Any transaction-level figure for an overlay placement, or an observed effective CPM for one.
3. The origin of "20–40% of an hourly rate", or of "$1 per CCV per hour".
4. Nielsen's or Relo's actual weights, discount factors or per-second rates.
5. Any published Twitch or StreamElements sponsorship payout rate. Twitch publishes revenue splits for subscriptions and ads, and nothing for sponsorship.
6. A like-for-like live-versus-pre-roll CPM comparison, on the same measurement basis.
7. Any ASA or CMA ruling on a persistent on-screen sponsor logo in a live stream.
8. Any eye-tracking study of a *creator-added* overlay, as distinct from broadcaster-inserted in-game advertising, or any evidence on attention decay across a multi-hour stream.
9. StreamPlacements' "Small Streamer Sponsorship Survey 2025", whose site returned an error on every attempt. Worth retrying: a survey aimed at exactly this project's audience.
10. FYPM's platform breakdown, which is gated. It is the most promising unexplored source, and the only one likely to hold live-streaming transactions at scale.
