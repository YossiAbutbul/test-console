"""Shared request/response plumbing for the device command routes."""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel

from ...ble import manager
from ...device import CommandResult


class CommandResponse(BaseModel):
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    reply_opcode_hex: str
    reply_payload_hex: str

    @classmethod
    def from_result(cls, r: CommandResult) -> CommandResponse:
        return cls(
            ok=r.ok,
            status=r.status,
            tx_hex=r.tx.hex(" "),
            rx_hex=r.rx.hex(" "),
            reply_opcode_hex=r.reply.opcode.hex(" "),
            reply_payload_hex=r.reply.payload.hex(" "),
        )


def get_device():
    dev = manager.device
    if dev is None:
        raise HTTPException(
            status_code=409,
            detail="Device not ready (not connected or transport unavailable)",
        )
    return dev
