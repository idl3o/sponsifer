# Sponsifer — working notes

## Decisions, not accidents — do not undo

- **Not a marketplace.** Single-player tool. No brand-side account, no two-sided liquidity problem. If a future session proposes "let brands sign up", that is a different product.
- **Domain layer is pure.** No `Date.now()`, no `Math.random()`, no I/O in `src/domain/*` (except `localModel.ts`, which is explicitly the I/O edge). Today's date is read once in `App.tsx` and passed down as a prop. Ids come from a monotonic `seq` counter in the store.
- **Every price carries its rationale.** `Adjustment.rationale` is a sentence the creator says out loud in a negotiation. Adding a factor without one defeats the point of the tool.
- **Benchmarks live in one file.** `src/domain/benchmarks.ts`. Never inline a CPM or multiplier at a call site.
- **Local-first, no telemetry.** Nothing is transmitted. Rates and prospect lists are commercially sensitive.
- **Production floor beats reach for small creators.** `PRODUCTION_FLOOR` in `benchmarks.ts` sets the least each format can sell for. Pure cost-per-impression pricing told a 900-view creator to charge £30 for a day of work, which is the worst thing this tool could do to the people who most need it. `priceLine` takes `max(mediaValue, productionFloor × termsFactor)` and reports both numbers. Do not remove the floor to "simplify" the engine.
- **Never show a CPM derived from a floored price.** Dividing a labour cost by a small audience yields £500 CPM, which ends a negotiation. The rate card hides it, the blended-CPM stat excludes floored lines, and `priceSentence` in `pitch.ts` writes a different sentence. Tests lock all three.

- **No overlay format, and that is the finding** (`docs/research/overlay-pricing-2026-09.md`, 2026-09-18). No primary price for a persistent on-screen placement exists: every figure traces to rate-guide sites, one of which declares its numbers algorithmically generated. The one eye-tracking study puts a persistent banner at 0.6–1.3% of viewer attention, below the chat box, so impressions x CPM overstates it by about an order of magnitude. The same sweep cross-checks what is already there: the £12 Twitch stream CPM sits inside the $10–25 per thousand cluster and 63x below the "$1 per CCV per hour" folklore, and the £120 production floor lands within £5 of Collabstr's average completed Twitch deal. Do not add an overlay CPM without transaction data.
- **Benchmark changes cite evidence.** `docs/research/new-creator-economics-2026-09.md` marks every figure asking or paid, with a reliability rating. A constant changed without a cited source, or tuned only until the calibration sweep passes, is the circularity the sweep exists to catch.
- **The paid-market reference is shown, never priced.** `MARKET_PAY` (Smith 2026, pay proportional to followers^0.489) sits beside the price for Instagram and TikTok main formats only. Do not feed it into `target`, and do not extend it to platforms the paper does not cover. The calibration sweep also asserts each covered archetype stays within 3x of it.
- **Paid usage is per 30-day period**, as `max(share × organic, minimum)` per period, or the declared-spend share where that is larger. A buyout is the placement again, never below six periods at the minimum. The overrun invoice uses the same per-period rate.
- **The introductory rate lapses with the first result.** `hasResults(profile)` gates it inside the pricing engine, not just the UI, and the pitch names it as a trade. It is the only path that prices below the production floor.
- **Direction, 2026-09-11: a full pivot to an OBS tool for streamers.** It covers everything both sides of *one* sponsorship deal need: an offer evaluator over the existing engine, the sponsor overlay as an OBS browser source served by the local server, an on-screen log read from OBS's built-in WebSocket (not timed in the overlay page), a signed delivery report, and payment. Still not a marketplace: matchmaking belongs to StreamElements and Twitch's Sponsorship Dashboard. The work starts on its own branch after the spring clean. It moves the source of truth from browser storage to the workspace file, because OBS's embedded browser keeps separate storage (built; see "Workspace and server" below), and it replaces the audience line below deliberately rather than by drift.
- **Renamed twice in September 2026, identifiers included each time** (`docs/rename.md`): Sponsorable to Sponsifable on 2026-09-18, and Sponsifable to Sponsifer on 2026-09-20. Each was done in one pass because every migration was still a no-op: nothing published, no tags, no home directory in existence. Prose goes through `PRODUCT` in `src/brand.ts` and `python/sponsifer/brand.py`. The GitHub repository is `idl3o/sponsifer`; both older names redirect. In any future rename, move the URLs after the repository, not before, because GitHub redirects old names forward and never new names back. Two things keep an older spelling on purpose: the timestamp fixture's digest, which covers the bytes an authority actually signed, and `RENAMED_FROM` in `useStore.ts`, which adopts a browser save written under either earlier name. "Sponsoar" and "Sponsify" were checked and rejected. **Sponsifer was chosen with two known neighbours:** Toyota's *Sponsafier* campaign (Toyota holds sponsafier.com and the misspelling sponsifier.com) and SPONSIFI, a registered Canadian mark in classes 35, 36 and 42. Sam checked the UK trademark register on 2026-09-20: available. EUIPO and the USPTO are unchecked, for the name and for both neighbours.
- **The first audience is the low-budget, self-hosting, technical creator.** Tech, B2B and developer-tools creators, newsletter writers, maintainers with an audience. Distribution is one `pipx install` that serves the app on localhost and carries the `seal` CLI. Do not claim to serve UGC creators generally until the tool reaches people who will not open a terminal.

