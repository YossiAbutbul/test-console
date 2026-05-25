import asyncio
import logging
from typing import AsyncIterator, Optional

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

from .models import (
    ConnectionStatus,
    GattCharacteristic,
    GattService,
    ScannedDevice,
)
from ..protocol import Transport
from ..device import Device

log = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_S = 5.0
# GAP Device Name — present on virtually every BLE peripheral and cheap to read.
HEARTBEAT_CHAR_UUID = "00002a00-0000-1000-8000-00805f9b34fb"


class BLEManager:
    def __init__(self) -> None:
        self._client: Optional[BleakClient] = None
        self._connected_device: Optional[BLEDevice] = None
        self._transport: Optional[Transport] = None
        self._device: Optional[Device] = None
        self._transport_error: Optional[str] = None
        self._lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None

    async def _heartbeat_loop(self) -> None:
        """Keep BLE link alive by reading a GATT char every few seconds.

        Prevents supervision-timeout disconnects when no test is active.
        Silent on failures — disconnect detection happens via the
        disconnected_callback wired at connect time.
        """
        try:
            while self._client and self._client.is_connected:
                await asyncio.sleep(HEARTBEAT_INTERVAL_S)
                c = self._client
                if not (c and c.is_connected):
                    return
                try:
                    await c.read_gatt_char(HEARTBEAT_CHAR_UUID)
                except Exception as e:
                    log.debug("BLE heartbeat read failed: %s", e)
        except asyncio.CancelledError:
            pass

    def _stop_heartbeat(self) -> None:
        t = self._heartbeat_task
        self._heartbeat_task = None
        if t is not None and not t.done():
            t.cancel()

    async def scan(self, duration: float = 5.0) -> list[ScannedDevice]:
        discovered: dict[str, ScannedDevice] = {}

        def cb(device: BLEDevice, adv: AdvertisementData) -> None:
            discovered[device.address] = ScannedDevice(
                address=device.address,
                name=adv.local_name or device.name,
                rssi=adv.rssi,
                metadata={
                    "manufacturer_data": {
                        str(k): v.hex() for k, v in adv.manufacturer_data.items()
                    },
                    "service_uuids": list(adv.service_uuids or []),
                    "tx_power": adv.tx_power,
                },
            )

        scanner = BleakScanner(detection_callback=cb)
        await scanner.start()
        try:
            await asyncio.sleep(duration)
        finally:
            await scanner.stop()
        return list(discovered.values())

    async def scan_stream(self, duration: float = 5.0) -> AsyncIterator[ScannedDevice]:
        """Yield each discovered/updated device as it is seen, until duration elapses."""
        queue: asyncio.Queue[ScannedDevice] = asyncio.Queue()

        def cb(device: BLEDevice, adv: AdvertisementData) -> None:
            queue.put_nowait(
                ScannedDevice(
                    address=device.address,
                    name=adv.local_name or device.name,
                    rssi=adv.rssi,
                    metadata={
                        "manufacturer_data": {
                            str(k): v.hex() for k, v in adv.manufacturer_data.items()
                        },
                        "service_uuids": list(adv.service_uuids or []),
                        "tx_power": adv.tx_power,
                    },
                )
            )

        scanner = BleakScanner(detection_callback=cb)
        await scanner.start()
        loop = asyncio.get_event_loop()
        deadline = loop.time() + duration
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                yield item
        finally:
            await scanner.stop()

    async def connect(self, address: str, timeout: float = 15.0) -> ConnectionStatus:
        async with self._lock:
            if self._client and self._client.is_connected:
                if self._client.address.lower() == address.lower():
                    return self._status()
                await self._disconnect_unlocked()

            device = await BleakScanner.find_device_by_address(address, timeout=timeout)
            if device is None:
                raise RuntimeError(f"Device {address} not found within {timeout}s")

            def _on_disconnect(_c: BleakClient) -> None:
                log.info("BLE disconnect callback fired for %s", address)
                self._stop_heartbeat()
                self._client = None
                self._connected_device = None
                self._transport = None
                self._device = None
                self._transport_error = None

            client = BleakClient(device, disconnected_callback=_on_disconnect)
            await client.connect(timeout=timeout)
            if not client.is_connected:
                raise RuntimeError(f"Failed to connect to {address}")

            self._client = client
            self._connected_device = device
            log.info("Connected to %s (%s)", device.address, device.name)

            transport = Transport(client)
            self._transport_error = None
            try:
                await transport.start()
                self._transport = transport
                self._device = Device(transport)
                log.info(
                    "Transport bound: write=%s notify=%s",
                    transport.write_uuid,
                    transport.notify_uuid,
                )
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                log.warning("Transport init failed: %s (commands unavailable)", msg)
                self._transport = None
                self._device = None
                self._transport_error = msg

            self._stop_heartbeat()
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            return self._status()

    async def disconnect(self) -> ConnectionStatus:
        async with self._lock:
            await self._disconnect_unlocked()
            return self._status()

    async def _disconnect_unlocked(self) -> None:
        if self._client is None:
            return
        self._stop_heartbeat()
        try:
            if self._transport is not None:
                try:
                    await self._transport.stop()
                except Exception as e:
                    log.warning("Transport stop error: %s", e)
            if self._client.is_connected:
                await self._client.disconnect()
        finally:
            self._client = None
            self._connected_device = None
            self._transport = None
            self._device = None
            self._transport_error = None

    def status(self) -> ConnectionStatus:
        return self._status()

    def _status(self) -> ConnectionStatus:
        if self._client and self._client.is_connected and self._connected_device:
            t = self._transport
            return ConnectionStatus(
                connected=True,
                address=self._connected_device.address,
                name=self._connected_device.name,
                transport_ready=t is not None,
                transport_error=self._transport_error,
                write_uuid=t.write_uuid if t else None,
                notify_uuid=t.notify_uuid if t else None,
            )
        return ConnectionStatus(connected=False)

    async def services(self) -> list[GattService]:
        if not (self._client and self._client.is_connected):
            raise RuntimeError("Not connected")
        out: list[GattService] = []
        for svc in self._client.services:
            chars = [
                GattCharacteristic(
                    uuid=c.uuid,
                    properties=list(c.properties),
                    handle=c.handle,
                    description=c.description,
                )
                for c in svc.characteristics
            ]
            out.append(
                GattService(
                    uuid=svc.uuid,
                    description=svc.description,
                    characteristics=chars,
                )
            )
        return out

    @property
    def client(self) -> Optional[BleakClient]:
        return self._client

    @property
    def transport(self) -> Optional[Transport]:
        return self._transport

    @property
    def device(self) -> Optional[Device]:
        return self._device


manager = BLEManager()
