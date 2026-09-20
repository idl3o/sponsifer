# Sponsifer

**Work out what to charge a sponsor, judge the offer that comes back, prove the audience, send the pitch, track the pipeline, and show a stream sponsor exactly when their placement was on air. Entirely on your own machine.**

Most creators price sponsorship by guessing, or by repeating a number someone said on a podcast. Then a brand asks why, and the number falls apart. Sponsifer derives a price you can defend line by line, and hands you the sentence to say when you are asked to justify it.

MIT licensed. No account, no remote server, no telemetry. Built for a creator who runs their own tools on a small budget: one install, and everything stays on your machine.

---

## What it does

**Derives a defensible price.** A rate card built from median views, engagement measured against the platform norm, audience geography, category demand, and the commercial terms actually on the table. Open any line and the full derivation expands, each factor carrying a sentence you can say out loud. A number you cannot explain is a number you will be talked out of.

**Refuses to price your labour like an impression.** A dedicated video takes a day and a half whoever makes it. Cost-per-impression pricing alone tells a creator with a small audience to do that for thirty pounds. Every format carries a production floor derived from the hours it costs, and the price is the greater of the two. When the floor binds, the interface says so and shows both numbers.

**Prices the terms, not just the placement.** Most creators quote one figure for a video and hand over usage rights and category exclusivity for nothing. Those are separate things a sponsor is buying. Paid usage is priced per 30-day period, with a minimum however small your audience, because the sponsor's paid reach does not shrink with it. If the sponsor tells you their ad budget, the fee scales with that too. A full buyout is priced as the placement again: a media licence, not a post.

**Shows what the market actually pays.** For Instagram and TikTok, every line carries what creators your size are typically paid, from a study of 15,047 verified paid deals. The card prices on views and the market pays on followers, so if your followers outrun your views, you will see that you can ask for more. It is a reference beside the price, never an input to it.

**Names the one discount worth giving.** A creator with no results on record can offer an introductory rate: a named, one-off concession, in exchange for permission to publish the campaign's results. The pitch says so. It lapses the moment your first result is recorded, because by then you have what it was buying.

**Judges an offer that has already arrived.** A sponsor names a number for a placement, on their terms. The offer tab prices the same placement on those terms, says what each thing they asked for is worth — the paid usage, the exclusivity, the deadline — and writes the reply. When the fee cannot move it lists what to give back instead, smallest give first, and says plainly when nothing it can give reaches their number. It is the rate card read backwards, so the two can never disagree.

**Builds a media kit that survives scrutiny.** It leads with impressions per placement rather than summed follower counts, because summing followers across five platforms counts the same person five times and every experienced sponsor knows it. It also lists the problems a sponsor will notice, so you name them first.

**Ranks prospects.** A 0 to 100 fit score over category adjacency, market overlap, budget against your walk-away price, and whether the brand has ever paid a creator at all. Every component reports its reasoning, so a low score can be argued with. Triage, not prophecy.

**Writes the pitch and the follow-ups.** Composed from your own numbers: name the product, show delivered attention, state a price, ask one question, under 150 words. Follow-ups at days 4, 11 and 25, with a next-action flag on every prospect.

**Keeps a deal log.** Every outcome, won or lost, is recorded against the price the card quoted, with the audience and terms frozen as they stood. It tells you whether you are being negotiated down, and whether the fit score predicts anything for you. If you choose to, one button opens the project's rate-data form with the deal filled in, rounded so it cannot identify you. Lost deals count too: they are the half of the market no rate survey ever sees.

