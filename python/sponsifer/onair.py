"""The on-air log: when each of the sponsor's placements was actually in the program feed.

What this is for. A sponsor pays for time on screen in front of an audience.
The creator's word for it is not evidence, and neither is this log on its own.
Its job is to be an **index into the VOD**: each interval is a wall-clock UTC
time and, where the logger saw the stream start, an offset from that start, so
the sponsor can open the recording at the minute stated and see the placement.

A deal can have several placements on a stream: a corner emblem, a lower
third, a segment slate, a break card. Each is its own browser source in OBS,
found by its name, and the log keeps an on-air state for each, so a report can
say how long each one was up rather than one blended figure.

The rules it keeps, all of them from `docs/research/obs-extensibility-2026-09.md`:

- **On air means both**: the stream is live and the source is in the program
  feed. Showing in preview is not being broadcast.
- **The poll wins.** OBS's activation events have been unreliable in studio
  mode, so events are prompts and `GetSourceActive` is the arbiter. Every
  disagreement is written down rather than smoothed over, and the delivery
  report carries the count.
- **Wall-clock UTC, never OBS's stream clock**, which is inflated under
  Enhanced Broadcasting.
- **Append only.** The log is written as it happens and never rewritten. A log
  that can be edited afterwards is a claim, not a record.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable

from .obs import Obs, OnAir, utc_now

#: Logs live beside the ledger, one file per deal, never inside the workspace.
LOG_DIR = "onair"

#: What each placement's browser source is called in OBS, the corner emblem
#: first. Mirrors PLACEMENTS in src/domain/emblem.ts, which shows each name
#: beside the address to paste.
CONVENTIONAL_SOURCES = ("Sponsor overlay", "Sponsor lower third", "Sponsor slate", "Sponsor card")


def log_path(home: Path, deal_id: str) -> Path:
    """Where a deal's on-air log is appended."""
    return home / LOG_DIR / f"{deal_id}.jsonl"


def append(path: Path, line: dict[str, Any]) -> None:
    """Add one line to the log, creating it if needed. Never rewrites what is there."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, ensure_ascii=False) + "\n")


@dataclass
class Session:
    """One run of the logger: OBS's events and polls, written down as they happen."""

    deal_id: str
    #: The OBS sources to watch: one name, or several.
    sources: list[str] | str
    write: Callable[[dict[str, Any]], None]
    states: dict[str, OnAir] = field(default_factory=dict)
    #: Whether OBS is streaming, as last known, and when it went live.
    live: bool = False
    stream_started_at: str | None = None
    start_observed: bool = False
    disagreements: int = 0

    def __post_init__(self) -> None:
        names = [self.sources] if isinstance(self.sources, str) else list(self.sources)
        self.sources = list(dict.fromkeys(names))
        self.states = {name: OnAir() for name in self.sources}

    def record(self, kind: str, **fields: Any) -> None:
        self.write({"at": utc_now(), "kind": kind, "deal": self.deal_id, **fields})

    def _keep_present(self, obs: Obs) -> list[str]:
        """Watch only the sources OBS actually has, and return the ones it lacks."""
        inputs = obs.request("GetInputList").get("inputs")
        if inputs is None:  # an OBS that will not say; watch what was asked for
            return []
        present = {item.get("inputName") for item in inputs}
        missing = [name for name in self.sources if name not in present]
        self.sources = [name for name in self.sources if name in present]
        self.states = {name: self.states[name] for name in self.sources}
        return missing

    def begin(self, obs: Obs) -> None:
        """Write the session's header, then take the first reading from OBS itself."""
        version = obs.request("GetVersion")
        asked = list(self.sources)
        missing = self._keep_present(obs)
        if not self.sources:
            raise RuntimeError(f"none of these sources exist in OBS: {', '.join(asked)}")
        self.record("session", sources=self.sources, missing=missing, obsVersion=version.get("obsVersion"),
                    websocketVersion=version.get("obsWebSocketVersion"))
        self.poll(obs, first=True)

    def _stream(self, live: bool, at: str, observed: bool, by: str) -> None:
        """The stream started or stopped: remember when, and move every placement with it."""
        if live and self.stream_started_at is None:
            self.stream_started_at, self.start_observed = at, observed
            self.record("stream", live=True, startObserved=observed)
        self.live = live
        # Close each placement's interval before the stream's start is forgotten,
        # so the closing lines still carry their offsets into the recording.
        for name, state in self.states.items():
            self._transition(name, state.stream(live, at), by, at)
        if not live and self.stream_started_at is not None:
            self.record("stream", live=False)
            self.stream_started_at, self.start_observed = None, False

    def _transition(self, source: str, change: str | None, by: str, at: str) -> None:
        if change is None:
            return
        offset = offset_seconds(self.stream_started_at, at) if self.start_observed else None
        self.record("onair", source=source, state=change, by=by, at_=at, streamOffsetSeconds=offset)

    def event(self, message: dict[str, Any]) -> None:
        """React to one OBS event. Events are prompts; the poll is the arbiter."""
        kind, data, at = message["eventType"], message.get("eventData", {}), utc_now()
        if kind == "StreamStateChanged" and data.get("outputState") in (
            "OBS_WEBSOCKET_OUTPUT_STARTED",
            "OBS_WEBSOCKET_OUTPUT_STOPPED",
        ):
            self._stream(bool(data["outputActive"]), at, observed=True, by="event")
        elif kind == "InputActiveStateChanged" and data.get("inputName") in self.states:
            name = data["inputName"]
            self._transition(name, self.states[name].source(bool(data["videoActive"]), at), "event", at)
        elif kind == "CurrentProgramSceneChanged":
            self.record("scene", scene=data.get("sceneName"))

    def poll(self, obs: Obs, first: bool = False) -> None:
        """Ask OBS directly. Where the poll and the events disagree, the poll wins and it is written down."""
        live = bool(obs.request("GetStreamStatus")["outputActive"])
        at = utc_now()
        if live != self.live:
            if not first:
                self._disagree(live=live)
            self._stream(live, at, observed=not first, by="poll")
        for name, state in self.states.items():
            active = bool(obs.request("GetSourceActive", {"sourceName": name})["videoActive"])
            disagreed, change = state.poll(live, active, at)
            if disagreed and not first:
                self._disagree(source=name, live=live, active=active)
            self._transition(name, change, "poll", at)

    def _disagree(self, **fields: Any) -> None:
        self.disagreements += 1
        self.record("disagreement", **fields)

    def end(self) -> None:
        """Close the session. An interval still open is left open: the log says what it saw."""
        still_open = {name: state.since for name, state in self.states.items() if state.since}
        self.record("end", open=still_open, disagreements=self.disagreements)


