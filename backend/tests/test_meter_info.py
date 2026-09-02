"""Meter information decoding, pinned to the capture it was derived from.

There is no spec for these opcodes. The bytes below are the exact TX/RX pairs
logged from the vendor tool's Meter Information dialog, and the expected
values are what that dialog displayed for the same unit. That makes this file
the specification: if a layout in `device/info.py` is ever changed, this is
the evidence it has to keep agreeing with.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.device.device import Device
from backend.device.info import (
    APP_MODES, INFO_QUERIES, PRIMARY_CHANNELS, SECONDARY_CHANNELS,
    OPCODE_APP_MODE, OPCODE_BLE_MAC, OPCODE_CHANNELS, OPCODE_SET_CHANNELS,
    OPCODE_DEVICE_ID, OPCODE_FW_VERSION, OPCODE_RADIO, OPCODE_SET_APP_MODE,
    OPCODE_TIME_LOCAL, OPCODE_TIME_UTC, OPCODE_UNKNOWN_9D, OPCODE_VERSION,
    decode_app_mode, decode_ble_mac, decode_device_id, decode_fw_version,
    decode_primary_channel, decode_radio, decode_secondary_channel, decode_time,
    decode_version, encode_save_and_reset, encode_set_app_mode,
    encode_set_channels, OPCODE_SAVE_RESET, SAVE_RESET_ARG,
)
from backend.protocol import pack_frame, parse_frame

# Straight from the log, decimal exactly as it was printed.
TX_FRAMES = {
    OPCODE_FW_VERSION: [4, 0, 0, 0],
    OPCODE_VERSION: [2, 0, 0, 0],
    OPCODE_DEVICE_ID: [24, 0, 0, 0],
    OPCODE_TIME_LOCAL: [68, 0, 0, 0],
    OPCODE_TIME_UTC: [64, 0, 0, 0],
    OPCODE_APP_MODE: [68, 16, 0, 0],
    OPCODE_UNKNOWN_9D: [157, 0, 0, 0],
    OPCODE_BLE_MAC: [32, 16, 0, 0],
    OPCODE_RADIO: [120, 16, 0, 0],
}

RX_FW_VERSION = [4, 0, 8, 0, 0, 53, 55, 46, 49, 46, 50, 46, 57]
RX_VERSION = [2, 0, 6, 0, 0, 57, 0, 1, 0, 2, 0]
RX_DEVICE_ID = [24, 0, 8, 0, 0, 140, 96, 49, 241, 169, 213, 179, 112]
RX_TIME_LOCAL = [68, 0, 7, 0, 0, 3, 49, 1, 1, 27, 7, 26]
RX_TIME_UTC = [64, 0, 7, 0, 0, 3, 49, 8, 1, 27, 7, 26]
RX_APP_MODE = [68, 16, 1, 0, 0, 0]
RX_UNKNOWN_9D = [157, 0, 2, 0, 0, 0, 4]
RX_BLE_MAC = [32, 16, 8, 0, 0, 140, 96, 49, 241, 169, 213, 0, 0]
RX_RADIO = [120, 16, 0, 0, 1]


def data_of(rx: list[int]) -> bytes:
    """The decoder's input: payload past the status byte."""
    return parse_frame(bytes(rx)).payload[1:]


def status_of(rx: list[int]) -> int:
    return parse_frame(bytes(rx)).payload[0]


# --- the queries go out as captured ---------------------------------------


def query_keys() -> set[str]:
    return {o.key for q in INFO_QUERIES for o in q.outputs}


def test_every_query_is_an_empty_frame_matching_the_capture() -> None:
    for q in INFO_QUERIES:
        if q.opcode not in TX_FRAMES:
            continue  # channels: no capture of the getter, only the setter
        assert list(pack_frame(q.opcode, b"")) == TX_FRAMES[q.opcode], q.opcode.hex(" ")


def test_the_channels_query_goes_out_as_given() -> None:
    assert pack_frame(OPCODE_CHANNELS, b"").hex(" ") == "4d 10 00 00"


# --- and the replies decode to what the dialog showed ----------------------


def test_fw_version_string() -> None:
    assert decode_fw_version(data_of(RX_FW_VERSION)) == "57.1.2.9"


