# The Defensible Number

*Pricing, proving and settling a creator sponsorship on one machine*

S. Lavi · September 2026 · Working draft

## Abstract

A creator with a small audience who is offered a sponsorship has no defensible way to answer the first question a sponsor asks, which is why the price is what it is. Published rates are mostly asking prices, recycled between guides. Paid prices are scarce, paywalled or anonymous, and the tools that exist to connect the two sides are marketplaces that need a counterparty, an account and the creator's data.

This paper describes a single-player tool that takes the opposite shape. It runs on the creator's own machine and transmits nothing. It derives a price as an explicit chain of factors, each carrying a sentence the creator can say aloud in a negotiation. It prices the labour of making an asset separately from the audience that sees it, so that a small creator is never told to sell a day's work for the value of nine hundred impressions. It prices the commercial terms, usage and exclusivity, which small creators habitually give away. It shows what the paid market actually pays beside the price, without letting that reference set it. It records every outcome against the quote, and it lets the creator seal a delivered asset so that a licence overrun can later be demonstrated rather than merely asserted. An experimental extension settles the fee over the Lightning Network, with the invoice bound to the sealed licence.

The paper sets out the design commitments, the pricing derivation, the evidence behind it and the limits of that evidence, the provenance scheme, the settlement extension, related work, open problems, and what the project declines to do.

## 1. A price nobody can defend

Most creators price sponsorship by guessing, or by repeating a figure heard on a podcast. The guess survives until a sponsor asks for its basis, and then it collapses, usually downwards.

The public evidence explains why guessing is the norm. Two-thirds of 9,500 creators surveyed by Linktree in 2022 had never done a brand deal, and of those who had, 53% earned under $100 per deal. In a study of 631 exchanges by Christin and Lu (2023), 65% involved cash, 31% gifts, and nearly 5% nothing at all. Across roughly 21,000 deals on Collabstr in 2025, 80% cost under $300. Meanwhile, the rate guides that circulate most widely quote asking prices, drawn from agency rate cards and from one another, and very rarely say so.

The distinction between asking and paid is the first thing this project enforces. Every figure in its research notes is marked as one or the other, with a reliability rating: high for primary, peer-checkable data, medium for vendor marketplace data with large samples, low for guides that recycle each other.

The second difficulty is that the creator is usually selling more than a placement. A sponsor who wants the video, the right to run it as a paid advertisement for ninety days, and a guarantee that no competitor will appear on the channel for a quarter is buying three things. Most small creators quote one figure and include the other two for nothing.

The third is that nothing a creator delivers carries its terms with it. A sponsor who keeps a thirty-day whitelisted advertisement running on day ninety has bought the ninety-day licence at the thirty-day price, and the creator has no evidence that would survive a dispute.

## 2. Design commitments

Five commitments shape everything that follows. Each was chosen deliberately and is recorded in the project as a decision not to be undone.

**Single-player, not a marketplace.** There is nobody on the other side of the tool. Two-sided creator and brand marketplaces fail on cold-start liquidity and survive only with a sales team, which makes them the wrong shape for software a creator runs alone. The tool is used before and during a negotiation, by one person.

**Local-first, with no telemetry.** Unreleased rates and prospect lists are commercially sensitive. The simplest way to keep them private is never to transmit them. There is no account, no server and no analytics. The workspace is a JSON file the creator controls. The web application is served from the creator's own machine, on the loopback address only.

**A pure derivation.** The pricing, scoring, pitch and deal-log code contains no clock, no randomness and no input or output. The same profile always yields the same rate card, a property the tests assert directly. A pricing tool that returns a different number on Tuesday cannot be defended in a negotiation on Wednesday.

**Every factor carries its rationale.** A price is returned together with the ordered list of factors that produced it, and each factor carries a sentence the creator can say out loud. A number the creator cannot explain is a number they will be talked out of.

**Every market assumption lives in one file, and every change cites evidence.** The cost-per-thousand bands, category multipliers, geography weights, engagement medians, production floors and term uplifts sit in a single module. A constant changed without a cited source, or tuned only until the calibration sweep passes, is treated as a defect.

## 3. The derivation

### 3.1 Media value

The audience's value to a sponsor is priced as a cost per thousand impressions, adjusted for who the audience is and how it behaves:

    media value = (median views ÷ 1,000) × base CPM × category × geography × engagement × terms

