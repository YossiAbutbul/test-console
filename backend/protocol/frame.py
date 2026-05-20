from dataclasses import dataclass


@dataclass
class Frame:
    opcode: bytes  # 2 bytes, raw (e.g. b"\x28\x50")
    payload: bytes

    def to_bytes(self) -> bytes:
        return pack_frame(self.opcode, self.payload)


def pack_frame(opcode: bytes, payload: bytes) -> bytes:
    if len(opcode) != 2:
        raise ValueError("opcode must be 2 bytes")
    if len(payload) > 0xFFFF:
        raise ValueError("payload too large")
    return opcode + len(payload).to_bytes(2, "little") + payload


def parse_frame(buf: bytes) -> Frame:
    """Parse a frame.

    Layout: [opcode:2][len:2 LE][payload...]
    Replies from device sometimes carry a trailing status byte beyond the
    declared length. We accept extra trailing bytes and fold them into the
    payload so callers can read status from payload[0].
    """
    if len(buf) < 4:
        raise ValueError(f"frame too short: {buf.hex()}")
    opcode = buf[0:2]
    length = int.from_bytes(buf[2:4], "little")
    declared = buf[4 : 4 + length]
    trailing = buf[4 + length :]
    if len(declared) < length:
        raise ValueError(
            f"truncated frame: declared len={length} got={len(declared)}"
        )
    payload = declared + trailing
    return Frame(opcode=opcode, payload=payload)