### Provenance (see `docs/provenance.md`)

- **Sealing is opt-in.** Only an explicit `sponsifer seal`, with a confirmation, watermarks anything. The web app never seals.
- **Sealing cannot be retroactive, and the evidence enforces it, not the app.** A claim needs the watermark in the ad itself, a timestamp earlier than the ad's start date, and a receipt the sponsor has held since delivery. The CLI's refusal to seal lost, delivered or already-sealed deals only catches mistakes. Never add a path that seals an existing file or backdates a record.
- **The watermark carries a serial, never the terms.** A payload under 100 bits allows a birthday search for alternative terms. The terms live in the signed receipt.
- **Sealing is the only network call that carries anything derived from the creator's data.** One salted SHA-256 digest goes to an RFC 3161 timestamp authority, opt-in per deal, and the confirmation says so first. The only other access is TrustMark's one-off model download (`sponsifer setup`), which sends nothing about the creator.
- **Seal each aspect ratio delivered.** The survival proxy shows model Q / BCH_SUPER survives compression, downscaling, crops, banners, grading and H.264, and fails on reframing a landscape to 4:5 or 9:16. Do not switch model or schema without rerunning `scripts/survival.py`.
- **The licence window is frozen on the deal** (`Deal.paidUsageDays`, null for unlimited). Python reads it from the deal; never copy `PAID_USAGE_DAYS` into Python.
- **Receipts are signed with the creator's SSH key through `ssh-keygen -Y sign`** (SSHSIG, namespace `sponsifer-receipt`). Sponsifer never reads or stores the private key; passphrases, agents and hardware keys are OpenSSH's job. The sponsor verifies with stock `ssh-keygen`. Do not reintroduce a Sponsifer-held signing key, and keep `sshsig.py` byte-compatible with OpenSSH: `test_sshsig.py` checks both directions against the installed binary.
- **`--source` is required on `seal`.** The tool cannot know how an asset was made, and C2PA's claim of creation states it. No default.
- **Disclosed, not covert.** The receipt tells the sponsor the file is marked.
- **A missing watermark proves nothing.** TrustMark ships a removal model. No copy may treat absence as evidence.
- **The delivery report is the log's signed index, and it hides nothing.** `sponsifer report <deal>` folds the on-air log through `onair.delivery()`, binds the log's SHA-256 into the document, and signs it with the creator's SSH key under its own SSHSIG namespace, `sponsifer-delivery`, so a report signature can never pass as a receipt signature or the reverse. Disagreements and an interval the logger stopped inside go in with a count and a time. The notice says the recording is the evidence and the report only says where to look, and it names the platform's retention so the sponsor checks in time. It carries no price.
- **The CLI does not price.** `verify` reports facts. The overrun invoice is composed in TypeScript from `benchmarks.ts`, so market assumptions stay in one file.

### Shop window board (see `design/shop-window/`)

- **The design canvas is the visual spec.** Its sources are in `design/shop-window/`. When code and canvas disagree, decide which should move, and update both.
- **The board's invariants hold whatever the creator designs:**
  - every preview says PREVIEW and carries the tiled pattern, which never drops below 0.04;
  - a public preview carries the link;
  - no price is ever drawn, and `boardChecks.ts` refuses one;
  - the link uses the creator's own domain, and shorteners are refused;
  - a sponsored moment gets the private board, with no public link, and goes only to its sponsor.
- **One renderer.** `src/components/board/render.ts` draws both the live preview and the exported overlay, so what the creator sees is what ships. Composite the transparent overlay PNG anywhere else; never re-implement the drawing, in Python or anywhere else.
- **The invisible mark goes on at licence activation, after the creator confirms.** Sealing stays opt-in.