def test_version_triple() -> None:
    assert decode_version(data_of(RX_VERSION)) == "57.1.2"


def test_device_id_is_byte_reversed() -> None:
    assert decode_device_id(data_of(RX_DEVICE_ID)) == "70B3D5A9F131608C"


def test_ble_mac_takes_the_first_six_reversed() -> None:
    assert decode_ble_mac(data_of(RX_BLE_MAC)) == "D5:A9:F1:31:60:8C"


def test_mac_is_the_tail_of_the_device_id() -> None:
    # Not a protocol requirement, just true of this unit -- and the reason a
    # reversed-vs-not mistake in either decoder would be easy to miss.
    mac = decode_ble_mac(data_of(RX_BLE_MAC)).replace(":", "")
    assert decode_device_id(data_of(RX_DEVICE_ID)).endswith(mac)


def test_local_and_utc_time_differ_only_in_the_hour() -> None:
    assert decode_time(data_of(RX_TIME_LOCAL)) == "2026-07-27 01:49:03"
    assert decode_time(data_of(RX_TIME_UTC)) == "2026-07-27 08:49:03"


def test_unset_clock_is_unambiguous() -> None:
    # A unit with an unset RTC reads 2000-01-07. In the vendor's DD-MM-YY that
    # is "07-01-00", where day, month and year are all plausible readings of
    # each field -- the reason this is formatted ISO-style.
    assert decode_time(bytes([27, 17, 11, 5, 7, 1, 0])) == "2000-01-07 11:17:27"


def test_app_mode() -> None:
    # `44 10` answered 00 and both dialogs printed DEVELOPMENT.
    assert decode_app_mode(data_of(RX_APP_MODE)) == "Development"


def test_every_app_mode_has_a_name() -> None:
    assert [APP_MODES[m] for m in range(7)] == [
        "Development", "ATE Tester", "Production", "Storage",
        "Deployment", "RF Test", "Test",
    ]


def test_unknown_app_mode_keeps_its_number() -> None:
    assert decode_app_mode(bytes([0x63])) == "Unknown (99)"


def test_set_app_mode_frames() -> None:
    # `45 10 01 00 0X` -- the frame the vendor tool sends.
    for mode in APP_MODES:
        assert encode_set_app_mode(mode) == bytes([0x45, 0x10, 0x01, 0x00, mode])
    assert encode_set_app_mode(0).hex(" ") == "45 10 01 00 00"


def test_set_app_mode_refuses_an_unknown_mode() -> None:
    # This write reboots a live meter; a number the list does not know must
    # not reach the wire on the chance the firmware accepts it.
    for bad in (7, 99, -1):
        with pytest.raises(ValueError):
            encode_set_app_mode(bad)


def test_radio_was_declined_by_the_unit() -> None:
    # The one field the dialog printed "Not Supported" for.
    assert status_of(RX_RADIO) == 1
    assert decode_radio(data_of(RX_RADIO)) == "—"


def test_short_replies_raise_rather_than_return_junk() -> None:
    for decode in (decode_version, decode_device_id, decode_ble_mac, decode_time):
        with pytest.raises(ValueError):
            decode(b"\x01")


# --- and one bad field does not sink the read ------------------------------


class _CannedTransport:
    """Replies from the capture, keyed by the opcode that was sent."""

    def __init__(self, replies: dict[bytes, list[int]]) -> None:
        self._replies = replies
        self.sent: list[bytes] = []

    async def send(self, frame_bytes: bytes, timeout: float = 5.0):
        self.sent.append(frame_bytes)
        opcode = frame_bytes[0:2]
        if opcode not in self._replies:
            raise TimeoutError("no canned reply")
        return parse_frame(bytes(self._replies[opcode]))


ALL_REPLIES = {
    OPCODE_CHANNELS: [0x4D, 0x10, 0x02, 0x00, 0x00, 0x02, 0x01],
    OPCODE_FW_VERSION: RX_FW_VERSION,
    OPCODE_VERSION: RX_VERSION,
    OPCODE_DEVICE_ID: RX_DEVICE_ID,
    OPCODE_TIME_LOCAL: RX_TIME_LOCAL,
    OPCODE_TIME_UTC: RX_TIME_UTC,
    OPCODE_APP_MODE: RX_APP_MODE,
    OPCODE_UNKNOWN_9D: RX_UNKNOWN_9D,
    OPCODE_BLE_MAC: RX_BLE_MAC,
    OPCODE_RADIO: RX_RADIO,
}


