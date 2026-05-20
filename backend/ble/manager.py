import asyncio
import logging
from typing import Optional

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


class BLEManager:
    def __init__(self) -> None:
        self._client: Optional[BleakClient] = None
        self._connected_device: Optional[BLEDevice] = None
        self._transport: Optional[Transport] = None
        self._device: Optional[Device] = None
        self._transport_error: Optional[str] = None
        self._lock = asyncio.Lock()

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

    async def connect(self, address: str, timeout: float = 15.0) -> ConnectionStatus:
        async with self._lock:
            if self._client and self._client.is_connected:
                if self._client.address.lower() == address.lower():
                    return self._status()
                await self._disconnect_unlocked()

            device = await BleakScanner.find_device_by_address(address, timeout=timeout)
            if device is None:
                raise RuntimeError(f"Device {address} not found within {timeout}s")

            client = BleakClient(device)
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

            return self._status()

    async def disconnect(self) -> ConnectionStatus:
        async with self._lock:
            await self._disconnect_unlocked()
            return self._status()

    async def _disconnect_unlocked(self) -> None:
        if self._client is None:
            return
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