### Workspace and server (built 2026-09-12)

- **The workspace file is the source of truth.** `~/.sponsifer/workspace.json` (under `SPONSIFER_HOME`), owned by `sponsifer serve` and served at `/api/workspace`. The browser's localStorage is a cache, and the whole save only when the app runs without the server. `seal` and `verify` default to the same file.
- **Every write is a compare-and-swap on a content hash.** The ETag is the SHA-256 of the file's bytes, so the CLI and the server need no coordination. `workspace.update()` reruns the CLI's change on a file that moved. Never add an unconditional write path.
- **The server's guards are the security model:** the Host header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding); a write needs the server's own `Origin` (or an `--allow-origin`) and JSON; no CORS header, ever. `test_api.py` locks each one.
- **An unreadable file is never written automatically.** Only an explicit Import replaces it, and the server copies it to `workspace.unreadable-<rev>.json` first.
- **No merge on conflict.** A refused write reloads the file and tells the creator. Python only touches `deal.seal` and `deal.sightings`, and refetch on focus closes most of the window.
- **No reconnecting mid-session.** An app that fell back to browser-only stays there until reloaded, because a server that appeared later would replace the edits made meanwhile. On start, if the file's revision equals the one this browser last saw (`sponsifer-sync-revision`), the browser's copy is written up rather than replaced.
- **The overlay never draws a price and always draws the disclosure.** `OverlayView` has no price field, and `overlayFor` always sets `disclosure: 'Ad'`. The ASA, CMA and FTC require it, and the creator is the one who answers for a missing label.
- **The overlay fails silently.** A failed read keeps the last good frame; an overlay that never loaded draws nothing. It asks OBS for no permissions and times nothing.
- **The overlay URL uses `/overlay.html`,** not the server's `/overlay` alias, so it also works under Vite.

- **The app can start and stop the on-air logger, and the server runs it** (`python/sponsifer/runner.py`, built 2026-09-20). A thread of the server, not a second process, writing the same log through the same `onair.Session` as `sponsifer log`. The rules:
  - **one logger at a time**, whichever deal it is for, because placements are found by conventional source names that are the same for every deal, so two loggers would write the same minutes into two logs. A second deal gets 409; the same deal again is not an error;
  - **starting and stopping are writes**, behind the same Origin and JSON guard as the workspace, because a foreign page must not be able to switch a creator's evidence off. `test_api.py` locks it;
  - **the OBS password is asked for only when OBS asks, sent once, and kept nowhere:** not in the store, the workspace, browser storage, the status or the log. Do not add "remember the password" without deciding where a secret may live; a keyring is a new dependency and a decision;
  - **the server connects only to the address it was started with** (`serve --obs-url`), never to one a request names;
  - **a logger that stops says why**, and a session that had begun is closed with an `end` line that leaves an open interval open. A 502 from `/api/logger/start` means this server is fine and OBS said no.
- **No timer in the logger control.** It reads the status when the row opens, after each action and on window focus.
- **The on-air log is append-only, and lives beside the ledger,** at `~/.sponsifer/onair/<deal>.jsonl`, never inside the workspace: it grows per stream and it is evidence. `onair.delivery()` is the only reader of its shape, so the app and a delivery report cannot count differently.
- **On air means live *and* in the program feed.** Showing in preview is not being broadcast. Events are prompts; the `GetSourceActive` poll is the arbiter, because activation signals have been unreliable in studio mode. Every disagreement is recorded and the summary carries the count. Never smooth them away.
- **The headline time on air is a union, never a sum.** With several placements, `union_seconds` counts a moment once however many were up in it; each placement's own total sits beside it. Summing them would bill the sponsor's minutes twice.
- **An interval's offset into the VOD is null unless the logger saw the stream start.** The log's job is to be an index into the recording, and an offset from a start nobody saw is a guess.
- **`python/sponsifer/obs.py` is the one copy of the protocol layer.** `scripts/obs_probe.py` imports it, falling back to adding `python/` to `sys.path` when the package is not installed.
- `src/store/sync.ts` and `src/store/workspaceClient.ts` are the I/O edge for the workspace, outside `src/domain`. `sync.ts` takes its fetch, storage and focus hook as arguments, so it is tested in node.

### The sponsor emblem (built 2026-09-18)

