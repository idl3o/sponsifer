# The toolkit, November 2026

Sponsifer becomes a command-line toolkit for streamers who run OBS, installed from PyPI, with pricing kept in the same wheel behind it. Everything still owed is listed at the end.

Branch: `feat/toolkit`, from `main` at bf21267.

## Why

The parts existed, but they were arranged as one app with a command line beside it. A bare `sponsifer` opened the app, and `setup` meant downloading the watermark model. OBS setup had no command, and nothing could check OBS's wiring without starting a logger. The base install brought an imaging and C2PA stack that only sealing used. The command names and the base dependencies become promises at the first PyPI release, so they had to be settled before it.

Sam's answers on 2026-11-02:

- the toolkit is for streamers and is used from the command line first;
- pricing stays, behind the OBS front door;
- it is "a library of useful tools", so each tool works on its own;
- the logger and the report work without a deal;
- the commands are flat verbs;
- sealing stays the `seal` extra.

## Starting state (2026-11-02)

- The last commit was 43 days old. 271 vitest and 192 pytest tests passed, and CI was green.
- The one-logger rule held only inside the server. A terminal's `sponsifer log` and the app's logger could run at once and double the totals.
- Two claims in public copy were wrong or incomplete: the emblem editor said the FTC asks for the label's pulse, and the README said the log records every second a placement was in "the broadcast feed".

## Phases

Each phase is its own commit, with every gate passing after it.

| Phase | Commit | What |
|---|---|---|
| Honest copy | 3f089bc | the pulse is emphasis and the label is the disclosure; the README states the single-canvas limit |
| A light base install | 7f811aa | the base install is `cryptography` and `websockets`; `test_imports.py`; CI's `python-base` job. It found `seal` and `verify` raising ImportError where they should have printed the install hint |
| One logger across processes | d99cb25 | `lock.py`: the operating system's file lock, taken by the terminal, the server and a setup |
| The flat command line | f39d1e7 | a bare command lists the tools; `app`, `status`, `setup`, `overlay`, `dock`, `seal-model` |
| Labels | 48597e5 | `log --label`, the airtime report, canvases recorded in every session |
| The overlay without pricing | 492341c | `stage.ts`, `parse.ts`, `serverClient.ts`; the chunk OBS loads drops from about 198 KB to 155 KB, with no pricing code in it |
| The front door | this commit | README, descriptions, CLAUDE.md, RELEASING.md, this record |

## Decisions taken along the way

- **`setup` on the command line goes through the running server.** That way it keeps every rule `test_api.py` already locks, without a second copy of them. The tests run it end to end: command line, HTTP, WebSocket, stand-in OBS.
- **A label log refuses a source that shows a deal.** Without that, a sponsor's minutes could be recorded outside the deal whose report reads them.
- **Labels have folders of their own, for logs and reports alike.** A label could otherwise take a file name that a later deal needs, or appear in that deal's list of reports.
- **The canvas count enters a report only when it is more than one.** A report from a single canvas stays byte-identical to the one before; golden files captured before the change lock that.
- **`status` asks for its password only when OBS asks,** and so does `log` now. Before, `log` asked every time, even when OBS had no password set.

## Outcome (2026-11-02)

The suites stand at 278 vitest and 268 pytest. They also pass on a base install with no extras: 250 tests, plus one sealing test skipped by design.

## Still owed

- **Against Sam's real OBS:** `status`; a label log of a real source; a report checked with stock `ssh-keygen`; and a terminal logger refusing the app's Start. OBS was not running on this machine during the build.
- **The real stream cases still unrun:** a live stream and a nested scene.
- **The release:** 0.2.0 to PyPI waits on the EUIPO and USPTO trademark searches, and it is Sam's step (`docs/RELEASING.md`).
- **The C2PA soft binding.** The first push of this branch turned CI red. It was not the branch: c2pa-python 0.37.12 and later refuse to sign a `c2pa.watermarked` action without a soft-binding assertion, and every fresh `[seal]` install since 2026-09-24 got such a version. The extra is held at 0.37.10. The lasting fix is a soft-binding assertion naming TrustMark, which is a provenance decision.