*Median views* are used rather than the mean, because one viral outlier should not price the next deal. *Base CPM* is set per platform and format, in pounds, for an audience in the highest-spending markets: £32 for a dedicated YouTube video, £20 for an integration, £11 for an Instagram reel, £55 per thousand opens for a newsletter's primary slot, £19 for a host-read podcast spot.

*Category* reflects advertiser willingness to pay, from 0.75 for entertainment to 1.6 for finance. *Geography* blends three tiers of advertiser spend per head, weighted 1.0, 0.62 and 0.28. An audience with no recorded geography is priced optimistically as top-tier, and the rationale says so and asks the creator to fill it in before quoting.

*Engagement* compares the channel's engagement rate with the platform median. The square root damps the effect, and it is clamped between 0.8 and 1.5: an audience twice as engaged is worth about 40% more, not 100% more, because engagement and purchase intent are correlated but not equal.

### 3.2 The production floor

Cost-per-impression pricing alone has a failure mode that falls hardest on the creators who most need help. A dedicated video takes about a day and a half to concept, script, shoot, edit, brief-check, contract and invoice, whoever makes it. Priced on reach alone, a creator whose videos draw nine hundred views would be told to make one for about £36.

Every format therefore carries a production floor: the least the asset can sell for and still be worth making, derived from the hours it costs at a skilled freelancer's rate. The floor for a dedicated video is £450, for an integration £200, for a short-form video £150, for a feed post £90 and for a host-read spot £60. The commercial terms scale the floor as they scale the media value, because an exclusive, rushed piece is still more work. Audience multipliers do not, because the floor is about the work.

    organic price = max(media value, production floor × terms)

[[figure-floor]]

*Figure 1. A dedicated YouTube video in the technology category, with an all top-tier audience, median engagement and no additional terms. Reach alone prices it at £40 per thousand views. The production floor sets the price until about 11,250 views, after which the audience does.*

| Median views | Reach alone | Production floor | Price |
|---:|---:|---:|---:|
| 900 | £36 | £450 | £450 |
| 5,000 | £200 | £450 | £450 |
| 11,250 | £450 | £450 | £450 |
| 20,000 | £800 | £450 | £800 |
| 30,000 | £1,200 | £450 | £1,200 |

When the floor binds, the interface says so and shows both numbers. It never hides the audience value behind the floor, and it never presents the floor as a statement about the audience. Below the floor, the correct answer is no.

A consequence follows that the tool treats as a rule. A cost per thousand derived from a floored price divides a labour cost by a small audience, and yields figures like £500 per thousand impressions, which ends a negotiation on sight. The rate card hides that figure for floored lines, the blended CPM excludes them, and the pitch composer writes a different sentence for them: the price reflects what the piece costs to make properly, so it does not scale down further. Tests lock all three.

### 3.3 Walk-away, target and stretch

Each line carries three prices. The *target* is the organic price with paid usage added. The *walk-away* price is the greater of 78% of the media value and the production floor, so it never drops beneath the cost of the work however small the audience. The *stretch* price, for a large sponsor or a demanding brief, is the greater of 135% of the media value and 125% of the floor. Every price is rounded to an increment a person would say aloud: tens below £250, twenty-fives below £1,000, fifties below £5,000. Nobody quotes £1,847.

## 4. Pricing the terms

**Exclusivity.** Turning away every competitor in a category for a window has a real cost. The uplift is 8% for thirty days, 15% for sixty, 22% for ninety and 40% for a hundred and eighty.

**Paid usage, by the period.** Whitelisting and usage rights are conventionally charged as a share of the base fee for each thirty days, 20 to 30% in the guides, though these are asking figures with no transaction data behind them. A share alone underprices a small creator, because the value of paid usage comes from the sponsor's spend, which does not shrink with the creator's audience. Each thirty-day period is therefore priced as the greater of 25% of the organic price and £75. Where the sponsor declares the paid spend behind the asset, 4% of that spend is used instead whenever it is larger. The 4% comes from a single survey and is treated as a parameter, not a benchmark.

**Buyout.** A full buyout lets the sponsor run the asset anywhere, indefinitely. It is priced as the placement again, as a media licence, and never below six periods at the minimum, which is £450. Influencer guides ask three to four times the fee. UGC marketplaces bundle perpetual rights at close to nothing. The tool sits deliberately between them.