def read_info(replies: dict[bytes, list[int]]) -> dict[str, object]:
    dev = Device(_CannedTransport(replies))  # type: ignore[arg-type]
    return {f.key: f for f in asyncio.run(dev.meter_info())}


def test_full_read_reproduces_the_dialog() -> None:
    got = read_info(ALL_REPLIES)
    assert got["device_id"].value == "70B3D5A9F131608C"
    assert got["version"].value == "57.1.2"
    assert got["fw_version"].value == "57.1.2.9"
    assert got["ble_mac"].value == "D5:A9:F1:31:60:8C"
    assert got["app_mode"].value == "Development"


def test_unshown_fields_are_not_queried() -> None:
    # Alarms, Radio and both clocks are in the vendor dialog but not in this
    # one, so they are not worth a BLE round trip each. The decoders above
    # stay tested regardless -- see the note on INFO_QUERIES.
    keys = query_keys()
    opcodes = {q.opcode for q in INFO_QUERIES}
    for key in ("radio", "time_local", "time_utc"):
        assert key not in keys, key
    for opcode in (OPCODE_RADIO, OPCODE_TIME_LOCAL, OPCODE_TIME_UTC, OPCODE_UNKNOWN_9D):
        assert opcode not in opcodes, opcode.hex(" ")


def test_app_mode_is_read_from_44_10_not_9d_00() -> None:
    # The pair these were originally swapped between. `9D 00` answers 00 04,
    # which read big-endian is 4 and looked like a mode number -- it is not.
    assert OPCODE_APP_MODE == b"D"
    assert OPCODE_SET_APP_MODE == b"E"
    assert OPCODE_APP_MODE in {q.opcode for q in INFO_QUERIES}


def test_declined_field_is_marked_not_ok_but_the_rest_survive() -> None:
    # A unit that understands a query and refuses it -- status 1, the way the
    # capture unit answered the radio query. Must not sink the other fields.
    declined = dict(ALL_REPLIES)
    declined[OPCODE_APP_MODE] = [68, 16, 0, 0, 1]
    got = read_info(declined)
    assert got["app_mode"].ok is False
    assert got["app_mode"].status == 1
    assert got["app_mode"].value is None
    # Counted in fields, not queries: the channels query fills two rows, so
    # the two stopped matching one-to-one.
    assert sum(1 for f in got.values() if f.ok) == len(query_keys()) - 1


def test_a_timeout_on_one_field_does_not_abort_the_sequence() -> None:
    missing = {k: v for k, v in ALL_REPLIES.items() if k != OPCODE_DEVICE_ID}
    got = read_info(missing)
    assert got["device_id"].ok is False
    assert "TimeoutError" in (got["device_id"].error or "")
    assert got["version"].value == "57.1.2"
    assert got["ble_mac"].value == "D5:A9:F1:31:60:8C"


def test_raw_bytes_travel_even_when_decoding_succeeded() -> None:
    got = read_info(ALL_REPLIES)
    assert got["device_id"].raw_hex == "8C 60 31 F1 A9 D5 B3 70"


# --- a second capture of the same unit, logged in hex ----------------------
#
# Worth keeping both. The first capture's dialog screenshot was taken a little
# after its log, so its seconds disagreed (log 03, dialog 25) and the byte
# order of the clock rested on the minute alone. This one was logged and
# screenshotted at the same moment: the reply reads `32 1D 02` and the dialog
# read `02:29:50`, which is only consistent with [sec, min, hour] and rules
# out the reverse.

CAPTURE_2 = {
    OPCODE_FW_VERSION: "04 00 08 00 00 35 37 2E 31 2E 32 2E 39",
    OPCODE_VERSION: "02 00 06 00 00 39 00 01 00 02 00",
    OPCODE_DEVICE_ID: "18 00 08 00 00 8C 60 31 F1 A9 D5 B3 70",
    OPCODE_TIME_LOCAL: "44 00 07 00 00 32 1D 02 01 1B 07 1A",
    OPCODE_TIME_UTC: "40 00 07 00 00 32 1D 09 01 1B 07 1A",
    OPCODE_APP_MODE: "44 10 01 00 00 00",
    OPCODE_UNKNOWN_9D: "9D 00 02 00 00 00 04",
    OPCODE_BLE_MAC: "20 10 08 00 00 8C 60 31 F1 A9 D5 00 00",
    OPCODE_RADIO: "78 10 00 00 01",
}


