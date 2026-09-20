# Contributing

Thank you for looking. This project needs two quite different kinds of help, and the first one is more valuable than the second.

## 1. Rate data — the thing that actually helps

Every price this tool produces rests on the tables in [`src/domain/benchmarks.ts`](src/domain/benchmarks.ts). Those tables are seeded from publicly circulated creator rates, which is a polite way of saying they are informed guesses. Real deals are better than guesses, and rates drift, so the table decays without correction.

**If you have been paid for a placement, open an issue using the rate data template.** It asks for:

- platform and format
- median views on the placement, not follower count and not the viral one
- your content category
- roughly where the audience sits, by share
- what you were actually paid, in any currency
- what the sponsor got: organic only, whitelisting, or a buyout, and any exclusivity
- roughly when

Ranges are fine. "Somewhere between £800 and £1,200, mid 2026" is useful. Precision is not required and neither is your channel name.

**On anonymity.** Rates are commercially sensitive and some contracts have confidentiality clauses. Do not post anything you are contractually bound not to share. You are welcome to submit without identifying your channel, and you are welcome to round hard.

**What happens to it.** Data points are aggregated into the bands in `benchmarks.ts`. No individual figure is published as a rate card entry and no channel is named in the repository. If several submissions disagree, the band moves toward the middle rather than the loudest.

**Declining a submission.** Rates quoted from a media kit rather than from money that actually changed hands will be marked as such and weighted lower, because asking prices and paid prices are different quantities and conflating them is how creator rate discourse got unreliable in the first place.

## 2. Code

### Before you start

Run the suite. It is fast.

```bash
npm install
npm test           # 270 tests
npm run typecheck
npm run lint
node scripts/playtest.mjs
python -m pytest   # 190 tests, if you touch python/
```

Anything under `python/` or `docs/provenance.md` is bound by the provenance rules in [docs/provenance.md](docs/provenance.md): sealing is opt-in, it cannot be retroactive, and a missing watermark is never treated as evidence. A change that weakens any of those will not be merged.

### The three rules that will get a pull request rejected if broken

**The domain layer stays pure.** Nothing in `src/domain` may read the clock, call `Math.random()`, or perform I/O. The one exception is `localModel.ts`, which is explicitly the I/O edge and fails quietly by design. Today's date is read once in `App.tsx` and passed down. Identifiers come from a counter in the store. This exists so that the same profile always produces the same rate card, which is what makes a price defensible in a negotiation.

**Every pricing factor carries a rationale.** `Adjustment.rationale` is a sentence the creator says out loud when a sponsor asks why. A factor without one is a number nobody can defend, which defeats the purpose of the tool. Write the sentence first and the multiplier second.

**Market assumptions live in `benchmarks.ts` and nowhere else.** Never inline a cost-per-thousand figure or a multiplier at a call site. The value of this project is that every assumption sits in one file a stranger can read and disagree with.

### Changing a benchmark

Run the calibration sweep and look at what moved:

```bash
npx vitest run calibration --reporter=verbose
```

It runs nine creator archetypes end to end and asserts each headline price lands in a range a working creator would recognise. If your change pushes an archetype out of range, one of two things is true: the change is wrong, or the expected range is wrong. Both are legitimate outcomes. If you widen a range, say why in the diff, the way the existing comments do. Tuning a constant until it matches your own guess is circular, and the comments in that file call it out where it has happened.

### Adding a platform or format

1. Extend the `Platform` or `Format` union in `types.ts`.
2. Add a cost-per-thousand band, a production floor, a label, and an entry in `FORMATS_BY_PLATFORM` and `MEDIAN_ENGAGEMENT` in `benchmarks.ts`. TypeScript will tell you what you missed, because every one of those tables is a total `Record`.
3. Add an archetype to the calibration sweep so the new format has a sanity check.

### Style

TypeScript strict, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Functional composition over inheritance. No function over 50 lines, no module over 500. JSDoc on anything exported. British English in prose, comments and commit messages.

Commits follow Conventional Commits with lowercase scopes: `feat(pricing):`, `fix(outreach):`, `docs:`.

Comments should say why, not what. The existing code is a reasonable guide: it explains the reasoning behind a decision rather than restating the line beneath it.

### Pull requests

Say what changed and what it does to the numbers. If you touched pricing, paste the calibration table before and after. Tests, typecheck and lint must pass. Lint carries the house style: no function over 50 lines, no module over 500. New behaviour needs a test, and a bug fix needs a test that fails without it.

## 3. Things that would genuinely help, beyond rates

- **Currencies other than GBP.** Everything is hard-coded to sterling right now. This is a real limitation for most of the world.
- **Evidence for the social CPMs.** No primary per-view data for YouTube, TikTok or Instagram was found in September 2026; every figure traced back to listicles. The only validated social number is the paid-market curve, which is per deliverable by follower count. Real per-view data would settle it.
- **Usage-fee evidence.** The per-period share and minimum rest on guides, not transactions. Paid whitelisting or usage fees, with the sponsor's spend if you know it, would put them on firmer ground.
- **Newsletter scarcity, the other way round.** This file used to say newsletter floors were too low because scarcity is not priced. Paved's marketplace data shows small-list slots priced per subscriber with no scarcity premium, so the floors came down instead. If you have been paid a premium for scarcity, that is the data point that would reverse it.
- **Accessibility.** The play test checks tap targets and overflow. It does not check screen reader behaviour, focus order or contrast ratios, and nobody has audited those.
- **Translations of the pitch templates.** The composition logic is language-agnostic; the strings are not.

## Conduct

Be straightforward and assume competence. Disagreement about a number is the point of the project, and an issue arguing that a band is wrong is a contribution rather than a complaint.
