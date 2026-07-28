"""Wire-frame packing/parsing — the layer every DUT command goes through."""

from __future__ import annotations

import pytest

from backend.protocol.frame import Frame, pack_frame, parse_frame


class TestPackFrame:
    def test_layout_is_opcode_len_payload(self) -> None:
        assert pack_frame(b"\x28\x50", b"\x01\x02\x03") == b"\x28\x50\x03\x00\x01\x02\x03"

    def test_empty_payload_declares_zero_length(self) -> None:
        assert pack_frame(b"\x18\x50", b"") == b"\x18\x50\x00\x00"

    def test_length_is_little_endian(self) -> None:
        packed = pack_frame(b"\x28\x50", b"\x00" * 258)
        assert packed[2:4] == b"\x02\x01"

    @pytest.mark.parametrize("opcode", [b"", b"\x28", b"\x28\x50\x00"])
    def test_rejects_opcode_that_is_not_two_bytes(self, opcode: bytes) -> None:
        with pytest.raises(ValueError, match="opcode must be 2 bytes"):
            pack_frame(opcode, b"")

    def test_rejects_payload_over_u16(self) -> None:
        with pytest.raises(ValueError, match="payload too large"):
            pack_frame(b"\x28\x50", b"\x00" * 0x10000)


class TestParseFrame:
    def test_round_trips_pack_frame(self) -> None:
        frame = parse_frame(pack_frame(b"\x28\x50", b"\xde\xad\xbe\xef"))
        assert frame == Frame(opcode=b"\x28\x50", payload=b"\xde\xad\xbe\xef")

    def test_folds_undeclared_trailing_bytes_into_payload(self) -> None:
        # Replies carry a status byte past the declared length; callers read it
        # as payload[0], so it must survive parsing.
        frame = parse_frame(b"\x28\x50\x00\x00\x00")
        assert frame.payload == b"\x00"

    def test_rejects_buffer_shorter_than_header(self) -> None:
        with pytest.raises(ValueError, match="frame too short"):
            parse_frame(b"\x28\x50\x00")

    def test_rejects_payload_shorter_than_declared(self) -> None:
        with pytest.raises(ValueError, match="truncated frame"):
            parse_frame(b"\x28\x50\x08\x00\x01\x02")