def follow(obs: Obs, session: Session, poll_every: float = 2.0, polls: int | None = None,
           stop: Callable[[], bool] | None = None) -> None:
    """
    Take the first reading, then events as they arrive and a poll whenever it
    is quiet. `polls` bounds the loop for tests; live it runs until interrupted.
    """
    session.begin(obs)
    listen(obs, session, poll_every, polls, stop)


def listen(obs: Obs, session: Session, poll_every: float = 2.0, polls: int | None = None,
           stop: Callable[[], bool] | None = None) -> None:
    """
    The loop after the first reading. `stop` is asked once a turn, so a logger
    run from the server ends within one poll of being told to. Ending the
    session is the caller's, as it is for the CLI's Ctrl+C.
    """
    count = 0
    while (polls is None or count < polls) and not (stop is not None and stop()):
        event = obs.next_event(poll_every)
        if event is not None:
            session.event(event)
        else:
            session.poll(obs)
            count += 1


def offset_seconds(start: str | None, at: str) -> float | None:
    """Seconds from the stream's start to this moment, or None when the start was never seen."""
    if start is None:
        return None
    return round((datetime.fromisoformat(at) - datetime.fromisoformat(start)).total_seconds(), 3)


@dataclass(frozen=True)
class Interval:
    """One stretch of one placement being on air, as a time and as a place in the recording."""

    source: str
    start: str
    end: str
    seconds: float
    #: Seconds from the stream's start, for finding it in the VOD. None when unknown.
    offset_seconds: float | None


@dataclass(frozen=True)
class PlacementTotal:
    """What one placement adds up to."""

    source: str
    total_seconds: float
    intervals: int
    #: An interval the log never saw end, because the logger stopped first.
    open_since: str | None


@dataclass(frozen=True)
class Delivery:
    """What a log adds up to. The input to a delivery report, and to nothing else."""

    deal_id: str
    sources: list[str]
    #: Every interval of every placement, in the order they began.
    intervals: list[Interval]
    placements: list[PlacementTotal]
    #: Time with at least one placement on air. Two up at once are not counted twice.
    total_seconds: float
    #: Polls that contradicted the events. A report that hides these is worth less.
    disagreements: int
    #: The earliest interval the log never saw end.
    open_since: str | None
    stream_started_at: str | None
    start_observed: bool

    def to_json(self) -> dict[str, Any]:
        """The shape a delivery report embeds, and the app reads."""
        return {
            "deal": self.deal_id,
            "sources": self.sources,
            "streamStartedAt": self.stream_started_at,
            "startObserved": self.start_observed,
            "intervals": [
                {"source": i.source, "start": i.start, "end": i.end, "seconds": i.seconds,
                 "streamOffsetSeconds": i.offset_seconds}
                for i in self.intervals
            ],
            "placements": [
                {"source": p.source, "totalSeconds": round(p.total_seconds, 3), "intervals": p.intervals,
                 "openSince": p.open_since}
                for p in self.placements
            ],
            "totalSeconds": round(self.total_seconds, 3),
            "disagreements": self.disagreements,
            "openSince": self.open_since,
        }


