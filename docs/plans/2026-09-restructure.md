# The restructure, September 2026

The first build of the OBS pivot: the workspace file becomes the source of truth, and the first browser source goes on screen. Everything the pivot still owes is listed at the end.

Branch: `feat/obs`, continuing from the shop board at 8b9b508.

## Why

The overlay, a future OBS dock, the web app and the CLI have to agree on one set of data, and they could not. The app kept everything in browser localStorage; OBS's embedded browser keeps storage of its own; and the CLI worked on a file the creator exported by hand and imported back after every `seal` or `verify`. `docs/research/obs-extensibility-2026-09.md` names the fix in its third recommendation.

## Starting state (2026-09-12)

- 139 TypeScript tests and 48 Python tests passed; the typecheck, the lint and the audit were clean.
- The workspace file's shape was already the export's shape, so no format bump was needed. It stays 4.
- `importAll` never touched `seq`, so a file whose ids ran past the counter could have its ids reused. Latent then; live once every load is an import.
- zustand's persist skipped `parseWorkspace` for a save already at the current version.
- Python wrote the workspace atomically but with no compare-and-swap, and `sealing.py` and `verifying.py` each did an unguarded read-modify-write.

## Phases

Each phase is its own commit, with the typecheck, the lint and both suites passing after it.

| Phase | Commit | What |
|---|---|---|
| The name in one constant | ed3026f | `PRODUCT` on each side, and `docs/rename.md` listing every identifier a rename must migrate |
| The server owns the file | b94f911 | `api.py`, compare-and-swap writes, the Host and Origin guards, `seal` and `verify` writing through |
| The app syncs to it | 1b78611 | `sync.ts` and `workspaceClient.ts`, the status line, `npm run dev:api` |
| The overlay | b324768 | `/overlay.html?deal=<id>`, the disclosure, Copy OBS URL |
| Truth pass | 9f60d6f | README, CONTRIBUTING, CLAUDE.md, the research note |
| Housekeeping | this commit | the play test visits the board and the overlay; the CLI's defaults are tested; this record |

## Decisions taken along the way

- **The browser remembers the revision it last saw** (`sponsifer-sync-revision`). If the file has not moved since, the browser's copy is written up rather than replaced, so edits made while the server was down survive.
- **No reconnecting mid-session.** An app that fell back to browser-only stays there until reloaded, because a server appearing later would replace the edits made meanwhile.
- **`verify` records a sighting in the served workspace by default.** Before, it wrote nothing unless given `--workspace`.
- **The overlay carries the shop board's accent,** so the two match.
- **Copied OBS addresses use `/overlay.html`,** not the server's `/overlay` alias, so the same address works under Vite.

## Outcome (2026-09-12)

167 TypeScript tests and 87 Python tests pass. Checked end to end against the bundled server in Chrome: the first load creates the file, edits reach it, a fresh browser loads from the file rather than its own storage, a change written on disk appears when the tab regains focus, the overlay draws on a transparent page, and the Host, Origin and stale-write guards each refuse.

Found along the way:

- The server does not read chunked request bodies. Browsers always send `Content-Length`; Node's `http.request` with `req.write()` does not unless told.
- On a first run the app's probe for a file that does not exist logs a 404 in the browser console. That is the missing file, not a fault.
- PowerShell 5.1's `Set-Content -Encoding utf8` writes a BOM, which an untracked file will not show in `git status`.

## What the pivot still owes

Reassessed on 18 September 2026, before the merge to `main`, and again after it: the sponsor emblem is built (workspace format 5, edited by hand over a stream frame on the deal), and the Lightning branch's format must become 6. Built since the restructure: the offer evaluator (d1aec61), the on-air logger (22fab30), the signed delivery report (f2bcf96), the overlay-pricing evidence (0f08ee5, which declined a benchmark), the rename to Sponsifable (a596a0e) and, two days later, to Sponsifer (1e50123), and the app's read-only view of the on-air log and its reports. The `websockets` package won over a hand-rolled client, and the OBS password is asked for per session rather than kept in a keyring. One real OBS session confirmed the overlay renders and that scene switches produce matching activation events.

Built on `feat/placements` and merged on 20 September 2026: a lower third, a segment slate and a break card beside the corner emblem, each its own OBS source, with the on-air log and the delivery report counting each placement separately.

Still owed, in the order they should be taken:

- **The remaining probe passes** — eye toggle, nested scene, studio mode, source reload — and a test stream, so the logger's riskiest assumption is tested rather than designed around. Only Sam can run these.
- ~~Starting and stopping the logger from the app.~~ Built on 20 September 2026 (`python/sponsifer/runner.py`, `src/components/LoggerControl.tsx`). It is a thread of the server rather than a second process, one logger at a time. The password decision: asked in the app when OBS asks for it, sent once to the server on this machine, used for the handshake and not kept anywhere. Run end to end against a stand-in OBS over a real socket; not yet against OBS itself, which belongs with the probe passes above.
- ~~The deal panel as an OBS dock.~~ Built on 20 September 2026 (`dock.html`, `src/dock/`, `src/domain/dock.ts`): one dock for every deal, the logger's Start and Stop, and each placement's state this moment, read from the running logger's own state rather than from the log. No price. Seen in Chrome at a dock's width with the logger on real OBS; adding it to OBS itself is a paste the streamer does, because obs-websocket has no request for docks.
- **The first PyPI release.** Both publishers are registered under `sponsifer`, the release workflow's first runs found and fixed its one bug (5a88ba1), and TestPyPI holds `0.2.0.dev0` since 20 September 2026. What remains is the release itself, per `docs/RELEASING.md`: a rehearsal of the real version on TestPyPI, a `v*` tag, and the approval. Until then the name on PyPI is open to anyone.
- **Payment**, shelved on `sandbox/lightning`.
- **The framework majors** (React 19, zustand 5, immer 11), deferred three times now.
- **Bringing the design canvas back in line with the code**, starting with the editor's control sizes.
