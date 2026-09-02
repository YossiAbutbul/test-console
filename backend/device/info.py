"""Meter information — the read-only "what is this unit" queries.

A different opcode family from the test commands: those all end ``\\x50``,
these are ``00 xx`` and ``10 xx``. There is no spec for them here, so every
layout below was read off a capture of the vendor tool's Meter Information
dialog and the sample bytes are kept in the docstrings — they are the only
evidence for these formats, and `test_meter_info.py` asserts against exactly
those bytes.

Reply shape is the usual one::

    [opcode:2][len:2 LE][status:1][data:len]

with `len` counting the data *after* the status byte, which is why
`parse_frame` folds the trailing byte back in and `payload[1:]` is the data.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Callable, Optional

from ..protocol import pack_frame

# --- opcodes ---------------------------------------------------------------

OPCODE_VERSION = b"\x02\x00"
OPCODE_FW_VERSION = b"\x04\x00"
OPCODE_DEVICE_ID = b"\x18\x00"
OPCODE_TIME_UTC = b"\x40\x00"
OPCODE_TIME_LOCAL = b"\x44\x00"
OPCODE_BLE_MAC = b"\x20\x10"
OPCODE_APP_MODE = b"\x44\x10"
OPCODE_SET_APP_MODE = b"\x45\x10"
# Note the direction: 4D reads, 4C writes. The opposite way round to the app
# mode pair above (44 reads, 45 writes), so do not "fix" one to match the
# other -- both are as the vendor tool sends them.
OPCODE_CHANNELS = b"\x4d\x10"
OPCODE_SET_CHANNELS = b"\x4c\x10"
OPCODE_RADIO = b"\x78\x10"

# Save-and-reset. Not part of any read -- it is what makes a channel change
# stick: `4C 10` alone stages the pair, and without it the meter comes back on
# the old channels. Sent as `00 21 01 00 05`; the 05 is the one payload byte
# the vendor tool uses and its meaning is not known, so it is a constant here
# rather than a parameter.
OPCODE_SAVE_RESET = b"\x00\x21"
SAVE_RESET_ARG = 0x05

# Unidentified. Briefly taken for the app mode, because its two bytes read
# big-endian gave 4 on the capture unit -- a plausible-looking mode number.
# It is not: the app mode is `44 10`, and reads 0 for Development on those
# same captures.
#
# What it does track is unclear, but it is not fixed per unit. One meter
# (device id 70B3D5A9F131608C) answered `00 04` while advertising as
# "Sonata 2 LoRa" and `00 06` after coming back as "Sonata2US", same firmware
# -- so it follows something regional or variant-ish. Kept so the opcode is
# not rediscovered from scratch, and deliberately not queried.
OPCODE_UNKNOWN_9D = b"\x9d\x00"

# One byte, 0-6. Get with `44 10`, set with `45 10` -- the usual get/set pair
# one opcode apart. Names as the vendor tool lists them.
APP_MODES = {
    0: "Development",
    1: "ATE Tester",
    2: "Production",
    3: "Storage",
    4: "Deployment",
    5: "RF Test",
    6: "Test",
}

# The two radio roles. Read together from `4D 10`, written together with
# `4C 10` -- one byte each, in this order. Names kept exactly as the firmware
# spells them: they read as constants rather than prose, and matching the
# other tool's wording is worth more here than tidier capitalisation.
PRIMARY_CHANNELS = {
    0: "NONE_PRIMARY",
    1: "CATM_PRIMARY",
    2: "LORA_FIXED_PRIMARY",
}
SECONDARY_CHANNELS = {
    0: "NONE_SECONDARY",
    1: "LORA_DRIVEBY_SECONDARY",
    2: "OMS_SECONDARY",
}


# --- decoders --------------------------------------------------------------
#
# Each takes the data bytes (status already stripped) and returns the string
# the UI shows. They raise ValueError on a short reply; the caller turns that
# into a failed field rather than letting it sink the whole read.


def _need(data: bytes, n: int, what: str) -> None:
    if len(data) < n:
        raise ValueError(f"{what}: need {n} bytes, got {len(data)}")


def decode_version(data: bytes) -> str:
    """Three uint16 LE. ``39 00 01 00 02 00`` -> ``57.1.2``."""
    _need(data, 6, "version")
    major, minor, patch = struct.unpack_from("<HHH", data, 0)
    return f"{major}.{minor}.{patch}"


def decode_fw_version(data: bytes) -> str:
    """Plain ASCII. ``35 37 2e 31 2e 32 2e 39`` -> ``57.1.2.9``."""
    _need(data, 1, "fw version")
    return data.decode("ascii", errors="replace").rstrip("\x00").strip()


def decode_device_id(data: bytes) -> str:
    """Eight bytes, little-endian.

    ``8c 60 31 f1 a9 d5 b3 70`` -> ``70B3D5A9F131608C``, which is the EUI-64
    the vendor dialog prints.
    """
    _need(data, 8, "device id")
    return data[:8][::-1].hex().upper()


def decode_ble_mac(data: bytes) -> str:
    """Six bytes little-endian, then two bytes of padding.

    ``8c 60 31 f1 a9 d5 00 00`` -> ``D5:A9:F1:31:60:8C``. The padding is
    ignored rather than trusted: only the first six carried the address in
    the capture, and the declared length was 8 either way.
    """
    _need(data, 6, "ble mac")
    return ":".join(f"{b:02X}" for b in data[:6][::-1])


def decode_time(data: bytes) -> str:
    """``[sec, min, hour, weekday, day, month, year-2000]``.

    ``03 31 01 01 1b 07 1a`` -> ``2026-07-27 01:49:03``. The weekday byte is
    dropped: it was 1 for 2026-07-27, a Monday, so it agrees with the date
    and carries nothing the date does not.

    Formatted ISO-style rather than the vendor's DD-MM-YY. Units come back
    with unset clocks reading ``07-01-00``, and in that form there is no way
    to tell a day from a year at a glance; ``2000-01-07`` reads the same to
    everyone. The same layout answers both the local and the UTC opcode --
    only the hour differed.
    """
    _need(data, 7, "time")
    sec, minute, hour, _weekday, day, month, year = data[:7]
    return f"20{year:02d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{sec:02d}"


def decode_app_mode(data: bytes) -> str:
    """One byte, 0-6. ``00`` -> ``Development``.

    Both captures answer `44 10` with ``00`` and both dialogs printed
    DEVELOPMENT, which is what fixes 0 as the first entry of the list.
    An unrecognised value keeps its number rather than being forced onto a
    name, so firmware that grows an eighth mode says so instead of lying.
    """
    _need(data, 1, "app mode")
    return APP_MODES.get(data[0], f"Unknown ({data[0]})")


def decode_primary_channel(data: bytes) -> str:
    """First byte of the `4D 10` reply. ``02`` -> ``LORA_FIXED_PRIMARY``."""
    _need(data, 1, "primary channel")
    return PRIMARY_CHANNELS.get(data[0], f"Unknown ({data[0]})")


def decode_secondary_channel(data: bytes) -> str:
    """Second byte of the `4D 10` reply. ``01`` -> ``LORA_DRIVEBY_SECONDARY``.

    Both channels come back in one reply, in the order the setter takes them.
    Confirmed against a capture: `4D 10 02 00 00 02 01` was reported as
    LORA_FIXED_PRIMARY + LORA_DRIVEBY_SECONDARY, so primary is first.
    """
    _need(data, 2, "secondary channel")
    return SECONDARY_CHANNELS.get(data[1], f"Unknown ({data[1]})")


def encode_set_channels(primary: int, secondary: int) -> bytes:
    """The frame that sets both channels: ``4C 10 02 00 <primary> <secondary>``.

    Both travel together because the command takes both -- there is no way to
    change one without restating the other, so the caller always sends the
    pair it wants to end up with.
    """
    if primary not in PRIMARY_CHANNELS:
        raise ValueError(f"unknown primary channel: {primary}")
    if secondary not in SECONDARY_CHANNELS:
        raise ValueError(f"unknown secondary channel: {secondary}")
    return pack_frame(OPCODE_SET_CHANNELS, bytes([primary, secondary]))


def encode_save_and_reset() -> bytes:
    """``00 21 01 00 05`` -- persist the staged settings and reboot.

    The reply (`00 21 00 00 00`) comes back before the meter goes down, so a
    success here is real. What follows it is not a failure: the BLE link drops
    and stays down until something reconnects.
    """
    return pack_frame(OPCODE_SAVE_RESET, bytes([SAVE_RESET_ARG]))


def encode_set_app_mode(mode: int) -> bytes:
    """The frame that changes the mode: ``45 10 01 00 0X``.

    Raises on a mode outside the known list. This is a write to a live meter
    that reboots it, so a typo should not reach the wire and set something the
    firmware happens to accept.
    """
    if mode not in APP_MODES:
        raise ValueError(f"unknown app mode: {mode}")
    return pack_frame(OPCODE_SET_APP_MODE, bytes([mode]))


def decode_radio(data: bytes) -> str:
    """Never succeeded in the capture — the unit answered status 1.

    Kept so a unit that does support it shows something rather than nothing;
    the layout is unknown, so the bytes are printed as-is.
    """
    if not data:
        return "—"
    return data.hex(" ").upper()


# --- the read list ---------------------------------------------------------


@dataclass(frozen=True)
class InfoOutput:
    """One displayed field, read out of some query's reply.

    `label` lives here rather than in the frontend because it is 1:1 with the
    opcode: adding a field should mean touching this list only. The modal
    composes its rows from these keys — see `MeterInfoModal.tsx`.
    """

    key: str
    label: str
    decode: Callable[[bytes], str]


@dataclass(frozen=True)
class InfoQuery:
    """One opcode, and every field its reply carries.

    A list of outputs rather than one, because `4D 10` answers with the
    primary and secondary channel in a single reply. Two queries sharing an
    opcode would have read the same two bytes over two BLE round trips.
    """

    opcode: bytes
    outputs: tuple[InfoOutput, ...]


# Order matches the capture, which is also the order the dialog fills in.
#
# Radio and both clocks are deliberately absent. The vendor dialog shows them;
# this console does not, so querying them would be three extra BLE round trips
# per open for values nothing renders. Their opcodes and decoders are kept
# above, tested, and documented -- putting any of them back is one line here.
INFO_QUERIES: tuple[InfoQuery, ...] = (
    InfoQuery(OPCODE_FW_VERSION, (
        InfoOutput("fw_version", "FW Version", decode_fw_version),
    )),
    InfoQuery(OPCODE_VERSION, (
        InfoOutput("version", "Version", decode_version),
    )),
    InfoQuery(OPCODE_DEVICE_ID, (
        InfoOutput("device_id", "Device ID", decode_device_id),
    )),
    InfoQuery(OPCODE_APP_MODE, (
        InfoOutput("app_mode", "App Mode", decode_app_mode),
    )),
    InfoQuery(OPCODE_BLE_MAC, (
        InfoOutput("ble_mac", "MAC Address", decode_ble_mac),
    )),
    InfoQuery(OPCODE_CHANNELS, (
        InfoOutput("primary_channel", "Primary Channel", decode_primary_channel),
        InfoOutput("secondary_channel", "Secondary Channel", decode_secondary_channel),
    )),
)


@dataclass
class InfoField:
    """One row's worth of answer.

    `raw_hex` is carried even when decoding succeeded. These layouts came off
    a single capture, so a value that looks wrong on the bench needs the bytes
    next to it to be worth anything.
    """

    key: str
    label: str
    ok: bool
    status: int
    raw_hex: str
    value: Optional[str]
    error: Optional[str] = None


@dataclass
class AppModeWrite:
    """The outcome of a mode change.

    `acknowledged` and `ok` are separate on purpose. The unit is reported to
    save the mode and immediately reset, so a write that gets no reply is not
    evidence it failed -- the link may simply have gone down underneath the
    answer. Only a reply with status 0 is a confirmed success; anything else
    is reported as what it is and left for the operator to re-read.
    """

    mode: int
    label: str
    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None


@dataclass
class ChannelsWrite:
    """The outcome of a channel change.

    Same three-way shape as `AppModeWrite`: whether the unit answered is a
    separate question from whether it agreed. Unknown here whether this write
    resets the meter the way an app-mode change does, so a missing reply is
    left ambiguous rather than assumed either way.
    """

    primary: int
    secondary: int
    primary_label: str
    secondary_label: str
    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None


@dataclass
class WriteOutcome:
    """A write with no payload worth reporting back -- just how it went.

    Same three-way shape as the other two: `acknowledged` says the unit
    answered, `ok` says it agreed. For save-and-reset the reply arrives before
    the reboot, so an unanswered one is genuinely doubtful rather than routine.
    """

    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None