def read_log(path: Path) -> list[dict[str, Any]]:
    """Every line of a log, skipping any that is not JSON rather than refusing the file."""
    if not path.exists():
        return []
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            lines.append(json.loads(raw))
        except ValueError:
            continue
    return lines


def delivery(lines: Iterable[dict[str, Any]]) -> Delivery:
    """
    Fold a log into the intervals it records. Pure, and the only reader of the
    log's shape, so a delivery report and the app cannot count differently.
    """
    state = _Fold()
    for line in lines:
        state.take(line)
    return state.done()


def union_seconds(intervals: Iterable[Interval]) -> float:
    """Seconds covered by at least one interval: overlapping placements are counted once."""
    spans = sorted((datetime.fromisoformat(i.start), datetime.fromisoformat(i.end)) for i in intervals)
    total, reach = 0.0, None
    for start, end in spans:
        if reach is None or start > reach:
            total += (end - start).total_seconds()
            reach = end
        elif end > reach:
            total += (end - reach).total_seconds()
            reach = end
    return round(total, 3)


@dataclass
class _Fold:
    deal_id: str = ""
    sources: list[str] = field(default_factory=list)
    stream_started_at: str | None = None
    start_observed: bool = False
    disagreements: int = 0
    open: dict[str, str] = field(default_factory=dict)
    #: Per source, the earliest interval a run left open and a later run began over.
    unclosed: dict[str, str] = field(default_factory=dict)
    intervals: list[Interval] = field(default_factory=list)

    def take(self, line: dict[str, Any]) -> None:
        kind = line.get("kind")
        self.deal_id = self.deal_id or str(line.get("deal", ""))
        if kind == "session":
            # A log from before placements names one `source`; a newer one lists `sources`.
            for name in line.get("sources") or [line.get("source", "")]:
                self._know(str(name))
        elif kind == "stream" and line.get("live"):
            self.stream_started_at = str(line.get("at"))
            self.start_observed = bool(line.get("startObserved"))
        elif kind == "disagreement":
            self.disagreements += 1
        elif kind == "onair":
            self._onair(line)

    def _know(self, source: str) -> str:
        if source and source not in self.sources:
            self.sources.append(source)
        return source

    def _onair(self, line: dict[str, Any]) -> None:
        source = self._know(str(line.get("source") or (self.sources[0] if self.sources else "")))
        at = str(line.get("at_") or line.get("at"))
        if line.get("state") == "start":
            if source in self.open:
                # A run stopped with this placement up, and the next began with
                # it up again. Nobody saw the first interval end, so it stays
                # reported as open rather than being written over.
                self.unclosed.setdefault(source, self.open[source])
            self.open[source] = at
        elif line.get("state") == "end" and source in self.open:
            began = self.open.pop(source)
            seconds = (datetime.fromisoformat(at) - datetime.fromisoformat(began)).total_seconds()
            offset = offset_seconds(self.stream_started_at, began) if self.start_observed else None
            self.intervals.append(Interval(source, began, at, round(seconds, 3), offset))

    def _open_since(self, source: str) -> str | None:
        return min(filter(None, (self.unclosed.get(source), self.open.get(source))), default=None)

    def done(self) -> Delivery:
        ordered = sorted(self.intervals, key=lambda i: i.start)
        still_open = list(filter(None, (self._open_since(name) for name in {*self.open, *self.unclosed})))
        placements = [
            PlacementTotal(
                source=name,
                total_seconds=sum(i.seconds for i in ordered if i.source == name),
                intervals=sum(1 for i in ordered if i.source == name),
                open_since=self._open_since(name),
            )
            for name in self.sources
        ]
        return Delivery(
            deal_id=self.deal_id,
            sources=list(self.sources),
            intervals=ordered,
            placements=placements,
            total_seconds=union_seconds(ordered),
            disagreements=self.disagreements,
            open_since=min(still_open, default=None),
            stream_started_at=self.stream_started_at,
            start_observed=self.start_observed,
        )
