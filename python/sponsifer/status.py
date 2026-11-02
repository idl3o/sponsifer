"""What OBS has, what is in the program feed, and what is on air: one look, writing nothing.

`sponsifer status` is the wiring check before a stream. It asks OBS the same
questions the logger asks, once, and says what it would see: which of the
sources exist, which are in the program feed, which are on air, which deal
each overlay is showing, and whether the server that overlay loads from is
answering. It changes nothing in OBS, writes no log and takes no lock, so it
can run beside a logger.

Two things it says plainly because the logger cannot help them:

- **A source in the program feed is not on air** until the stream is live.
- **OBS says whether a source is in the program, not on which canvas.** With a
  second canvas running, as Twitch's Dual Format does for vertical video, no
  log can say which feed a placement was in.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Literal, Sequence
from urllib.parse import urlsplit

from .obs import Obs, canvas_count, program_scene
from .onair import deal_shown

#: Whether an overlay's server answered. None makes no claim: not a local address, or not an overlay.
Answers = Callable[[str], bool | None]

State = Literal["missing", "on-air", "in-program", "not-in-program"]


@dataclass(frozen=True, slots=True)
class Source:
    """One source, as OBS describes it this moment."""

    name: str
    state: State
    #: OBS's kind for it, such as browser_source. None when OBS does not have it.
    kind: str | None = None
    #: The deal its overlay address names, read from the address and nothing else.
    shows: str | None = None
    #: Where a browser source loads from, as host:port.
    loads_from: str | None = None
    answers: bool | None = None


@dataclass(frozen=True, slots=True)
class View:
    obs_version: str
    websocket_version: str
    stream_live: bool
    scene: str
    #: How many canvases OBS is running. None when it would not say, which is not the same as one.
    canvases: int | None
    sources: tuple[Source, ...]


def look(obs: Obs, names: Sequence[str], answers: Answers) -> View:
    """Ask OBS once about these sources. Read-only: every request here is a Get."""
    version = obs.request("GetVersion")
    inputs = obs.request("GetInputList").get("inputs") or []
    kinds = {item.get("inputName"): item.get("unversionedInputKind") or item.get("inputKind") for item in inputs}
    live = bool(obs.request("GetStreamStatus").get("outputActive"))
    scene = program_scene(obs)
    return View(str(version.get("obsVersion", "?")), str(version.get("obsWebSocketVersion", "?")), live, scene,
                canvas_count(obs), tuple(_source(obs, name, kinds, live, answers) for name in names))


def _source(obs: Obs, name: str, kinds: dict, live: bool, answers: Answers) -> Source:
    if name not in kinds:
        return Source(name, "missing")
    kind = kinds[name]
    in_program = bool(obs.request("GetSourceActive", {"sourceName": name}).get("videoActive"))
    state: State = "on-air" if live and in_program else "in-program" if in_program else "not-in-program"
    url = obs.request("GetInputSettings", {"inputName": name}).get("inputSettings", {}).get("url")
    if not isinstance(url, str) or not url:
        return Source(name, state, kind)
    shows = deal_shown(url)
    return Source(name, state, kind, shows, urlsplit(url).netloc or None, answers(url) if shows else None)


def served(url: str, timeout: float = 1.0) -> bool | None:
    """
    Whether the Sponsifer server an overlay address names is answering. Only
    an address on this machine is asked, and only its `/api/info`; anything
    else is no claim. Found against a real OBS whose overlay was aimed at a
    port nothing served any more, so it drew nothing.
    """
    parts = urlsplit(url)
    if parts.hostname not in ("127.0.0.1", "localhost") or parts.port is None:
        return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never through a proxy
    try:
        # The server binds 127.0.0.1 only, so ask there whichever name the address used;
        # `localhost` would try IPv6 first, which on Windows costs seconds to be refused.
        with opener.open(f"http://127.0.0.1:{parts.port}/api/info", timeout=timeout) as response:
            return response.status == 200 and isinstance(json.loads(response.read()), dict)
    except (OSError, ValueError):
        return False


_STATES: dict[State, str] = {
    "missing": "not in OBS",
    "on-air": "ON AIR",
    "in-program": "in the program feed, not on air: the stream is not live",
    "not-in-program": "not in the program feed",
}


def lines(view: View) -> list[str]:
    """The view, in words."""
    stream = "Streaming." if view.stream_live else "Not streaming."
    out = [f"OBS {view.obs_version}, obs-websocket {view.websocket_version}. {stream} Program scene: \"{view.scene}\".",
           _canvas_line(view.canvases), ""]
    width = max((len(s.name) for s in view.sources), default=0)
    for source in view.sources:
        out.append(f"  {source.name.ljust(width)}  {_STATES[source.state]}")
        out.extend(f"  {' ' * width}  {note}" for note in _notes(source))
    return out


def _canvas_line(canvases: int | None) -> str:
    if canvases is None:
        return "OBS did not say how many canvases it is running."
    if canvases <= 1:
        return "One canvas."
    return (f"{canvases} canvases. OBS says whether a source is in the program, not on which canvas, "
            "so a log cannot say which feed a placement was in.")


def _notes(source: Source) -> list[str]:
    notes = []
    if source.kind is not None and source.kind != "browser_source" and source.shows is None:
        notes.append(f"a {source.kind}")
    if source.shows:
        notes.append(f"showing {source.shows}, from {source.loads_from}")
    if source.answers is False:
        notes.append(f"nothing is answering at {source.loads_from}, so it may be drawing nothing")
    return notes