**The introductory rate.** New creators rationally accept deals below the cost of the work, because a first proof point is worth more than a fee. The tool makes that trade explicit rather than letting it happen as a quiet discount: a creator with no results on record may offer 70% of the price, once, in exchange for permission to publish the campaign's results. It is the only path that prices below the production floor. The pricing engine itself, not only the interface, withdraws it the moment a result is recorded, and the pitch names it as a trade.

**Revisions, rush and bundles.** Each revision round beyond the first adds 5%, delivery inside two weeks adds 20%, and several assets bought together earn a discount from 5% for two to 12% for five or more.

## 5. Evidence and its limits

### 5.1 The paid curve

The strongest evidence found is Smith's working paper *Influencer Dynamics* (April 2026), which regresses log pay per deliverable on log followers across 15,047 accepted, verified deal reviews. The elasticity is 0.489, with a standard error of 0.006 and R² of 0.33. Predicted pay is $145 per deliverable at 10,000 followers and $448 at 100,000. Pay grows with roughly the square root of audience: doubling followers raises it by about 40%.

The tool prices on views, and the market pays on followers. The two are different quantities, and follower count explains only a third of the variation in pay. The curve is therefore shown beside the price, as a reference with a sentence naming its source, and is never fed into the price. It is shown only for Instagram and TikTok main formats, because the data is mostly from those platforms, and it validates nothing for YouTube, newsletters or podcasts.

### 5.2 The calibration sweep

Nine realistic creator archetypes run end to end through the engine, and each headline price must land in a range a working creator would recognise. The lower bound of each range is a walk-away number, not a target. The sweep is the guard against an edit to the benchmarks quietly turning a £400 placement into a £40 one.

| Archetype | Placement | Median views | Price | Basis |
|---|---|---:|---:|---|
| Nano tech YouTuber | Dedicated video | 900 | £450 | Production floor |
| Micro tech YouTuber | 60–90s integration | 8,000 | £200 | Production floor |
| Mid-size finance YouTuber | Dedicated video | 60,000 | £2,650 | £44.17 CPM |
| Large entertainment YouTuber | 60–90s integration | 400,000 | £4,200 | £10.50 CPM |
| Micro beauty TikToker | Short-form video | 25,000 | £150 | Production floor; paid market about £300 |
| Small B2B newsletter | Primary slot | 2,000 | £160 | £80.00 CPM |
| Established tech podcast | Host-read spot | 18,000 | £400 | £22.22 CPM |
| Gaming streamer | Stream segment | 3,500 | £120 | Production floor |
| Lifestyle Instagram creator | Reel | 30,000 | £220 | £7.33 CPM; paid market about £375 |

The ranges were written by the same hand as the benchmarks, which is circular. The sweep therefore carries one outside anchor: wherever Smith's curve covers an archetype, the price must stay within a factor of three of it in either direction. SevenSix's UK asking prices sit about three times above the paid curve, so a price further out than that has left the market rather than merely negotiated it.

The sweep also produces a result that is not flattering. For both archetypes the paid curve covers, the price sits at roughly half to two-thirds of what creators that size are actually paid. On Instagram and TikTok, for creators whose followers outrun their views, the card is conservative. The interface says so on the line concerned, and tells the creator that asking for the market rate is defensible.

### 5.3 What remains unvalidated

No primary per-view CPM data was found for YouTube, TikTok or Instagram. Every per-view figure found traced back to listicles. The social CPM bands are therefore seeded assumptions, marked as such on the rate card. The podcast band was brought down from £26 to £19 against AdvertiseCast's 2024 sales average of £16 to £17, and the newsletter floor from £200 to £100 against Paved's marketplace guidance. These are the only bands revised against paid or marketplace evidence.

## 6. The deal log

Every closed conversation, won or lost, is frozen into a record at the moment it closes: the platform, format, audience, geography, terms and licence window as they stood, the price the tool quoted, the price agreed, and the fit score. Freezing matters. A record that referenced the live profile would mean something different after the next edit, and the licence window a sponsor agreed to is what was agreed, not what the benchmarks later say a tier means.

From the log the tool reads a close ratio, the median of agreed over quoted across won deals. Below three won deals it declines to interpret the ratio. Above that, a ratio below 90% tells the creator they are being negotiated down, and one above 110% tells them their benchmarks are low. Lost deals are recorded with a reason, because they are the half of the market no rate survey ever sees.

