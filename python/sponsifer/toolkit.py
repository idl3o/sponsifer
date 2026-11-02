"""The commands that look at OBS or ask the app's server, and log nothing.

    status     what OBS has, what is in the program feed, what is on air
    setup      put a won deal's placements into OBS, through the running server
    overlay    the overlay addresses to paste, beside the names OBS must give them
    dock       the dock's address

Each prints for a person and returns an exit code; `cli.py` parses the command
line and checks the deal. `open_obs` is also how `sponsifer log` connects.
"""

from __future__ import annotations

import getpass
import os
import sys
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from . import client
from .obs import NEEDS_PASSWORD, Obs
from .obs_setup import overlay_url
from .onair import PLACEMENT_KINDS

#: The port `sponsifer app` serves on unless told otherwise.
APP_PORT = 5180

_RUNNING = "They load from the app's server, so `sponsifer app` must be running while you stream."


def sentence(text: object) -> str:
    """A message as a sentence: a full stop added unless it already ends in one."""
    words = str(text)
    return words if words.endswith((".", "?", "!")) else f"{words}."


def _password() -> str:
    """OBS's WebSocket password, from the environment or asked for. Called only when OBS asks."""
    return os.environ.get("OBS_WEBSOCKET_PASSWORD") or getpass.getpass("OBS asks for its WebSocket password: ")


@contextmanager
def open_obs(url: str, on_event: Callable[[dict[str, Any]], None]) -> Iterator[Obs]:
    """
    An identified connection to OBS. The password is asked for only when OBS
    asks, answers its challenge once, and is not kept. Raises RuntimeError
    with words for the creator when OBS cannot be reached or refuses.
    """
    from websockets.exceptions import WebSocketException
    from websockets.sync.client import connect

    password: str | None = None
    while True:
        try:
            socket = connect(url, open_timeout=5)
        except (OSError, WebSocketException) as error:
            raise RuntimeError(f"OBS is not answering at {url}. Is its WebSocket server switched on, under Tools?") from error
        with socket:
            obs = Obs(socket, on_event)
            try:
                obs.identify(password)
            except RuntimeError as error:
                if str(error) != NEEDS_PASSWORD or password is not None:
                    raise
                password = _password()
                continue
            except (OSError, WebSocketException) as error:
                # OBS answers a wrong password by closing the socket, not with a message.
                raise RuntimeError("OBS did not accept that password" if password else "OBS closed the connection") from error
            password = None
            yield obs
            return


def status(url: str, names: list[str]) -> int:
    """Say what OBS has and what is on air. Writes nothing and takes no lock."""
    from websockets.exceptions import WebSocketException

    from .status import lines, look, served

    try:
        with open_obs(url, lambda event: None) as obs:
            view = look(obs, names, served)
    except (RuntimeError, OSError, WebSocketException) as error:
        print(sentence(error), file=sys.stderr)
        return 1
    print("\n".join(lines(view)))
    return 0


def setup(port: int, deal_id: str) -> int:
    """Put a won deal into OBS through the running server, which keeps every rule about it."""
    try:
        reply = client.setup(port, deal_id, _password)
    except client.NoServer as error:
        print(f"Not done: {error}. Start `sponsifer app` first; the sources it makes load their overlays from it.",
              file=sys.stderr)
        return 1
    if reply.status != 200:
        print(sentence(f"Not done: {reply.error}"), file=sys.stderr)
        return 1
    print(f"Put {deal_id} into OBS:")
    print("\n".join(client.setup_lines(reply.body)))
    return 0


def overlay(port: int, deal_id: str) -> int:
    """The overlay addresses for a won deal, by the source name the logger looks for."""
    width = max(len(name) for name in PLACEMENT_KINDS)
    print(f"Add each to OBS as a browser source with the name shown, or run `sponsifer setup {deal_id}` to do it for you.")
    for name, kind in PLACEMENT_KINDS.items():
        print(f"  {name.ljust(width)}  {overlay_url(port, deal_id, kind)}")
    print("The names matter: the logger finds each placement by its name and by nothing else.")
    print(_RUNNING)
    return 0


def dock(port: int) -> int:
    """Where the dock is, and where in OBS it goes. OBS has no request that adds a dock."""
    print("In OBS: Docks, Custom Browser Docks. Name it Sponsifer and paste this address:")
    print(f"  http://127.0.0.1:{port}/dock.html")
    print("It loads from the app's server, so `sponsifer app` must be running.")
    return 0