def data2(opcode: bytes) -> bytes:
    return parse_frame(bytes.fromhex(CAPTURE_2[opcode])).payload[1:]


def status2(opcode: bytes) -> int:
    return parse_frame(bytes.fromhex(CAPTURE_2[opcode])).payload[0]


def test_second_capture_matches_its_dialog() -> None:
    # Every value the dialog printed beside this log.
    assert decode_device_id(data2(OPCODE_DEVICE_ID)) == "70B3D5A9F131608C"
    assert decode_version(data2(OPCODE_VERSION)) == "57.1.2"
    assert decode_fw_version(data2(OPCODE_FW_VERSION)) == "57.1.2.9"
    assert decode_ble_mac(data2(OPCODE_BLE_MAC)) == "D5:A9:F1:31:60:8C"
    assert decode_app_mode(data2(OPCODE_APP_MODE)) == "Development"
    assert status2(OPCODE_RADIO) == 1


def test_second_capture_pins_the_clock_byte_order() -> None:
    # Dialog: "27-07-26 02:29:50 (UTC: 27-07-26 09:29:50)".
    assert decode_time(data2(OPCODE_TIME_LOCAL)) == "2026-07-27 02:29:50"
    assert decode_time(data2(OPCODE_TIME_UTC)) == "2026-07-27 09:29:50"


def test_both_captures_agree_on_identity() -> None:
    # Same unit, two sessions: everything except the clock must be identical.
    for opcode, rx in (
        (OPCODE_DEVICE_ID, RX_DEVICE_ID),
        (OPCODE_VERSION, RX_VERSION),
        (OPCODE_FW_VERSION, RX_FW_VERSION),
        (OPCODE_BLE_MAC, RX_BLE_MAC),
        (OPCODE_APP_MODE, RX_APP_MODE),
    ):
        assert data2(opcode) == data_of(rx), opcode.hex(" ")


# --- channels --------------------------------------------------------------
#
# Both directions are captured. The getter reply below was reported as
# LORA_FIXED_PRIMARY + LORA_DRIVEBY_SECONDARY, which is what fixes primary as
# the first byte -- the same order the setter takes them in.


def test_set_channel_frames_match_the_given_examples() -> None:
    assert encode_set_channels(2, 1).hex(" ") == "4c 10 02 00 02 01"  # LORA_FIXED + LORA_DRIVEBY
    assert encode_set_channels(1, 1).hex(" ") == "4c 10 02 00 01 01"  # CATM + LORA_DRIVEBY
    assert encode_set_channels(2, 0).hex(" ") == "4c 10 02 00 02 00"  # LORA_FIXED + NONE


def test_every_channel_pair_encodes() -> None:
    for p in PRIMARY_CHANNELS:
        for sec in SECONDARY_CHANNELS:
            assert encode_set_channels(p, sec) == bytes([0x4C, 0x10, 0x02, 0x00, p, sec])


def test_set_channels_refuses_unknown_values() -> None:
    # Writes to a live meter; a value the list does not know must not go out.
    for bad in (3, 99, -1):
        with pytest.raises(ValueError):
            encode_set_channels(bad, 0)
        with pytest.raises(ValueError):
            encode_set_channels(0, bad)


def test_channel_names() -> None:
    assert [PRIMARY_CHANNELS[i] for i in range(3)] == [
        "NONE_PRIMARY", "CATM_PRIMARY", "LORA_FIXED_PRIMARY",
    ]
    assert [SECONDARY_CHANNELS[i] for i in range(3)] == [
        "NONE_SECONDARY", "LORA_DRIVEBY_SECONDARY", "OMS_SECONDARY",
    ]


def test_both_channels_decode_from_one_reply() -> None:
    data = bytes([2, 1])
    assert decode_primary_channel(data) == "LORA_FIXED_PRIMARY"
    assert decode_secondary_channel(data) == "LORA_DRIVEBY_SECONDARY"


