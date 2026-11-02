# Sponsifer

**Tools for streamers who run OBS: put a sponsor on stream, log every second they were on air, and sign a report the sponsor can check with nothing but OpenSSH. Price the deal first, if you want to. Entirely on your own machine.**

A sponsor who pays for time on your stream asks one question afterwards: was it up, and when? Sponsifer answers it from OBS itself. It watches OBS's own WebSocket, writes down in wall-clock UTC when each placement was in the program feed while you were live, and signs that record with your SSH key, as an index into the recording at the minute each interval began.

MIT licensed. No account, no remote server, no telemetry. One install, and everything stays on your machine.

---

## Install

```bash
pipx install sponsifer             # the toolkit
pipx install 'sponsifer[seal]'     # also seals delivered files: adds PyTorch, several hundred MB
```

Sponsifer is not on PyPI yet. Until it is, install from a checkout: see [Running it from source](https://github.com/idl3o/sponsifer#running-it-from-source).

## The tools

```
sponsifer                       the list of tools
sponsifer app                   the app, the overlays and the dock, on 127.0.0.1:5180
sponsifer status                what OBS has, what is in the program feed, what is on air
sponsifer setup DEAL            put a won deal's placements into OBS, through the app
sponsifer overlay DEAL          the overlay addresses to paste into OBS
sponsifer dock                  the dock's address, for OBS's Custom Browser Docks
sponsifer log DEAL              record when a deal's placements were on air
sponsifer log --label NAME --source SOURCE
                                the same for any source, with no deal
sponsifer report DEAL           sign what the log says, for the sponsor
sponsifer report --label NAME   sign a label's log the same way
sponsifer key --ssh PATH        choose the SSH key that signs reports and receipts
```

OBS's WebSocket server must be on: *Tools, WebSocket Server Settings*. Sponsifer asks for its password only when OBS asks, uses it once, and keeps it nowhere. Set `OBS_WEBSOCKET_PASSWORD` to skip the prompt.

### Before the stream

**`sponsifer status`** is the wiring check. It asks OBS once and changes nothing: which of the sponsor sources exist, which are in the program feed, which are on air, which deal each overlay is showing, and whether the server it loads from is answering. An overlay aimed at a port nothing serves draws nothing, and looks fine in the source list. Pass `--source` to look at any source by name.

**The overlays.** Each won deal has four placements, each its own browser source in OBS: a corner emblem, a lower third, a segment slate and a break card, drawn in your house style with the sponsor's own logo. Every one carries "Ad", asks OBS for no permissions, and never draws a price. They load from `sponsifer app`, which must be running while you stream.

**`sponsifer setup DEAL`** puts them into OBS for you. It makes the four sources if they are missing, hidden and at the canvas size, and points the ones that exist at this deal, so your scenes are built once and the sponsor is what changes. It never removes, shows, hides or moves anything, and it will not touch a source while any logger runs. It goes through the running app, so OBS is only ever given the app's own address. `sponsifer overlay DEAL` prints the addresses instead, if you would rather paste them yourself.

**The dock.** `sponsifer dock` gives the address to add under *Docks, Custom Browser Docks*. Inside OBS it shows which placements OBS has, which are in the program feed and which are on air this moment, and holds the logger's Start and Stop. Like the overlay it shows no price, because OBS's own window gets captured and shared.

### During

**`sponsifer log DEAL`**, or Start in the app or the dock, follows OBS and appends every change to an on-air log under `~/.sponsifer/onair/`. OBS's events are prompts; every few seconds it asks OBS directly, and where the two disagree the direct answer counts and the disagreement is written down. On air means the stream is live and the source is in the program feed: showing in preview is not being broadcast.

One logger runs at a time on the machine, whether in a terminal, the app or a second server, because the sponsor sources have the same names for every deal and two loggers would write the same minutes twice. The logger also refuses to begin while a source still shows another sponsor's art.

### After

**`sponsifer report DEAL`** folds the log into intervals with offsets into the recording, signs it with your SSH key, and gives you three files for the sponsor. The notice tells them how to check the signature with `ssh-keygen`, which is already on their machine. It hides nothing: disagreements, and an interval the logger stopped inside, are in the report with a count and a time. It carries no price.

### Without a sponsor

**`sponsifer log --label NAME --source SOURCE`** times any source with no deal and no workspace: a webcam, a scene's game capture, your own lower third. `sponsifer report --label NAME` signs it as an airtime report. Labels keep logs and reports in folders of their own, and a label refuses to log a source that is showing a sponsor's overlay, because those minutes belong in that deal's log.

### What it cannot see

- **The recording is the evidence, not the report.** The report says where to look. Twitch keeps a past broadcast for 7 days, 14 for Affiliates and 60 for Partners, so the sponsor should check soon, and the notice says so.
- **One canvas.** OBS reports a source as in the program or not, once for the whole program. When a second canvas is running, as Twitch's Dual Format does for vertical video, the log cannot say which of the two feeds a placement was in. `status` counts the canvases, every session records the count, and a report from a log that saw more than one carries the count in its signed body and says in its notice what that costs.
- **What has been run against real OBS.** OBS's own reporting has been tested against OBS 32: scene switches, visibility toggles and studio mode all produced matching events, with no disagreement from the direct checks. The logger started from the app has been run against OBS 32.2.2 with no stream live. A live stream and a nested scene are still to be run. `status`, the command-line `setup` and labels have been run end to end against a stand-in OBS over a real WebSocket.

---

## Pricing a sponsorship

`sponsifer app` also prices the deal before there is one, and judges the offer when it arrives.

**A price you can defend line by line.** A rate card built from median views, engagement against the platform norm, audience geography, category demand, and the commercial terms on the table. Open any line and each factor carries a sentence you can say out loud. A number you cannot explain is a number you will be talked out of.

**Labour is not priced like an impression.** Every format carries a production floor derived from the hours it costs, and the price is the greater of the two. Cost-per-impression pricing alone tells a creator with a small audience to make a dedicated video for thirty pounds. When the floor binds, the card says so and shows both numbers.

**The terms are priced, not given away.** Paid usage is priced per 30-day period, with a minimum however small your audience, because the sponsor's paid reach does not shrink with it. Exclusivity is priced. A full buyout is the placement again: a media licence, not a post. For Instagram and TikTok, each line also shows what creators your size are typically paid, from a study of 15,047 verified deals, beside the price and never inside it.

**The offer that comes back.** The offer tab prices the same placement on the sponsor's terms, says what each thing they asked for is worth, and writes the reply. When the fee cannot move it lists what to give back instead, smallest give first, and says plainly when nothing reaches their number. It is the rate card read backwards, so the two can never disagree.

**The rest of the pipeline.** A media kit that leads with impressions per placement rather than summed follower counts, and names the problems a sponsor will notice before they do. A 0 to 100 fit score over a prospect list you assemble yourself, with every component's reasoning shown. A pitch under 150 words with follow-ups at days 4, 11 and 25. A deal log that records every outcome, won or lost, against the price the card quoted, and tells you whether you are being negotiated down. The one discount worth giving, an introductory rate in exchange for publishing the results, lapses the moment your first result is recorded.

## Sealing what you deliver

With the `seal` extra. A sponsor who keeps your whitelisted ad running on day 90 has bought the ninety-day licence at the thirty-day price. `sponsifer seal` watermarks the file before delivery, signs a licence receipt, and has it timestamped. If the ad later turns up in a public ad library, `sponsifer verify` checks it, and the app prices the overrun as the further 30-day periods the sponsor took. It is opt-in per deal, and it cannot be applied after delivery: the evidence, not the app, enforces that. Receipts are signed with your own SSH key. [docs/provenance.md](https://github.com/idl3o/sponsifer/blob/main/docs/provenance.md) explains how, and what it cannot do.

---

## The interesting problem is not the code

The pricing is a few thousand lines of TypeScript. Anyone could write it.

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

**It is not a marketplace.** There is nobody on the other side. Two-sided creator-and-brand marketplaces die on cold-start liquidity and need a sales team to survive, which makes them the wrong shape for software you can run locally. This is the tool you use alone, before, during and after a sponsored stream. If that is the wrong call, the argument is worth having in an issue.

**The domain layer is pure by construction.** No clock, no randomness, no I/O anywhere in `src/domain`. The same profile always produces the same rate card, which is a property the tests assert directly. This is not fastidiousness. A pricing tool that returns a different number on Tuesday is a pricing tool nobody can defend in a negotiation.

---

## What this project declines to do

**Scrape platform APIs for your stats.** You type in your median views. Automating it means OAuth, a backend, stored tokens and a privacy surface, in exchange for saving four numbers of typing.

**Find prospects for you.** The scoring ranks a list you assemble by hand and will not build that list. Doing it properly needs a maintained database of who sponsors whom, which is the genuinely expensive part of this problem and cannot live on your machine. Until that exists, the prospects tab is an organised research habit with a scoring function attached.

**Send email on your behalf.** It composes the draft and copies it to your clipboard. Deliverability, warm-up and reputation are a business, not a feature.

**Call a paid language model.** The pitch composer is deterministic and complete without any model. If Ollama is running locally, the outreach tab offers to tighten the wording, with instructions to preserve every number and invent nothing. That is optional and stays on your machine.

**Track you.** No analytics, no error reporting, no account. Your unreleased rates and prospect list are commercially sensitive, and the simplest way to keep them private is never to transmit them. Your workspace is one JSON file on your own disk. The single exception is sealing, which you choose deal by deal: it sends one salted hash to a public timestamp authority, and tells you before it does.

**Price time on screen.** No transaction data exists for a persistent logo on a stream, and the one eye-tracking study puts such a banner at under 1.5% of viewer attention, below the chat box. The engine prices the stream segment it has evidence for and treats the overlay as part of it. [docs/research/overlay-pricing-2026-09.md](https://github.com/idl3o/sponsifer/blob/main/docs/research/overlay-pricing-2026-09.md) has the evidence, and what would change the decision.

**Treat a missing watermark as evidence.** Watermarks can be stripped, and the one Sponsifer uses ships with a removal model. A mark that decodes is evidence; a mark that does not proves nothing, and the tool never says otherwise.

---

## Running it from source

With Node 20.19+ or 22.12+ and Python 3.10+:

```bash
npm install
npm run bundle                 # build the app into the Python package
pipx install .                 # the toolkit
pipx install --force ".[seal]" # or with sealing: adds PyTorch, several hundred MB

sponsifer app                                   # the app at http://127.0.0.1:5180
sponsifer key --ssh ~/.ssh/id_ed25519           # sign reports and receipts with your SSH key
sponsifer seal-model                            # fetch the watermark model once, ahead of time
sponsifer seal dl-104 reel.png --source capture
sponsifer verify ad.jpg --started 2026-10-01
```

The server binds to 127.0.0.1 only, and answers only requests addressed to 127.0.0.1 or localhost, so a web page cannot reach it by rebinding a hostname. Its writes need its own origin, so a foreign page cannot start or stop the logger or change what OBS shows.

The app saves your workspace to `~/.sponsifer/workspace.json` (or `$SPONSIFER_HOME`) through that server. `seal` and `verify` write into the same file, so the app picks up a seal or a verified sighting with nothing to import. Every write checks that the file has not changed since it was read, so the app and the command line cannot overwrite each other. Pass `--workspace` to point a command at another file.

For development:

```bash
npm run dev        # http://localhost:5180, saving in the browser only
npm run dev:api    # beside it: the workspace server, so the app saves to the file
npm run check      # every gate at once: typecheck, lint, vitest and pytest. Run before any push
npm test           # 278 tests, including the calibration sweep
npm run typecheck
npm run lint       # includes the house rules: no function over 50 lines
python -m pytest   # 270 tests: the server, the on-air log, its lock and runner, status, setup, reports, labels, receipts, SSH signatures, timestamps, seal and verify

node scripts/playtest.mjs   # drives real Chrome, screenshots every tab,
                            # checks overflow, tap targets and broken numbers
python scripts/survival.py --corpus DIR   # how the watermark survives re-encoding
```

The play test uses the Chrome already installed on your machine rather than downloading a browser.

---

## Shape

```
python/sponsifer/   the `sponsifer` command
  cli.py              the parser and a table of commands
  toolkit.py          status, setup, overlay and dock; one way to connect to OBS
  client.py           the command line asking the running app, as its own page would
  obs.py              the obs-websocket protocol layer and the on-air state machine
  onair.py            the append-only on-air log, for a deal or a label, and the fold that reads it
  lock.py             one logger on the machine, whichever process runs it
  runner.py           the logger as a thread of the server, for the app and the dock
  obs_setup.py        putting a deal's placements into OBS
  status.py           one read-only look at OBS
  report.py           the signed delivery and airtime reports, under their own SSHSIG namespace
  api.py, serve.py    the workspace file over HTTP: compare-and-swap writes, localhost only
  receipt.py, sealing.py, verifying.py, watermark.py, timestamp.py, manifest.py
                      sealing, behind the `seal` extra
src/domain/         pure functions: no clock, no randomness, no I/O
  stage.ts            the part of the workspace the overlay and the dock read: no pricing
  emblem.ts           the placements, and what each may draw: the disclosure and the brand, never a price
  dock.ts, onair.ts   the dock's view, and the app's reading of the log
  benchmarks.ts       every market assumption, in one editable place
  pricing.ts          rate derivation, with a rationale per factor
  offer.ts            an incoming offer judged against the same engine, with the reply
  deals.ts            deal log, personal calibration, rate submission, overrun pricing
  workspace.ts        versioned file format; validates every import and old save
src/overlay/        the OBS browser source: transparent, fails silently
src/dock/           the OBS dock
src/components/     one view per tab
src/store/          zustand and immer, kept in step with the workspace file
docs/               provenance design, the research behind the benchmarks, and an archive of papers
scripts/            browser play test, watermark survival test, OBS probe, archive renderer
```

React 18, TypeScript in strict mode, Vite, vitest, zustand. No CSS framework and no component library, so there is nothing to learn before changing something.

---

## Licence

MIT. See [LICENSE](https://github.com/idl3o/sponsifer/blob/main/LICENSE).

If this helps you land a sponsorship, the project would like to know what you were paid and what the table got wrong. That is the whole contribution loop.
