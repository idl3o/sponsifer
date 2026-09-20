"""Put a deal's placements into OBS, so nothing is copied and pasted by hand.

A streamer builds their scenes once: the emblem in the gameplay scene, the card
in the break scene. So this does not make a new set of sources per sponsor. It
creates the conventional sources that are missing, and points the ones that
exist at this deal. The scene layout stays the streamer's; the sponsor is what
changes.

What it will and will not do:

- **Only on an explicit request**, and only to the four conventional sources.
- **It creates hidden.** A new source goes into the scene that is on screen,
  switched off, at the canvas size. Nothing appears on stream that the streamer
  did not show.
- **It never removes, shows, hides or moves anything**, and it leaves alone a
  source whose address is already this server's, for this deal and this kind.
  An address that shows the right deal from somewhere else is still re-pointed:
  the first real OBS this met had a source aimed at a port nothing served any more.
- **Something else wearing a conventional name is never touched.** An image
  called "Sponsor overlay" is reported as in the way, not overwritten.
- **Never while the logger runs.** The log has already written down what each
  source was showing; `runner.with_obs` refuses, and this module never connects
  on its own.
- **The address is built here, from the server's own port**, never taken from a
  request, so the app cannot be used to make OBS load a page of someone's choosing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import parse_qs, urlsplit

from .obs import Obs
from .onair import PLACEMENT_KINDS, deal_shown

BROWSER_SOURCE = "browser_source"

Action = Literal["create", "repoint", "keep", "blocked"]


def overlay_url(port: int, deal_id: str, kind: str | None) -> str:
    """The overlay's address, as `overlayUrl` in src/domain/overlay.ts builds it for the same server."""
    return f"http://127.0.0.1:{port}/overlay.html?deal={deal_id}" + (f"&kind={kind}" if kind else "")


@dataclass(frozen=True, slots=True)
class Step:
    """What was done about one placement's source."""

    source: str
    action: Action
    #: The deal it was showing before, when it was pointed elsewhere.
    was: str | None = None


@dataclass(frozen=True, slots=True)
class Result:
    deal: str
    #: The scene new sources were added to: the one on screen at the time.
    scene: str
    steps: tuple[Step, ...]

    def to_json(self) -> dict[str, Any]:
        return {"deal": self.deal, "scene": self.scene,
                "steps": [{"source": s.source, "action": s.action, "was": s.was} for s in self.steps]}


def _already_right(url: str | None, port: int, deal_id: str, kind: str | None) -> bool:
    """True when the address is this server's own, for this deal and this kind. `localhost` is this server too."""
    if not url:
        return False
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    return (parts.hostname in ("127.0.0.1", "localhost") and parts.port == port and parts.path == "/overlay.html"
            and query.get("deal", [""])[0] == deal_id and (query.get("kind", [None])[0] or None) == kind)


def _decide(obs: Obs, source: str, kind_in_obs: str | None, port: int, deal_id: str) -> Step:
    """Read-only: what this source needs."""
    if kind_in_obs is None:
        return Step(source, "create")
    if kind_in_obs != BROWSER_SOURCE:
        return Step(source, "blocked")
    url = obs.request("GetInputSettings", {"inputName": source}).get("inputSettings", {}).get("url")
    if _already_right(url, port, deal_id, PLACEMENT_KINDS[source]):
        return Step(source, "keep")
    showing = deal_shown(url)
    return Step(source, "repoint", was=showing if showing != deal_id else None)


def setup(obs: Obs, port: int, deal_id: str) -> Result:
    """Make OBS show this deal in every conventional source, and say what that took."""
    inputs = obs.request("GetInputList").get("inputs") or []
    kinds = {item.get("inputName"): item.get("unversionedInputKind") or item.get("inputKind") for item in inputs}
    scene = str(obs.request("GetCurrentProgramScene").get("currentProgramSceneName", ""))
    steps = tuple(_decide(obs, source, kinds.get(source), port, deal_id) for source in PLACEMENT_KINDS)

    video: dict[str, Any] | None = None
    for step in steps:
        url = overlay_url(port, deal_id, PLACEMENT_KINDS[step.source])
        if step.action == "repoint":
            obs.request("SetInputSettings", {"inputName": step.source, "inputSettings": {"url": url}, "overlay": True})
        elif step.action == "create":
            video = video or obs.request("GetVideoSettings")
            settings = {"url": url, "width": int(video.get("baseWidth", 1920)), "height": int(video.get("baseHeight", 1080))}
            obs.request("CreateInput", {"sceneName": scene, "inputName": step.source, "inputKind": BROWSER_SOURCE,
                                        "inputSettings": settings, "sceneItemEnabled": False})
    return Result(deal_id, scene, steps)
