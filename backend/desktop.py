"""Entry point for the frozen desktop build.

`uvicorn backend.main:app` is still the way to run this on the rig. That
command needs a shell, a venv and someone who knows the incantation, none of
which exist on the PC of somebody who was handed a zip. This wraps the same app
in the three things that turns it into a double-clickable program: pick a port
that is free, start the server, point a browser at it.

Deliberately not a GUI. The console window this opens in is the app's only
visible sign of life and its stop button -- closing it stops the server, which
is the behaviour the shutdown hook in main.py wants (it runs on a graceful stop
and is skipped by a force-kill).
"""

from __future__ import annotations

import socket
import sys
import threading
import time
import webbrowser

import uvicorn

# Absolute, and the app imported as an *object* rather than named in the
# "backend.main:app" string uvicorn would otherwise resolve itself. A string is
# a runtime import: PyInstaller cannot see it, leaves the whole backend package
# out of the bundle, and the exe dies on launch with "No module named backend".
# Importing it here is the same fact written where the build can follow it.
#
# Absolute rather than relative because this module is the frozen entry point
# and so runs as __main__ with no package of its own. From a source checkout
# that means `python -m backend.desktop`, not `python backend/desktop.py`.
from backend.main import app

#: Tried first so the usual case gets the usual URL, and so a second launch is
#: noticed rather than silently becoming a second server on a random port.
PREFERRED_PORT = 8000
HOST = "127.0.0.1"


def _free_port() -> int:
    """A port nothing else is on.

    The preferred one if it is free, otherwise whatever the OS hands out. The
    fallback matters more here than on the rig: this runs on machines we know
    nothing about, and 8000 is a popular port. Binding it blindly would make
    the app fail to start on someone's dev box for a reason the console window
    would show and nobody would read.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, PREFERRED_PORT))
            return PREFERRED_PORT
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return int(s.getsockname()[1])


def _open_when_up(url: str, server: uvicorn.Server, timeout_s: float = 20.0) -> None:
    """Open the browser once the server is actually answering.

    Opening it immediately races startup and lands on a connection error often
    enough to look broken. `server.started` is uvicorn's own signal that the
    socket is accepting, so this waits on that rather than on a guessed sleep.

    The timeout is a backstop, not a normal path: if the server never comes up
    the operator should be reading the error in this window, not looking at a
    browser tab that opened anyway and says the site refused to connect.
    """
    deadline = time.monotonic() + timeout_s
    while not server.started:
        if time.monotonic() > deadline:
            return
        time.sleep(0.05)
    webbrowser.open(url)


def main() -> int:
    port = _free_port()
    url = f"http://{HOST}:{port}/"

    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        # No reload: it re-executes the interpreter, which a frozen build does
        # not survive, and there is nothing to reload in a bundle anyway.
        reload=False,
        log_config=None,  # main.py has already set the handlers up.
        # Long enough for the BLE link to be dropped properly on the way out,
        # short enough that closing the window does not feel hung.
        timeout_graceful_shutdown=3,
    )
    server = uvicorn.Server(config)

    threading.Thread(target=_open_when_up, args=(url, server), daemon=True).start()

    print(f"Test Console is running at {url}")
    print("Leave this window open. Close it to stop.")
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