A creator may choose to contribute a won deal to the shared benchmarks. One button opens the project's rate-data form with the deal filled in, rounded to two significant figures, with no brand, no handle and no exact date. The creator still reads the form and presses submit, but the rounded figures travel in the page address as soon as it opens, and the interface says so before it does.

## 7. Provenance for delivered media

### 7.1 The problem

A creator who sells usage rights is selling something they cannot currently enforce. The provenance scheme lets a creator establish, at the moment of delivery, which file was licensed on which terms, and later demonstrate that a running advertisement is that file.

Two requirements govern it. Sealing is opt-in, an explicit act the creator takes for a particular deal, never a default. And sealing cannot be applied retroactively. Because the creator controls the local software and can edit anything it writes, the second requirement cannot rest on the software refusing. It has to be a property of the evidence.

### 7.2 Three bindings

A claim that a running advertisement breaches a licence holds only when three bindings hold together, and none depends on trusting the creator's software.

**Content.** The watermark must be decoded from the advertisement itself, as downloaded from a public ad library. A creator cannot insert a watermark into an advertisement a sponsor is already running. Sealing a file after delivery marks only the creator's own copy.

**Time.** Each sealed deal carries an RFC 3161 timestamp over a commitment to its receipt. The timestamp must precede the date the ad library says the advertisement started running. A backdated record receives today's timestamp and fails.

**Terms.** A signed licence receipt goes to the sponsor with the delivery. The sponsor holds the original terms from the first day, so the creator cannot later produce different ones.

### 7.3 Why the watermark carries a serial

The watermark model encodes 100 raw bits, fewer after error correction. A commitment to the terms truncated to that length is open to a birthday search. A creator could generate two receipts with different terms and the same truncated identifier, timestamp both, and later reveal whichever suited them. At the most robust error-correction setting, that search takes seconds. The watermark therefore carries a 40-bit serial number only, a pointer, and the terms live in the signed receipt the counterparty already holds. No public ledger is required, because the party with an interest in catching equivocation already has a copy.

### 7.4 The receipt

The receipt is canonical JSON with sorted keys. It records the serial, a 16-byte salt, the deal, the parties, the platform and format, the usage rights and paid-usage window, the exclusivity, the dates, SHA-256 digests of the file before and after marking, a perceptual hash for matching re-encoded copies, and the creator's public key. Its SHA-256 is the commitment that is timestamped.

The creator signs the same bytes with their own SSH key through OpenSSH's signature format, in a namespace reserved for receipts. The tool never reads or stores the private key: passphrases, agents and hardware keys remain OpenSSH's responsibility. A sponsor verifies the receipt with the stock `ssh-keygen` already on their machine, and needs nothing from the project. The key's fingerprint belongs in the contract, which is what makes a key nobody else vouches for sufficient: the sponsor already knows whom they contracted with.

A C2PA manifest carrying the same terms is embedded in the delivered file for any pipeline that preserves it. Most platforms strip it, which is why the watermark exists. C2PA's claim of creation requires a statement of how the asset was made, and the tool cannot know that. So the creator must state it, and there is no default, because a default would be a claim nobody made.

### 7.5 The one network call

Sealing sends one salted SHA-256 digest to a public timestamp authority. The salt means the digest reveals nothing about the deal. The call happens only when the creator has chosen to seal, and the confirmation says so before it happens. It is the only network call that carries anything derived from the creator's data.

### 7.6 Survival

The design is theory until the watermark survives the path a delivered file actually takes. A local proxy test on 24 frames drawn from a corpus of 23,000 images measured bit-exact recovery of the serial under the transformations a sponsor's pipeline applies.

| Transformation | Recovery, model Q, 40-bit |
|---|---:|
| JPEG at quality 85, 70 and 50; WebP at 75 | 100% |
| Downscaled to 1080, 720 and 480 wide, then JPEG | 100% |
| Centre crop to 90% and 80% | 100% |
| Call-to-action banner over the bottom 15% | 100% |
| Colour grade | 100% |
| H.264 at 1080p and 720p | 100% |
| Landscape reframed to 4:5 | 0% |
| Landscape reframed to 9:16 | 0% |

