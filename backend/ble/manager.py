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

# An unexpected drop mid-test would otherwise fail every remaining point with
# "Device not ready". Re-establish quietly instead; a run survives a brief drop.
RECONNECT_ATTEMPTS = 3
RECONNECT_BACKOFF_S = 2.0

# How long a sweep waits on a dropped link before giving up on it: room for
# the reconnect attempts above, each a scan plus a connect.
RELINK_WAIT_S = 45.0

# A deliberate drop -- the DUT resetting, or keying its own radio for a BLE
# test tone -- is waited out by `relink` rather than by the reconnect above,
# which gives up after three tries and would spend them while the DUT is still
# off air. Each attempt is a scan bounded by RELINK_ATTEMPT_S; the whole wait
# by the caller's timeout.
#
# Mirrored by RELINK_TIMEOUT_S in frontend/src/tests/ble/radio.ts.
RELINK_TIMEOUT_S = 30.0
RELINK_ATTEMPT_S = 10.0
RELINK_RETRY_S = 1.0

# How long releasing a link the DUT is leaving may take. Windows can sit on a
# disconnect to a peer that has already gone for the full supervision
# timeout; the session is abandoned either way, so this only bounds the wait.
RELEASE_TIMEOUT_S = 5.0


class BLEManager:
    def __init__(self) -> None:
        self._client: Optional[BleakClient] = None
        self._connected_device: Optional[BLEDevice] = None
        self._transport: Optional[Transport] = None
        self._device: Optional[Device] = None
        self._transport_error: Optional[str] = None
        self._lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None
        # Reconnect bookkeeping. `_intentional` distinguishes a drop from the
        # user pressing Disconnect, which must not be undone.
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._reconnect_task: Optional[asyncio.Task] = None
        self._intentional = False
        self._last_address: Optional[str] = None

    async def _heartbeat_loop(self) -> None:
        """Keep the BLE link alive while nothing else is talking to the DUT.

        Prevents supervision-timeout disconnects when no test is active. It
        deliberately does nothing while a test is running:

        - A test already generates traffic, so the keep-alive is redundant.
        - The read is a GATT operation on the same client as the command
          exchange. Interleaving the two is what made the link drop part-way
          through a sweep, so the heartbeat both skips when the transport has
          been busy and takes the transport's IO lock when it does read.

        Silent on failures — disconnect detection is the disconnected_callback
        wired at connect time.
        """
        try:
            while self._client and self._client.is_connected:
                await asyncio.sleep(HEARTBEAT_INTERVAL_S)
                c = self._client
                if not (c and c.is_connected):
                    return

                t = self._transport
                if t is not None and t.idle_seconds < HEARTBEAT_INTERVAL_S:
                    continue  # commands are keeping the link warm

                try:
                    if t is not None:
                        async with t.io_lock:
                            await c.read_gatt_char(HEARTBEAT_CHAR_UUID)
                    else:
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
        loop = asyncio.get_running_loop()
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
                # A late callback from a client already replaced -- a reconnect
                # that went ahead before this fired -- must not wipe the new one.
                if self._client is not None and self._client is not _c:
                    return
                self._stop_heartbeat()
                self._client = None
                self._connected_device = None
                self._transport = None
                self._device = None
                self._transport_error = None
                # Bleak may invoke this off the event-loop thread.
                loop = self._loop
                if not self._intentional and loop is not None:
                    loop.call_soon_threadsafe(self._schedule_reconnect)

            self._loop = asyncio.get_running_loop()
            self._last_address = address
            self._intentional = False
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

    async def wait_for_device(self, stale: Device, timeout: float = RELINK_WAIT_S) -> Optional[Device]:
        """The device to use after `stale` failed a command, once the link is back.

        None when the link never went down -- the command failed for its own
        reasons, and a new device would not change that -- or when it did not
        come back within `timeout`, or the operator disconnected on purpose.
        """
        c = self._client
        if self._device is stale and c is not None and c.is_connected:
            return None
        # The disconnect callback normally queues the reconnect; if bleak
        # reported "not connected" before it fired, start it here.
        self._schedule_reconnect()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if self._intentional:
                return None
            d, c = self._device, self._client
            if d is not None and d is not stale and c is not None and c.is_connected:
                return d
            await asyncio.sleep(0.25)
        return None

    def _schedule_reconnect(self) -> None:
        """Start a reconnect attempt, unless one is already running."""
        if self._reconnect_task is not None and not self._reconnect_task.done():
            return
        if self._intentional or not self._last_address:
            return
        self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def _reconnect_loop(self) -> None:
        address = self._last_address
        if address is None:
            return
        for attempt in range(1, RECONNECT_ATTEMPTS + 1):
            await asyncio.sleep(RECONNECT_BACKOFF_S)
            # The user may have reconnected by hand, or asked to stay off.
            if self._intentional:
                return
            if self._client is not None and self._client.is_connected:
                return
            try:
                log.info("BLE reconnect attempt %d/%d to %s", attempt, RECONNECT_ATTEMPTS, address)
                await self.connect(address)
                log.info("BLE reconnected to %s", address)
                return
            except Exception as e:
                log.warning("BLE reconnect attempt %d failed: %s", attempt, e)
        log.error("BLE reconnect gave up after %d attempts", RECONNECT_ATTEMPTS)

    async def release(self) -> None:
        """Let go of a link the DUT is about to drop on purpose.

        Called straight after a command that takes the DUT off the link -- a
        save-and-reset, a BLE test tone. Two reasons not to wait for the drop
        to be noticed: until then the app reports "connected" for a link that
        is gone, and a drop noticed by the disconnect callback queues the
        automatic reconnect, which then spends its attempts on a DUT that is
        deliberately away. Marked intentional so it does not; `relink` brings
        the link back, and keeps the address to do it with.
        """
        try:
            await asyncio.wait_for(self.disconnect(), RELEASE_TIMEOUT_S)
        except Exception as e:
            log.warning("BLE release did not complete cleanly: %s: %s", type(e).__name__, e)
            # The session is abandoned either way; do not leave it reporting
            # connected because the platform was slow to agree.
            self._stop_heartbeat()
            self._client = None
            self._connected_device = None
            self._transport = None
            self._device = None

    async def relink(self, timeout: float = RELINK_TIMEOUT_S) -> ConnectionStatus:
        """Reconnect to the last DUT once it is back on the air.

        For the end of a deliberate drop. Scans in short attempts until the DUT
        advertises and a connection with a working transport comes up, or
        `timeout` runs out. A connection without a transport is not a relink:
        a DUT still booting can accept the link before its command service is
        up, and handing that back would fail the next command instead.
        """
        address = self._last_address
        if not address:
            raise RuntimeError("No DUT to reconnect to; connect to one first")
        if self._device is not None and self._client is not None and self._client.is_connected:
            return self._status()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        attempt = 0
        last_error = "not found"
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise TimeoutError(
                    f"DUT {address} did not come back within {timeout:.0f} s "
                    f"({attempt} attempt{'s' if attempt != 1 else ''}; last: {last_error})"
                )
            attempt += 1
            try:
                st = await self.connect(address, timeout=max(1.0, min(remaining, RELINK_ATTEMPT_S)))
                if st.transport_ready:
                    log.info("BLE relinked to %s after %d attempt(s)", address, attempt)
                    return st
                last_error = f"transport not ready: {st.transport_error}"
                await self.release()
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
            await asyncio.sleep(min(RELINK_RETRY_S, max(0.0, deadline - loop.time())))

    async def disconnect(self) -> ConnectionStatus:
        async with self._lock:
            # Mark first: the callback fires during the disconnect below and
            # must not queue a reconnect for a link the user just dropped.
            self._intentional = True
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
