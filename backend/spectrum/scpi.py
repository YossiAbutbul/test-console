"""Line-oriented SCPI over a raw TCP socket.

The FSC3 is reached over LAN, not VISA: its USB port enumerates as CDC class
02/02 with protocol 0xFF and no Union descriptor, so Windows binds the generic
usbser.sys, which cannot drive it (CreateFile succeeds, SetCommState fails with
ERROR_GEN_FAILURE). USB needs the R&S driver that ships with InstrumentView;
LAN avoids the problem entirely.
"""

import socket
import threading


class Scpi:
    def __init__(self, host: str, port: int = 5555, timeout: float = 6.0) -> None:
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.buf = b""
        self.lock = threading.Lock()
        self.host, self.port = host, port

    def write(self, cmd: str) -> None:
        with self.lock:
            self.sock.sendall(cmd.encode() + b"\n")

    def query(self, cmd: str, timeout: float = 6.0) -> str:
        with self.lock:
            self.sock.settimeout(timeout)
            self.sock.sendall(cmd.encode() + b"\n")
            while b"\n" not in self.buf:
                chunk = self.sock.recv(262144)
                if not chunk:
                    raise ConnectionError("instrument closed the connection")
                self.buf += chunk
            line, _, self.buf = self.buf.partition(b"\n")
            return line.decode("latin-1").strip()

    def error(self) -> str | None:
        """Return an error string, or None when the error queue is clean."""
        e = self.query("SYST:ERR?")
        return None if e.startswith("0,") else e

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass
