import asyncio
import logging
from typing import Optional

from bleak import BleakClient
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.backends.service import BleakGATTService

from .frame import Frame, parse_frame

log = logging.getLogger(__name__)

# Standard 16-bit-derived Bluetooth Base UUID suffix; chars/services with this
# suffix are SIG-defined (GAP, GATT, etc.) — skip when auto-picking.
_BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb"


def _is_custom(uuid: str) -> bool:
    return not uuid.lower().endswith(_BASE_UUID_SUFFIX)


def _has_write(props: set[str]) -> bool:
    return "write" in props or "write-without-response" in props


def _has_listen(props: set[str]) -> bool:
    return "notify" in props or "indicate" in props


class Transport:
    """Auto-discover comm service (write + notify/indicate chars), send framed
    commands, await framed reply over notifications/indications."""

    def __init__(self, client: BleakClient) -> None:
        self._client = client
        self._write_char: Optional[BleakGATTCharacteristic] = None
        self._listen_chars: list[BleakGATTCharacteristic] = []
        self._write_no_response: bool = False
        self._reply_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._started = False

    async def start(self) -> None:
        if self._started:
            return
        self._discover()
        if self._write_char is None or not self._listen_chars:
            raise RuntimeError(
                "No comm service found "
                f"(write={self._write_char}, listen={self._listen_chars})"
            )
        for c in self._listen_chars:
            await self._client.start_notify(c, self._on_notify)
        self._started = True
        log.info(
            "Transport ready: write=%s (no_resp=%s) listen=%s",
            self._write_char.uuid,
            self._write_no_response,
            [c.uuid for c in self._listen_chars],
        )

    async def stop(self) -> None:
        if not self._started:
            return
        try:
            if self._client.is_connected:
                for c in self._listen_chars:
                    try:
                        await self._client.stop_notify(c)
                    except Exception as e:
                        log.warning("stop_notify %s failed: %s", c.uuid, e)
        finally:
            self._started = False

    def _discover(self) -> None:
        # Pass 1: custom service with both write and listen.
        candidate = self._find_service(prefer_custom=True)
        # Pass 2: any service with both.
        if candidate is None:
            candidate = self._find_service(prefer_custom=False)
        if candidate is None:
            return

        write_char = None
        write_no_resp = False
        listens: list[BleakGATTCharacteristic] = []
        for c in candidate.characteristics:
            props = set(c.properties)
            if write_char is None and _has_write(props):
                write_char = c
                write_no_resp = (
                    "write" not in props and "write-without-response" in props
                )
            if _has_listen(props):
                listens.append(c)

        self._write_char = write_char
        self._write_no_response = write_no_resp
        self._listen_chars = listens

    def _find_service(self, prefer_custom: bool) -> Optional[BleakGATTService]:
        for svc in self._client.services:
            if prefer_custom and not _is_custom(svc.uuid):
                continue
            has_w = False
            has_l = False
            for c in svc.characteristics:
                props = set(c.properties)
                has_w = has_w or _has_write(props)
                has_l = has_l or _has_listen(props)
            if has_w and has_l:
                return svc
        return None

    def _on_notify(self, _char: BleakGATTCharacteristic, data: bytearray) -> None:
        # Each BLE notification/indication is atomic (one ATT packet, <= MTU).
        # Treat each one as one complete reply frame.
        if len(data) >= 2:
            self._reply_queue.put_nowait(bytes(data))

    async def send(self, frame_bytes: bytes, timeout: float = 5.0) -> Frame:
        if not self._started:
            await self.start()
        while not self._reply_queue.empty():
            self._reply_queue.get_nowait()

        assert self._write_char is not None

        async def _do() -> bytes:
            await self._client.write_gatt_char(
                self._write_char,
                frame_bytes,
                response=not self._write_no_response,
            )
            return await self._reply_queue.get()

        reply_raw = await asyncio.wait_for(_do(), timeout=timeout)
        return parse_frame(reply_raw)

    @property
    def write_uuid(self) -> Optional[str]:
        return self._write_char.uuid if self._write_char else None

    @property
    def notify_uuid(self) -> Optional[str]:
        if not self._listen_chars:
            return None
        return ",".join(c.uuid for c in self._listen_chars)
