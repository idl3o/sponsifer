# OBS extensibility for a sponsorship tool, September 2026

How a local tool can reach into OBS Studio, and which of those ways the pivot should use. The tool has to put a sponsor's placement on screen, know exactly when it was on air, and give both sides of the deal a record they can check. Every claim below is marked as verified against a source or as an assumption still to test.

This machine runs OBS 32.1.1. Its WebSocket server is installed but switched off, with authentication required. Current OBS is 32.2.

## The five ways in

| Surface | What it can do | Cost to the streamer | Fit |
|---|---|---|---|
| **Browser source** | Renders any web page as a layer in a scene. In OBS the page also gets `window.obsstudio`, which reports scene changes, streaming state and the source's own visibility. | Add a source and paste a URL. | **Use.** It is the overlay itself, and every major streaming app has browser sources. |
| **Custom browser dock** | Loads a web page into a panel inside the OBS window. | Add it once under Docks. | **Use later**, for the offer evaluator and the deal panel. Not available on Wayland. |
| **obs-websocket** | Built in since OBS 28. An external program on the same machine can read state, subscribe to events, create sources and take screenshots of any source. | Switch the server on and copy its password. | **Use** for the on-air log. It lives outside the page and outside OBS. |
| **Lua or Python script** | Runs inside OBS and can hook source signals and frontend events. Lua is built in. Python needs a matching Python install on the machine. | Add the file under Tools, then Scripts. | **Decline for now.** It would be a second logging path to verify, with a known signal gap. |
| **Native plugin** | C or C++ against libobs. It can add a new source type, and answer vendor requests over the WebSocket. OBS 32 added a plugin manager. | Run an installer per OS and per OBS version. | **Decline.** It costs the most to build and to ship, for nothing the first four cannot do. |

