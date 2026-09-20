"""Watch one OBS source and report, second by second, whether it was on air.

    python scripts/obs_probe.py --source "Sponsor overlay" [--log probe.jsonl]

The question it answers: does OBS report a browser source's presence in the
program feed reliably enough to bill against? It prints every relevant event
with a UTC time, polls the source's state on a timer, and flags any poll that
disagrees with what the events said. Try it while switching scenes, toggling
the source, nesting its scene, and using studio mode.

On air means the stream is live and the source is in the program feed. Times
are wall-clock UTC, never OBS's own stream clock, which is inflated under
Enhanced Broadcasting.

Needs OBS 28 or later with the WebSocket server switched on (Tools, WebSocket
Server Settings), and the `websockets` package. The password is read from
OBS_WEBSOCKET_PASSWORD or asked for, never echoed, stored or logged.
"""

from __future__ import annotations

import argparse
import getpass
import itertools
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    from sponsifer.obs import Obs, OnAir, utc_now
except ModuleNotFoundError:  # a checkout without the package installed
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
    from sponsifer.obs import Obs, OnAir, utc_now

class Probe:
    """Feeds OBS events and polls into OnAir and reports each line."""

    def __init__(self, source: str, write: Callable[[dict], None]):
        self.source, self.write, self.state = source, write, OnAir()

    def report(self, kind: str, **fields: Any) -> None:
        self.write({"at": utc_now(), "kind": kind, **fields})

    def event(self, e: dict) -> None:
        """React to one OBS event."""
        kind, data, at = e["eventType"], e.get("eventData", {}), utc_now()
        if kind == "StreamStateChanged" and data.get("outputState") in ("OBS_WEBSOCKET_OUTPUT_STARTED", "OBS_WEBSOCKET_OUTPUT_STOPPED"):
            self.report(kind, live=data["outputActive"], onAir=self.state.stream(data["outputActive"], at))
        elif kind == "InputActiveStateChanged" and data.get("inputName") == self.source:
            self.report(kind, active=data["videoActive"], onAir=self.state.source(data["videoActive"], at))
        elif kind == "InputShowStateChanged" and data.get("inputName") == self.source:
            self.report(kind, showing=data["videoShowing"])
        elif kind in ("CurrentProgramSceneChanged", "CurrentPreviewSceneChanged", "StudioModeStateChanged", "SceneItemEnableStateChanged"):
            self.report(kind, **data)

    def poll(self, obs: Obs, first: bool = False) -> None:
        """
        Ask OBS directly and reconcile with what the events said. The first
        reading only establishes the state: it cannot tell a missed event from
        a source that was already on screen, so it is not a disagreement.
        """
        live = obs.request("GetStreamStatus")["outputActive"]
        active = obs.request("GetSourceActive", {"sourceName": self.source})["videoActive"]
        disagreed, change = self.state.poll(live, active, utc_now())
        if first:
            self.state.disagreements -= disagreed
            self.report("Poll", live=live, active=active, disagreed=False, baseline=True, onAir=change)
        elif disagreed or change:
            self.report("Poll", live=live, active=active, disagreed=disagreed, onAir=change)

    def summary(self) -> dict:
        s = self.state
        return {"intervals": s.intervals, "openSince": s.since, "disagreements": s.disagreements}


def begin(obs: Obs, probe: Probe) -> None:
    """Report what OBS is, then take the baseline reading."""
    probe.report("Start", source=probe.source, **obs.request("GetVersion"))
    probe.poll(obs, first=True)


def watch(obs: Obs, probe: Probe, poll_every: float, polls: int | None = None) -> None:
    """Events as they come, and a poll whenever it is quiet. `polls` bounds it for tests."""
    for _ in range(polls) if polls is not None else itertools.count():
        event = obs.next_event(poll_every)
        if event is not None:
            probe.event(event)
        else:
            probe.poll(obs)


def run(obs: Obs, probe: Probe, poll_every: float, polls: int | None = None) -> None:
    """Report the starting state, then watch until interrupted."""
    begin(obs, probe)
    watch(obs, probe, poll_every, polls)


def main(argv: list[str]) -> int:
    """Connect to OBS and probe until interrupted."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, help="the input's name in OBS, e.g. the browser source")
    parser.add_argument("--url", default="ws://127.0.0.1:4455")
    parser.add_argument("--poll", type=float, default=2.0, help="seconds of quiet between polls")
    parser.add_argument("--log", help="also append each line, as JSON, to this file")
    args = parser.parse_args(argv)
    from websockets.sync.client import connect

    password = os.environ.get("OBS_WEBSOCKET_PASSWORD") or getpass.getpass("OBS WebSocket password (blank if none): ") or None
    log = open(args.log, "a", encoding="utf-8") if args.log else None  # noqa: SIM115 - closed below

    def write(line: dict) -> None:
        print(json.dumps(line, ensure_ascii=False), flush=True)
        if log:
            log.write(json.dumps(line, ensure_ascii=False) + "\n")

    probe = Probe(args.source, write)
    try:
        with connect(args.url, open_timeout=5) as socket:
            obs = Obs(socket, probe.event)
            obs.identify(password)
            run(obs, probe, args.poll)
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError) as error:
        print(f"Could not probe OBS at {args.url}: {error}. Is OBS running, with the WebSocket server "
              "switched on under Tools, WebSocket Server Settings?", file=sys.stderr)
        return 1
    finally:
        if probe.state.intervals or probe.state.since or probe.state.disagreements:
            write({"at": utc_now(), "kind": "Summary", **probe.summary()})
        if log:
            log.close()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