The mark survives everything except reframing. The rule that follows is to seal each aspect ratio delivered. A sponsor who reframes a landscape file into a portrait advertisement defeats the mark, and the perceptual hash is all that remains. Decoding is strict: the decoder detects the error-correction schema from the payload, and 8 of 400 unmarked images decoded as present under a weaker schema, so only the strongest schema at exactly 40 bits is accepted. That took false positives to none of 400.

A proxy is not a platform. The go or no-go test is manual, belongs to the creator, and has not yet been run.

### 7.7 Disclosed, not covert

The receipt tells the sponsor that the file is marked and what terms it records. Deterrence works only when the sponsor knows, and a hidden mark discovered later damages the relationship it was meant to protect. A missing watermark proves nothing, because the watermark model ships with a removal model. The tool never treats absence as evidence.

### 7.8 Pricing an overrun

When a verified sighting shows an advertisement running beyond its licence, the overrun is priced as the further thirty-day periods the sponsor took, each at the per-period rate the licence was priced on, scaled by the discount already negotiated and never below the minimum. That is what the sponsor would have paid had they asked, on terms they had already accepted. The command-line tool reports only facts. The invoice is composed from the same benchmarks that priced the deal, so every market assumption stays in one place.

## 8. Settlement over Lightning

*This section describes an experimental branch. It has been tested against simulated nodes only, runs on test networks by default, and has not been merged.*

Many creators this tool is built for already run a Lightning node, and some sponsors in that world pay in bitcoin. For them an invoice from their own node is the natural way to be paid, with no payment processor and no account.

**Pounds remain the price.** Nothing in the derivation reads satoshis. Once a deal is won, the creator types the rate they would quote the sponsor, in whole pounds per bitcoin, and the tool freezes the number of satoshis on the deal beside that rate and the date. The sentence it writes for the invoice email names all three, so the sponsor can repeat the arithmetic. There is no price feed.

**The invoice commits to the receipt.** A BOLT11 invoice can carry a hash of its description rather than the description itself. For a sealed deal, the description is the signed receipt, byte for byte, so the invoice's description hash equals the receipt commitment that was timestamped. A sponsor who pays holds the invoice, the preimage their wallet received and the receipt. Together these show that this amount was paid for exactly these terms, and anyone can check them offline. The mechanism is not new: Nostr zaps (NIP-57) and LNURL-pay commit an invoice to a JSON document in the same way. The application to a sealed licence is what this branch adds.

**The node is the creator's.** The tool stores where the node is and the path to a least-privilege credential, never the credential itself. It asks for three things: the node's network, an invoice, and whether that invoice was paid. The invoice the node returns is decoded and checked against the request before anything is recorded. Mainnet is refused unless the creator explicitly allows it, and a preimage is recorded only once the node reports the invoice paid.

## 9. Related work

**Rate evidence.** FYPM collects verified deal reviews behind a paywall, as a lookup rather than a model. @InfluencerPayGap publishes anonymous posts, unstructured and skewed towards each creator's best deal. The NUJ's *Rate for the Job* pools confidential paid rates for journalism, as a table. SevenSix publishes an agency survey with an explicit usage formula, on asking prices. Equity's UseFee calculator indexes usage to the advertising buy's impressions, a structure without market data. Smith (2026) derives an explainable elasticity from pooled paid data, as a paper rather than a tool. No project found combines open access, pooled paid deals and a rationale for every factor. That is an absence in one search, not proof that none exists.

**Discovery.** Commercial sponsorship intelligence services detect sponsors from content at scale, for example by crawling millions of podcast episodes. That is the prospect-discovery problem this project leaves open, and it is solved there with a maintained database and a subscription.

**Provenance and licence enforcement.** Image-tracking services such as Pixsy and Copytrack find unlicensed uses of photographs and pursue claims. Imatag offers invisible watermarking for tracking images. These are services a rights holder subscribes to. The scheme here differs in being local, opt-in per deal, disclosed to the counterparty, and bound to a signed licence and an independent timestamp. It builds on C2PA for embedded provenance, on Adobe's open TrustMark model for the watermark, on RFC 3161 for time, and on OpenSSH's signature format for receipts.

## 10. Open problems

**Prospect discovery.** Scoring ranks a list the creator assembles by hand. A real sponsor database is the expensive part of the problem and would need a backend, which would break the local-first commitment. That trade has not been made, and should be made deliberately if at all.