Verified: the browser source API and its permission levels ([obs-browser README](https://github.com/obsproject/obs-browser)), the WebSocket protocol ([protocol.md](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)), the plugin manager ([OBS 32.0 release notes](https://obsproject.com/blog/obs-studio-32-0-release-notes)).

## What the overlay page can know by itself

`window.obsstudio` is gated by a permission level set on each browser source. The levels are 0 NONE, 1 READ_OBS, 2 READ_USER, 3 BASIC, 4 ADVANCED and 5 ALL. `getStatus` needs READ_OBS and reports whether streaming and recording are running. `getCurrentScene` needs READ_USER. Starting or stopping the stream needs ALL.

The page receives `obsSourceVisibleChanged`, `obsSourceActiveChanged`, `obsSceneChanged` and the `obsStreaming…` events.

The overlay therefore could time itself. The project's decision says it must not. A page can be unloaded when the source is hidden, if the streamer ticked "shut down source when not visible". It can crash, reload, or load late. A log written by the thing being logged cannot tell the difference between "off screen" and "not running". The overlay needs no permission beyond NONE, and it should ask for none.

## What obs-websocket gives the log

The protocol is JSON over a WebSocket on port 4455, RPC version 1.

- **The handshake.** The server sends Hello with a challenge and a salt. The client sends Identify with an authentication string and the events it wants. The server confirms with Identified.
- **The authentication string.** Hash the password and the salt with SHA-256 and base64 the result. Then hash that together with the challenge, and base64 again.

The events that matter:

| Event | Fields | Meaning |
|---|---|---|
| `InputActiveStateChanged` | `inputName`, `inputUuid`, `videoActive` | The source entered or left the **program** feed, the one being broadcast. |
| `InputShowStateChanged` | `inputName`, `inputUuid`, `videoShowing` | Shown anywhere, preview or a dialog included. Not evidence of broadcast. |
| `StreamStateChanged` | `outputActive`, `outputState` | The stream started or stopped. |
| `CurrentProgramSceneChanged` | `sceneName`, `sceneUuid` | Context for the log. |
| `SceneItemEnableStateChanged` | `sceneName`, `sceneItemId`, `sceneItemEnabled` | The streamer toggled the overlay's visibility in a scene. |

`InputActiveStateChanged` and `InputShowStateChanged` are **high-volume subscriptions, excluded from "All"**. The client has to ask for them by bit: 1 << 17 and 1 << 18. A client that subscribes to "All" hears nothing about activity and logs an empty delivery.

The requests that matter:

- **`GetSourceActive`** returns `videoActive` and `videoShowing` for one source, which lets the log check itself on a timer.
- **`GetSourceScreenshot`** returns a base64 image of any source, including a whole scene. A frame of the program scene taken while the overlay is active shows the placement as viewers saw it.
- **`CreateInput`** with the kind `browser_source` can add the overlay to the streamer's scene with the right URL and size. Setup becomes one confirmation instead of a paragraph of instructions.
- **`GetStreamStatus`** returns `outputTimecode` and `outputDuration`. See the pitfall below.

## Pitfalls found

- **The stream clock lies under Enhanced Broadcasting.** `outputDuration` is multiplied by the number of video tracks when Twitch Enhanced Broadcasting is on ([obs-websocket #1234](https://github.com/obsproject/obs-websocket/issues/1234), [#1273](https://github.com/obsproject/obs-websocket/issues/1273)). Other reports describe timecodes inflated by frame-rate mismatches. The log must record wall-clock UTC for every transition, and compute durations itself.
- **Activation signals have been unreliable in studio mode.** A closed OBS issue reports that `source_activate` and `source_deactivate` fired for media sources but not for image or text sources after a studio-mode transition ([obs-studio #3789](https://github.com/obsproject/obs-studio/issues/3789)). The page does not say how it was resolved, or whether browser sources were affected. The WebSocket's active-state event rests on the same signals. So the log treats events as prompts, and confirms them with `GetSourceActive` every few seconds. Where the two disagree, the poll wins and the report says so. *Unverified: whether the gap affects browser sources in OBS 32.*
- **Nested scenes.** A source inside a scene that is itself nested in the program scene should count as active. *Unverified: test it before relying on it.*
- **Stream delay.** A configured stream delay shifts what viewers saw by that many seconds. The log should record the delay beside the intervals. *Unverified: that the WebSocket exposes it, probably as the profile parameters `DelayEnable` and `DelaySec` through `GetProfileParameter`.*

## Where the evidence actually lives

The on-air log runs on the creator's machine, so on its own it is the creator's word. The project already declines to treat self-signed statistics as proof. Three things lift it above that:

1. **The VOD.** The stream's own recording on the platform shows the overlay to anyone. The log's real job is to be an *index into the VOD*: it records each on-air interval as a UTC time and as an offset from the stream's start, so the sponsor can open the VOD at the minute stated and see the placement. That is evidence the creator cannot fabricate after the fact.
2. **Frames.** Screenshots of the program scene taken during each interval show what was broadcast, even after the VOD has gone.
3. **The platform's public numbers.** Twitch reports a live stream's current viewer count to any registered app, so the sponsor can sample it themselves during the slot, with no login from the creator.

**VODs expire.** Twitch keeps past broadcasts 7 days for most streamers, 14 for Affiliates and 60 for Partners ([VOD Manager](https://vod-manager.com/guides/how-long-twitch-vods-stay), [vodfetch](https://vodfetch.com/blog/how-long-do-twitch-vods-last)). So the delivery report has to reach the sponsor inside that window. The tool should say so, and suggest highlighting the segments, since highlights do not expire. YouTube keeps live archives until the creator removes them.

The report is signed like the existing receipts, with the creator's SSH key, and the sponsor checks it with stock `ssh-keygen`. A sealed receipt and a delivery report for the same deal can then be checked together.

## Recommended shape

1. **The overlay is a page served by the local server,** added to OBS as a browser source that requests no permissions. It shows the sponsor's asset and a disclosure label. The disclosure is not optional: the UK's advertising code, the CMA and the FTC all require paid placements to be identified as ads, and Twitch has its own branded-content setting.
2. **The logger lives in the local server.** It connects to obs-websocket on 127.0.0.1:4455, and subscribes to Outputs, Scenes, SceneItems and the two high-volume input events. It reconciles those events against `GetSourceActive` polls and appends every transition, with a UTC time, to the deal's log in the workspace folder. Only intervals while the stream is live and the source is active count as delivery.
3. **The workspace file becomes the source of truth.** OBS's embedded browser keeps its own storage, apart from the streamer's browser. The overlay, the dock, the web app and the CLI can only agree through a file the local server owns. The server therefore gains a small read-only JSON interface for the overlay, and a write path for the app. This is the restructure the pivot already named.
4. **The evaluator and the deal panel come later, as a custom dock** showing the same app.

Status on 2026-09-12: the third item is built. The server owns `~/.sponsifer/workspace.json` and serves it at `/api/workspace`, with compare-and-swap writes. The first item is built in part: `/overlay.html?deal=<id>` draws the disclosure and the sponsor's name for a won deal, with no sponsor asset yet.

The second is built as `sponsifer log <deal>`, in `python/sponsifer/onair.py`, and tested against a fake OBS that can drop an activation signal the way studio mode did. It has **not** been run against real OBS: the probe's question is still open, which is why the poll carries the log and the events are only prompts. Starting it from the app, and the signed delivery report that reads its output, come next.

## Decisions this forces

- **A WebSocket client for Python.** The standard library has none. The choice is the `websockets` package, which is pure Python and widely used, or a minimal client written here, as the BOLT11 decoder was. The protocol needs only text frames, masking and ping, so either is defensible. The package is less to get wrong.
- **The WebSocket password is a credential.** Unlike the node macaroon it cannot be left in a file OBS owns, because OBS stores it in its own config. The options are to ask for it once per session, or to keep it in the OS keyring. Storing it in plain text beside the workspace is declined.
- **Pricing an overlay.** The engine prices a Twitch stream segment on concurrent viewers. A banner that stays on screen for an hour is a different product, and would need its own format with cited evidence before it gets a benchmark. That rule has not moved.

## What is declined

- **A native plugin,** until something the WebSocket cannot do is needed.
- **Logging from the overlay page.** The page is the thing being logged.
- **Logging from a Lua or Python script** as a second path. It could return as a fallback for streamers who will not switch the WebSocket server on.
- **Reading or storing the WebSocket password in plain text.**
- **Treating the log as proof on its own.** The VOD and the frames are the evidence; the log is the index.
- **Supporting other streaming apps' control interfaces.** Streamlabs Desktop, XSplit and Meld all render browser sources, so the overlay works there, but the on-air log is OBS-only until someone asks.

## Next test

The riskiest assumption is that OBS reports a browser source's program activity reliably, including in studio mode and inside nested scenes. `scripts/obs_probe.py` tests it. It prints each relevant event with a UTC time, polls the source every two seconds of quiet, and flags every poll that disagrees with the events.

1. Switch the WebSocket server on in OBS (Tools, then WebSocket Server Settings), and copy the password.
2. Add a browser source named "Sponsor overlay" to a scene. Any URL will do.
3. Run the probe, and paste the password when asked:

   ```bash
   python scripts/obs_probe.py --source "Sponsor overlay" --log probe.jsonl
   ```

4. Start a stream, or a test stream to a throwaway key, then work through the cases:
   - switch scenes;
   - toggle the source's eye;
   - put the source in a nested scene;
   - use studio mode, with the source in preview and then in program;
   - reload the browser source.

5. Stop with Ctrl+C. The summary counts the on-air intervals and the disagreements.

No disagreements across those cases means the events can be billed against, with the poll kept as a guard. Any disagreement is a finding for this note, and the poll then has to carry the log.

### The run, 18 September 2026

OBS 32.2.2, obs-websocket 5.7.4, authentication off, the overlay created over the WebSocket into the program scene and pointed at the served overlay page. Sam worked through the cases while the probe watched.

- **Scene switches**, six of them, each produced a matching `InputActiveStateChanged` and `InputShowStateChanged` pair within 20 ms of `CurrentProgramSceneChanged`.
- **The eye**, toggled twice in the program scene: `SceneItemEnableStateChanged` followed by the input events, both ways.
- **Studio mode** on and off: `StudioModeStateChanged` twice, the program scene reported unchanged, the source's state undisturbed.
- **Every poll agreed with the events.** The single "disagreement" in the log is the probe's own first reading, which that version of the probe still counted; the logger never did, and the probe now matches it.
- **Not exercised: a live stream.** Both `StreamStateChanged` events carry `outputActive: false`. They are two stream starts that failed to connect to the ingest, which is what Sam had seen as "the server connection failing". It was OBS failing to reach Twitch, not the overlay or the local server, both of which `GetSourceScreenshot` showed rendering the emblem correctly at the time.
- **Not exercised: a nested scene.** The overlay moved between scenes but was never placed inside a scene nested in another.

So, for a browser source in OBS 32: the activation events are reliable for scene switches, visibility toggles and studio mode, and the poll stays as the guard. The stream-live half and nested scenes remain to be run with a test stream.