def test_unknown_channel_keeps_its_number() -> None:
    assert decode_primary_channel(bytes([9, 0])) == "Unknown (9)"
    assert decode_secondary_channel(bytes([0, 9])) == "Unknown (9)"


def test_one_reply_fills_both_channel_rows() -> None:
    replies = dict(ALL_REPLIES)
    replies[OPCODE_CHANNELS] = [0x4D, 0x10, 0x02, 0x00, 0x00, 0x02, 0x01]
    got = read_info(replies)
    assert got["primary_channel"].value == "LORA_FIXED_PRIMARY"
    assert got["secondary_channel"].value == "LORA_DRIVEBY_SECONDARY"
    # One round trip, not two -- both rows came off the same reply.
    assert got["primary_channel"].raw_hex == got["secondary_channel"].raw_hex


def test_a_declined_channels_query_marks_both_rows() -> None:
    # A failure has to reach every row that reply was going to fill, or the
    # secondary silently reads blank while the primary says why.
    replies = dict(ALL_REPLIES)
    replies[OPCODE_CHANNELS] = [0x4D, 0x10, 0x00, 0x00, 0x01]
    got = read_info(replies)
    for key in ("primary_channel", "secondary_channel"):
        assert got[key].ok is False, key
        assert got[key].status == 1, key


def test_a_reply_too_short_for_the_secondary_still_gives_the_primary() -> None:
    replies = dict(ALL_REPLIES)
    replies[OPCODE_CHANNELS] = [0x4D, 0x10, 0x01, 0x00, 0x00, 0x02]
    got = read_info(replies)
    assert got["primary_channel"].value == "LORA_FIXED_PRIMARY"
    assert got["secondary_channel"].ok is False
    assert "need 2 bytes" in (got["secondary_channel"].error or "")


CAPTURE_CHANNELS = "4d 10 02 00 00 02 01"


def test_the_captured_getter_reply_decodes_as_reported() -> None:
    # `4D 10 00 00` -> `4D 10 02 00 00 02 01`, reported by the vendor tool as
    # LORA_FIXED_PRIMARY + LORA_DRIVEBY_SECONDARY. This is the evidence that
    # primary comes first; without it the order was only inferred.
    frame = parse_frame(bytes.fromhex(CAPTURE_CHANNELS))
    assert frame.opcode == OPCODE_CHANNELS
    assert frame.payload[0] == 0
    data = frame.payload[1:]
    assert data == bytes([0x02, 0x01])
    assert decode_primary_channel(data) == "LORA_FIXED_PRIMARY"
    assert decode_secondary_channel(data) == "LORA_DRIVEBY_SECONDARY"


def test_the_captured_reply_round_trips_through_the_setter() -> None:
    # Reading a unit and writing the same pair straight back must produce the
    # payload the getter reported -- the check that both ends agree on order.
    data = parse_frame(bytes.fromhex(CAPTURE_CHANNELS)).payload[1:]
    assert encode_set_channels(data[0], data[1]).hex(" ") == "4c 10 02 00 02 01"


# --- save and reset --------------------------------------------------------
#
# The step that makes a channel change stick. `4C 10` alone stages the pair;
# without this the meter comes back on the old channels.


def test_save_and_reset_frame() -> None:
    assert encode_save_and_reset().hex(" ") == "00 21 01 00 05"


def test_save_and_reset_reply_is_a_plain_ok() -> None:
    # `00 21 00 00 00` -- length 0, so the status byte is the whole payload.
    frame = parse_frame(bytes.fromhex("00 21 00 00 00"))
    assert frame.opcode == OPCODE_SAVE_RESET
    assert frame.payload[0] == 0
    assert frame.payload[1:] == b""


def test_the_reset_argument_is_fixed() -> None:
    # 0x05's meaning is unknown, so it is a constant rather than a parameter --
    # this is the guard against it quietly becoming something else.
    assert SAVE_RESET_ARG == 0x05
    assert encode_save_and_reset()[-1] == 0x05


def test_save_and_reset_is_not_one_of_the_read_queries() -> None:
    # It reboots the meter. It must never be reachable from the info read.
    assert OPCODE_SAVE_RESET not in {q.opcode for q in INFO_QUERIES}