**Seals what you deliver, if you ask it to.** A sponsor who keeps your whitelisted ad running on day 90 has bought the ninety-day licence at the thirty-day price. `sponsifer seal` watermarks the file before delivery, signs a licence receipt, and has it timestamped. If the ad later turns up in a public ad library, `sponsifer verify` checks it, and the app prices the overrun as the further 30-day periods the sponsor took. It is opt-in per deal, and it cannot be applied after delivery: the evidence, not the app, enforces that. Receipts are signed with your own SSH key, so a sponsor can check one with `ssh-keygen`, which is already on their machine. [docs/provenance.md](https://github.com/idl3o/sponsifer/blob/main/docs/provenance.md) explains how, and what it cannot do.

**Puts a sponsor on stream, and shows they were there.** This half is early. Each won deal has overlay addresses to add to OBS as browser sources — a corner emblem you place by hand over a stream frame, a lower third, a segment slate and a break card — drawn in your house style with the sponsor's own logo. Every one carries "Ad", asks OBS for no permissions, and never draws a price. While you stream, the on-air logger, started from the won deal in the app or as `sponsifer log` in a terminal, listens to OBS's own WebSocket and writes down, in wall-clock UTC, every second each placement was in the broadcast feed, checking OBS directly rather than trusting its events. Afterwards `sponsifer report` folds that log into intervals with offsets into the recording, signs it with your SSH key, and gives you the three files the sponsor keeps: the recording is the evidence, the report says where to look. The logger has been tested against a fake OBS, and OBS's own reporting against a real session: scene switches, visibility toggles and studio mode all produced matching events, with no disagreement from the direct checks. A live stream and a nested scene are still to be run. Starting it from the app has been run end to end against a stand-in OBS over a real socket, password included, and not yet against OBS itself.

---

## The interesting problem is not the code

The application is a few thousand lines of TypeScript. Anyone could write it.

The hard part sits in one file: [`src/domain/benchmarks.ts`](https://github.com/idl3o/sponsifer/blob/main/src/domain/benchmarks.ts). It holds every market assumption the tool makes — cost-per-thousand bands for each platform and format, category multipliers, geography weights, platform-median engagement rates, production floors, and the uplifts for exclusivity and usage rights.

Those numbers are seeded from publicly circulated creator rates for 2025 and 2026. They are not audited market data, and the app says so on the rate card rather than presenting a guess as a quote.

**This is where contributions matter most.** If you have been paid for a placement, you know something the table does not. A single real data point — platform, format, audience size, category, what you were actually paid, and what rights the sponsor got — is worth more to this project than a refactor. Rates also drift, so a table that is right today is wrong in eighteen months without people correcting it.

The guard against bad edits is [`src/domain/calibration.test.ts`](https://github.com/idl3o/sponsifer/blob/main/src/domain/calibration.test.ts), which runs nine realistic creator archetypes end to end and asserts each headline price lands somewhere a working creator would recognise. Change a band, run the sweep, and see what moved:

```
npx vitest run calibration --reporter=verbose

Nano tech YouTuber            YouTube Dedicated video      900 views     £450     on time  ok
Micro tech YouTuber           YouTube 60–90s integration 8,000 views     £200     on time  ok
Mid-size finance YouTuber     YouTube Dedicated video   60,000 views   £2,650  £44.17 CPM  ok
Large entertainment YouTuber  YouTube 60–90s integration  400,000 views £4,200  £10.50 CPM  ok
...
```

See [CONTRIBUTING.md](https://github.com/idl3o/sponsifer/blob/main/CONTRIBUTING.md) for how to submit a rate, and what the project will and will not accept.

---

## Two design decisions worth arguing with

**It is not a marketplace.** There is nobody on the other side. Two-sided creator-and-brand marketplaces die on cold-start liquidity and need a sales team to survive, which makes them the wrong shape for software you can run locally. This is the tool you use alone, before and during a negotiation. If that is the wrong call, the argument is worth having in an issue.

**The domain layer is pure by construction.** No clock, no randomness, no I/O anywhere in `src/domain`. The same profile always produces the same rate card, which is a property the tests assert directly. This is not fastidiousness. A pricing tool that returns a different number on Tuesday is a pricing tool nobody can defend in a negotiation.

---

## What this project declines to do

**Scrape platform APIs for your stats.** You type in your median views. Automating it means OAuth, a backend, stored tokens and a privacy surface, in exchange for saving four numbers of typing.

**Find prospects for you.** The scoring ranks a list you assemble by hand and will not build that list. Doing it properly needs a maintained database of who sponsors whom, which is the genuinely expensive part of this problem and cannot live in a static page. Until that exists, the prospects tab is an organised research habit with a scoring function attached. This is the project's honest limitation, and it is written into the code comments as well as here.

**Send email on your behalf.** It composes the draft and copies it to your clipboard. Deliverability, warm-up and reputation are a business, not a feature.

**Call a paid language model.** The pitch composer is deterministic and complete without any model. If Ollama is running locally, the outreach tab offers to tighten the wording, with instructions to preserve every number and invent nothing. That is optional and stays on your machine.

**Track you.** No analytics, no error reporting, no account. Your unreleased rates and prospect list are commercially sensitive, and the simplest way to keep them private is never to transmit them. Your workspace is one JSON file on your own disk, and Export and Import copy it wherever you like. The single exception is sealing, which you choose deal by deal: it sends one salted hash to a public timestamp authority, and tells you before it does.

**Price time on screen.** No transaction data exists for a persistent logo on a stream, and the one eye-tracking study puts such a banner at under 1.5% of viewer attention, below the chat box. The engine prices the stream segment it has evidence for and treats the overlay as part of it. [docs/research/overlay-pricing-2026-09.md](https://github.com/idl3o/sponsifer/blob/main/docs/research/overlay-pricing-2026-09.md) has the evidence, and what would change the decision.

**Treat a missing watermark as evidence.** Watermarks can be stripped, and the one Sponsifer uses ships with a removal model. A mark that decodes is evidence; a mark that does not proves nothing, and the tool never says otherwise.

---

## Running it

Sponsifer is not on PyPI yet. From a checkout, with Node 20.19+ or 22.12+ and Python 3.10+:

```bash
npm install
npm run bundle                 # build the app into the Python package
pipx install .                 # the app and the CLI, without the watermark
pipx install --force ".[seal]" # or with it: adds PyTorch, several hundred MB

sponsifer                    # serves the app at http://127.0.0.1:5180
sponsifer key --ssh ~/.ssh/id_ed25519   # sign receipts with your SSH key
sponsifer setup              # fetch the watermark model once, ahead of time
sponsifer seal dl-104 reel.png --source capture
sponsifer verify ad.jpg --started 2026-10-01

sponsifer log dl-104 --source "Sponsor overlay"    # during the stream, or press Start logging on the deal in the app
sponsifer report dl-104 --vod https://...          # afterwards: the signed delivery report
```

The server binds to 127.0.0.1 only, and answers only requests addressed to 127.0.0.1 or localhost, so a web page cannot reach it by rebinding a hostname. Serving from your own machine also means the optional Ollama integration talks to Ollama on the same machine, with no cross-origin configuration.

The app saves your workspace to `~/.sponsifer/workspace.json` (or `$SPONSIFER_HOME`) through that server. `seal` and `verify` write into the same file, so the app picks up a seal or a verified sighting when you return to it, with nothing to import. Every write checks that the file has not changed since it was read, so the app and the command line cannot overwrite each other. Pass `--workspace` to point any command at another file.

For development:

```bash
npm run dev        # http://localhost:5180, saving in the browser only
npm run dev:api    # beside it: the workspace server, so the app saves to the file
npm run check      # every gate at once: typecheck, lint, vitest and pytest. Run before any push
npm test           # 230 tests, including the calibration sweep
npm run typecheck
npm run lint       # includes the house rules: no function over 50 lines
python -m pytest   # 159 tests: the workspace server, receipts, SSH signatures, timestamps, seal and verify, the on-air log, its runner and the report

node scripts/playtest.mjs   # drives real Chrome, screenshots every tab,
                            # checks overflow, tap targets and broken numbers
python scripts/survival.py --corpus DIR   # how the watermark survives re-encoding
```

The play test uses the Chrome already installed on your machine rather than downloading a browser.

---

## Shape

```
src/domain/      pure functions: no clock, no randomness, no I/O
  types.ts         the vocabulary
  benchmarks.ts    every market assumption, in one editable place
  pricing.ts       rate derivation, with a rationale per factor
  mediakit.ts      derived audience facts and credibility warnings
  scoring.ts       prospect fit
  pitch.ts         email composition and follow-up cadence
  deals.ts         deal log, personal calibration, rate submission, overrun pricing
  offer.ts         an incoming offer judged against the same engine, with the reply
  overlay.ts       what the OBS overlay may draw: the disclosure and the brand, never a price
  workspace.ts     versioned file format; validates every import and old save
  localModel.ts    optional Ollama sharpening, fails quietly
  *.test.ts        property tests plus the calibration sweep
src/store/       zustand and immer, kept in step with the workspace file; the browser holds a cache
src/components/  one view per tab
src/overlay/     the OBS browser source: a second page, transparent, fails silently
python/          the `sponsifer` CLI: serve, seal, verify, log, report
  api.py           the workspace file over HTTP: compare-and-swap writes, localhost only
  receipt.py       pure: the receipt, its commitment, and the rules a claim must pass
  obs.py           the obs-websocket protocol layer and the on-air state machine
  onair.py         the append-only on-air log, and the fold that reads it
  report.py        the signed delivery report, under its own SSHSIG namespace
docs/            provenance design, the research behind the benchmarks, and an archive of papers
scripts/         browser play test, watermark survival test, archive renderer
```

React 18, TypeScript in strict mode, Vite, vitest, zustand. No CSS framework and no component library, so there is nothing to learn before changing something.

---

## Licence

MIT. See [LICENSE](https://github.com/idl3o/sponsifer/blob/main/LICENSE).

If this helps you land a sponsorship, the project would like to know what you were paid and what the table got wrong. That is the whole contribution loop.
