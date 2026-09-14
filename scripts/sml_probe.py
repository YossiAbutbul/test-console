"""Find the link settings an RS-232 instrument is actually listening on.

An open COM port that answers nothing says almost nothing by itself: the baud
rate could be wrong, the handshake could be waiting on a line the cable does not
carry, or the port could be the wrong one entirely. This tries the combinations
and reports which, if any, produced bytes.

    .venv\\Scripts\\python.exe scripts\\sml_probe.py COM6 COM7

Two things worth reading in the output even when nothing answers:

  CTS/DSR after open
      These are the instrument's RTS and DTR arriving through the cable. A
      powered instrument on a full null-modem cable holds them high. Both low
      on every port means the handshake lines are not getting through -- a
      3-wire cable, a straight-through cable, or nothing on the far end -- and
      an instrument set to an RTS/CTS handshake will never transmit into that.

  Which combination replied
      Set the app's baud to match. If only the XON/XOFF or RTS/CTS rows answer,
      the instrument's handshake is set to that under Utilities-System-RS232.

Opens each port briefly. Do not point it at the Arduino: opening that port
pulses DTR and resets the sketch.
"""
from __future__ import annotations

import sys
import time

import serial
from serial.tools import list_ports

#: 9600 first -- it is the manual's own example, so it is the likeliest.
BAUDS = [9600, 19200, 38400, 57600, 115200, 4800, 2400, 1200]

#: pyserial keyword per handshake the SML offers in Utilities-System-RS232.
FLOWS = {
    "none": {},
    "rts/cts": {"rtscts": True},
    "xon/xoff": {"xonxoff": True},
}

#: <CR><LF>, per the SML manual's table of RS-232 control characters. A device
#: expecting only <LF> still sees one; the stray <CR> is harmless.
QUERY = b"*IDN?\r\n"

#: How long to wait for the first byte of a reply. Generous: this runs once.
LISTEN_S = 0.8


def describe_ports() -> None:
    print("Ports on this machine:")
    for p in list_ports.comports():
        usb = f"VID:PID={p.vid:04X}:{p.pid:04X}" if p.vid else "not USB"
        print(f"  {p.device:6} {p.description}  [{usb}  {p.serial_number or ''}]")
    print()


def probe(port: str) -> bool:
    """Try every baud x handshake on `port`. True if anything ever answered."""
    print(f"=== {port}")
    answered = False
    lines_shown = False

    for baud in BAUDS:
        for name, kwargs in FLOWS.items():
            try:
                s = serial.Serial(
                    port=port, baudrate=baud, bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE,
                    timeout=LISTEN_S, write_timeout=1.0, **kwargs,
                )
            except Exception as e:
                print(f"  cannot open: {e}")
                return False

            try:
                # Once per port: the modem lines do not depend on baud rate,
                # and they are the one reading that says something about the
                # cable rather than about the settings.
                if not lines_shown:
                    time.sleep(0.2)
                    print(f"  lines after open: CTS={s.cts}  DSR={s.dsr}  CD={s.cd}  RI={s.ri}")
                    lines_shown = True

                time.sleep(0.15)          # let the adapter settle before asking
                s.reset_input_buffer()
                s.write(QUERY)
                s.flush()
                reply = s.read(200)
                if reply:
                    answered = True
                    print(f"  {baud:>6} {name:<9} -> {reply!r}")
            except Exception as e:
                print(f"  {baud:>6} {name:<9} !! {e}")
            finally:
                try:
                    s.close()
                except Exception:
                    pass

    if not answered:
        print("  nothing answered on any baud rate or handshake")
    return answered


def main(argv: list[str]) -> int:
    describe_ports()
    ports = argv[1:]
    if not ports:
        print("Name the ports to probe, e.g.:  python scripts/sml_probe.py COM6 COM7")
        return 2

    any_reply = False
    for port in ports:
        any_reply |= probe(port)
        print()

    if not any_reply:
        print("No port replied. In order of likelihood:")
        print("  1. The instrument's handshake is RTS/CTS but the cable has no")
        print("     handshake lines -- check the CTS/DSR reading above.")
        print("  2. The cable is straight-through where a null modem is needed")
        print("     (TxD/RxD, DTR/DSR and RTS/CTS must be cross-connected).")
        print("  3. Neither port is the one the instrument is plugged into.")
        print("  4. The instrument is set to a rate outside the list tried here.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