- **Two layers, two owners.** `EmblemStyle` is the creator's house style, one per workspace, applied to every deal's overlay; `Deal.sponsorArt` is the sponsor's image, wording and brand colour. Do not move the style onto the deal or the art onto the workspace: a creator dresses every sponsor the same way, and a sponsor's logo belongs to one deal.
- **One renderer.** `EmblemBadge` draws the editor's preview and the OBS source from the same view at the frame's height, every dimension from `emblemGeometry`. Never measure the badge in viewport units, and never draw it a second way.
- **The "Ad" label is always in the view; no price is or leads to one.** `emblem.test.ts` locks the view's key set. `bareLogo` drops the line, never the label.
- **The drag snaps to a corner with a clamped inset** (`snapToCorner`), so a position can never be off the frame. Do not add free placement without a rule that keeps the badge on screen.
- **Motion is CSS only.** An entrance once; a label pulse on the style's period, which is the FTC's periodic disclosure for live streams. No timers in the overlay page.
- **The editor's own-frame screenshot is a `blob:` URL in component state, never stored.**
- **A placement's kind is in the address, not the workspace.** Corner emblem, lower third, segment slate, break card: `overlay.html?deal=<id>&kind=<kind>`, with the emblem's address naming none so sources already in OBS keep working. The look is the house style and the content the deal's sponsor art, so adding a kind needs no format bump. Do not give a kind stored fields without deciding that it is worth one.
- **Each kind has a conventional OBS source name, in two places on purpose:** `PLACEMENTS` in `src/domain/emblem.ts`, shown beside the address to paste, and `CONVENTIONAL_SOURCES` in `python/sponsifer/onair.py`, which the logger watches. Change one and change the other; the log finds a placement by its name and by nothing else.
- **`bareLogo` is the corner emblem's alone.** A band, a slate or a card with no words says nothing, so they always carry the line.

## Gotchas already resolved — do not regress

- `tsconfig` runs `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Optional props are spread conditionally (`{...(hint ? { hint } : {})}`) rather than passed as `undefined`. Array indexing needs a guard.
- Heredocs in this repo choke on the pricing/component files. Use the Write tool for anything with template literals and nested quotes.
- Vitest runs `.test.ts` in node and `.test.tsx` in jsdom as two projects in `vite.config.ts`, because Vitest 4 removed `environmentMatchGlobs`. Component tests must stub `fetch` (the Ollama probe) and `window.print`.
- **npm 11.4.2 crashes resolving Vitest 4's peers** (`Cannot read properties of null (reading 'edgesOut')`), even from a clean tree. Installing from the lockfile works. To change a dependency, or anything else that rewrites the lockfile, use a newer npm: `npx -y npm@11.19.1 install`. npm 11.4.2 also strips the `libc` fields that pick glibc or musl binaries on Linux CI. It skips esbuild's postinstall, which is harmless because the platform binary arrives as an optional dependency.
- **obs-websocket's `InputActiveStateChanged` and `InputShowStateChanged` are high-volume and not in "All".** Subscribe to bits 1 << 17 and 1 << 18 explicitly, or the on-air log hears nothing. "Active" means in the program feed; "showing" includes preview and is not evidence of broadcast. Record wall-clock UTC: `outputDuration` is inflated under Enhanced Broadcasting. See `docs/research/obs-extensibility-2026-09.md`.
- **A deal recorded seconds ago may not be in the workspace file yet.** The app saves a moment after an edit and the server checks the file, so Start logging pressed inside that moment gets a 404 that says so. The control keeps its button on any refusal, so it can be pressed again. Found in a real browser, not by a unit test.
- **The fold keeps an interval an earlier run left open.** A logger stopped with a placement up, then started again with it up, used to have the first open interval written over in `onair._Fold`, so the summary forgot it. It is kept in `unclosed` and still reported as `openSince`. One click now stops the logger, so this is no longer rare.
- **`python -m build` goes to `python/dist`,** not `dist/`, which holds the web build. `twine check dist/*` refuses `dist/assets`.
- **Workspace format 5 is the stream emblem** (4 was the shop board). The shelved `sandbox/lightning` branch claims format 4, for settlement. Renumber it to 6 when reviving it, and bump the Python `SUPPORTED_VERSION` to match.
- **jsdom has no 2D canvas.** App tests stub `getContext` to return null. `makeMeasure` then falls back to estimated widths, and `renderBoard` returns null rather than throwing.
- **The vertical board positions anchor to `VERTICAL_UI_ZONES`**: just under the top bar, or just above the button column. The QR code is sized (92 units landscape, 68 vertical, error correction M) for at least 3 px a module on 720p exports. The exported codes decode after 75% downscaling and JPEG at quality 60. Do not shrink the codes without the QR check passing.
- `updateChannel` resets `formats` when the platform changes. That is deliberate: a YouTube format list on a TikTok channel prices nonsense.
- The play test (`node scripts/playtest.mjs`) drives the installed Chrome via `channel: 'chrome'`, because the bundled Playwright build does not match the browsers on this machine. Do not swap it back to `chromium.launch()` without running `npx playwright install`.
- Channel cards and proof points both render a button labelled "Remove". Any selector for one must exclude the other.
- **Workspace format changes go through `src/domain/workspace.ts`.** Bump `WORKSPACE_VERSION`, teach `parseWorkspace` the old shape, and bump `SUPPORTED_VERSION` in `python/sponsifer/workspace.py`. The localStorage key stays `sponsifer-v1` on purpose; `persist.version` tracks the format. An unreadable save is copied to `sponsifer-unreadable-v<n>`, never dropped. The file's `version` must equal `SUPPORTED_VERSION`, or the server refuses the write.
- **After a workspace format bump, restart `sponsifer serve`.** The server checks `version == SUPPORTED_VERSION` on every write with the value it loaded at start, so a running server from before the bump refuses the app's first write with 422, and the app shows "Not saved to the file: expected workspace format N". The bundle on disk updates under a running server; its Python does not.
- **The play test needs a fresh workspace when run against a served app.** It ends by deleting every channel, and the server keeps that; the next run then times out waiting for "Median views per post". Delete the workspace file first. Against `npm run dev` each run starts from an empty browser and the problem does not arise.
- **The workspace file carries no `seq`.** `importAll` sets `seq = max(seq, seqFloor(workspace))`, or a loaded file's ids could be reused.
- **`npm run dev` alone saves to the browser only.** Run `npm run dev:api` beside it: Vite proxies `/api` to 127.0.0.1:5181. On a first run the app's probe for the file logs a 404 in the console; that is the missing file, not a fault.
- **Fetch settles on headers, not on the body.** A response whose body is never read keeps the request open: it stalls `networkidle` and leaks a connection per write in a browser that stays open for a whole stream. `workspaceClient.ts` drains every body it does not parse, by reading it — cancelling aborts the request instead, which shows up as a failed request.
- **The server needs `Content-Length` on writes.** It does not read chunked bodies. Browsers always send the length; Node's `http.request` with `req.write()` does not unless told.
- **TrustMark decoding must stay strict** (`schema == BCH_SUPER and len == 40`). Its decoder auto-detects the schema, and 8 of 400 clean images passed as a weaker one.
- **TrustMark will not decode a pure-noise image.** Test covers must be structured; the survival script uses real frames or drawn shapes.
- **C2PA signs with ES256.** An Ed25519 chain signed but failed claim-signature validation. The C2PA leaf needs Subject and Authority Key Identifiers, and the first action must be `c2pa.created` with a `digitalSourceType`.
- **`pip install` needs `PYTHONUTF8=1` on this machine.** One dependency's `setup.py` reads a file as cp1252 and dies otherwise.
- **`npm run bundle` before building the wheel.** The web app is gitignored inside the package and is included only via hatch `artifacts`. A git install without it serves an error telling you so.
- **The ledger holds four files per serial.** Only `<10 hex>.json` is a seal record; `ledger.entries()` matches that pattern, because `<serial>.receipt.json` sits beside it.
- `python -m pytest` needs the repo venv (`.venv`, created with `--system-site-packages` to reuse the installed torch). Tests fake the watermark and the timestamp authority; `python/tests/fixtures/digicert-probe.tsr` is a real token over SHA-256("sponsorable api probe") for offline token tests; the old spelling is deliberate, because those are the bytes DigiCert signed.

## Archive

`docs/archive/` holds dated papers as Markdown, the source of truth; `scripts/archive/render.py` draws each into a page under `dist/archive/`. Titles name the idea, not the product. A paper published under the old name keeps it: the colophon records what was true when it was written. A published paper takes errata, not edits. See `docs/archive/README.md`.

## Calibration

`src/domain/calibration.test.ts` runs nine realistic creator archetypes end to end and asserts each headline price lands in a range a working creator would recognise. It is the guard against a benchmark edit quietly turning a £400 placement into a £40 one. Run `npx vitest run calibration --reporter=verbose` to read the table. The lower bound of each range is a walk-away number, not a target.

## Known gap

Prospect *discovery* is not solved and is not pretended to be. Scoring ranks a list the creator assembles by hand. A real sponsor database is the expensive part and would need a backend, which would break the local-first promise. Decide that trade deliberately before building it.