**Paid evidence beyond Instagram and TikTok.** There is no paid curve yet for YouTube, newsletters or podcasts, and the social CPM bands remain unvalidated.

**The card sits below the paid curve where the curve exists.** Section 5.2 shows the covered archetypes priced at roughly half to two-thirds of what the market pays. Whether the bands, the floors or the view-based basis should move is an open question, to be settled by evidence rather than by tuning until the sweep looks right.

**Platform survival.** The manual test through real platform pipelines has not been run, reframing defeats the mark, and video cannot yet be sealed because no video watermark has passed the same test.

**A single timestamp authority.** The time binding rests on one company's certificate remaining valid and uncompromised until a dispute. A second, trust-minimised stamp through OpenTimestamps would remove that dependence at the cost of hours of confirmation and a verifier the sponsor would have to install.

**Attested statistics.** Self-signed view counts prove nothing, and platform attestation needs the OAuth access the project declines. Protocols that prove the contents of a TLS session could let a creator prove what a platform's own dashboard reported without that access, with a notary that must be trusted not to collude. This deserves a research note before any code.

**A verified pooled index.** A pooled rate index is only as good as the truth of its entries. A sponsor's countersignature on the existing receipt would turn a contributed deal into a verified data point, without any chain or central service.

## What Is Declined

- **A marketplace.** A brand-side account, or anything that needs two-sided liquidity, is a different product.
- **Scraping platform APIs.** It would mean OAuth, a backend, stored tokens and a privacy surface, to save typing four numbers.
- **Finding prospects.** The tool ranks a list the creator assembles and will not pretend to build one.
- **Sending email.** It composes the draft. Deliverability is a business, not a feature.
- **A paid language model.** The pitch composer is deterministic and complete without one. A local model may tighten the wording, optionally, and must preserve every number.
- **Telemetry of any kind.**
- **A CPM derived from a floored price.**
- **Feeding the paid-market reference into the price,** or extending it to platforms its evidence does not cover.
- **Sealing an existing file or a delivered deal,** or backdating a record.
- **Putting the terms in the watermark.**
- **Treating a missing watermark as evidence.**
- **Automated monitoring of ad libraries.** Detection is a person downloading an advertisement and verifying it.
- **Attesting the media kit's statistics with the creator's own signature.**
- **Proving identity to strangers.** The trust that matters is bilateral and established by the contract.
- **Holding the creator's keys or funds.**
- **Anchoring seals on a public ledger.** It would publish how many deals a creator closes, and when, and adds no proof the timestamp and the sponsor's copy do not already give.
- **A price feed, or pricing in satoshis.**
- **Streaming payment for paid usage.** A stream cannot stop a sponsor running a file they already hold.
- **Generalising to all creative licensing.** It is a larger problem than one maintainer should take on.
- **Any claim of novelty that has not survived a prior-art search.**

## References

1. Smith, *Influencer Dynamics*, working paper, 29 April 2026.
2. Collabstr, *2026 Influencer Marketing Report* (2025 data).
3. SevenSix, UK creator rates report, 2023.
4. AdvertiseCast and Libsyn, podcast advertising rates, 2024.
5. Paved, newsletter sponsorship pricing guidance, July 2026.
6. Christin and Lu, study of 631 creator sponsorship exchanges, 2023.
7. Linktree, *Creator Report*, 2022.
8. Lumanu and Collectively, whitelisting survey of more than 400 influencers.
9. Equity, UseFee calculator.
10. National Union of Journalists, *Rate for the Job*.
11. FYPM, verified creator deal reviews.
12. Coalition for Content Provenance and Authenticity, C2PA technical specification.
13. T. Bui, S. Agarwal and J. Collomosse, *TrustMark: Universal Watermarking for Arbitrary Resolution Images*, 2023.
14. IETF RFC 3161, *Time-Stamp Protocol*.
15. OpenSSH, `PROTOCOL.sshsig`.
16. Lightning Network specification, BOLT 11, *Invoice Protocol for Lightning Payments*.
17. Nostr NIP-57, *Lightning Zaps*.
18. LNURL LUD-06, *payRequest*.
19. OpenTimestamps.

---

Released under the MIT licence. Source: github.com/idl3o/sponsifer. The figures in this paper are those of the repository in September 2026.
