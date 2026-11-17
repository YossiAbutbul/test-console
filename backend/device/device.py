"""The command surface bound to an active Transport.

Protocol-specific encoding lives in `lora.py` / `lte.py`; this class is only
the async plumbing around it — recovery waits, timeouts, and the LTE power
sequence.
"""

from __future__ import annotations

import asyncio
import time
from typing import Optional

from ..protocol import Transport, pack_frame
from .common import (
    OPCODE_STOP_TEST, POST_STOP_RECOVERY_S, CommandResult, make_result,
)
from .info import (
    APP_MODES, INFO_QUERIES, PRIMARY_CHANNELS, SECONDARY_CHANNELS, AppModeWrite,
    ChannelsWrite, InfoField, InfoQuery, WriteOutcome, encode_save_and_reset,
    encode_set_app_mode, encode_set_channels,
)
from .lora import (
    OPCODE_LORA_CW_DEBUG, OPCODE_LORA_MODULATED, OPCODE_LORA_POWER,
    LoraCwParams, LoraModulatedParams, LoraPowerParams, Modem, PaMode,
)
from .ble import (
    OPCODE_BLE_TX_POWER_GET, BleToneParams, BleTxPowerRead, decode_tx_power,
    encode_tx_power_get, encode_tx_power_set,
)
from .lte import (
    MODEM_ON_TIMEOUT_S, OPCODE_LTE_CW, OPCODE_LTE_MODEM_OFF,
    OPCODE_LTE_MODEM_ON, OPCODE_LTE_MODULATED, LteBandwidth, LteCwParams,
    LteModulatedParams, LteTstrfCmd,
)


class Device:
    """CATM2 command surface bound to an active Transport."""

    def __init__(self, transport: Transport) -> None:
        self._t = transport
        # Monotonic time before which the DUT should not be given another
        # command. Set by stop_test; awaited by every command below.
        self._ready_at = 0.0

    async def _await_ready(self) -> None:
        """Block until the DUT has finished recovering from a previous stop.

        Kept here rather than in the callers so that every path — the TX power
        automation, Load Pull, the backend sweep runner — gets it without
        having to know about the constraint.
        """
        delay = self._ready_at - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)

    # --- LoRa ---

    async def lora_cw(
        self,
        freq_hz: int,
        power_dbm: int,
        pa_duty_cycle: int,
        hp_max: int,
        pa_mode: PaMode = PaMode.AUTO,
        timeout: float = 5.0,
    ) -> CommandResult:
        await self._await_ready()
        params = LoraCwParams(
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            pa_duty_cycle=pa_duty_cycle,
            hp_max=hp_max,
            pa_mode=pa_mode,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LORA_CW_DEBUG)

    async def lora_power(
        self,
        freq_hz: int,
        power_dbm: int,
        pa_mode: PaMode = PaMode.AUTO,
        timeout: float = 5.0,
    ) -> CommandResult:
        await self._await_ready()
        params = LoraPowerParams(
            freq_hz=freq_hz, power_dbm=power_dbm, pa_mode=pa_mode,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LORA_POWER)

    async def lora_modulated(
        self,
        bandwidth: int,
        freq_hz: int,
        power_dbm: int,
        modem: Modem,
        datarate: int,
        timeout: float = 5.0,
    ) -> CommandResult:
        await self._await_ready()
        params = LoraModulatedParams(
            bandwidth=bandwidth,
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            modem=modem,
            datarate=datarate,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LORA_MODULATED)

    async def stop_test(self, timeout: float = 5.0) -> CommandResult:
        # Deliberately does not wait for a previous recovery window: stopping
        # an already-stopped DUT is harmless, and Stop must stay responsive.
        tx = pack_frame(OPCODE_STOP_TEST, b"")
        reply = await self._t.send(tx, timeout=timeout)
        self._ready_at = time.monotonic() + POST_STOP_RECOVERY_S
        return make_result(tx, reply, expected_opcode=OPCODE_STOP_TEST)

    # --- LTE ---
    #
    # Individual steps only. Modem power is the operator's to hold: they leave
    # it up across several commands rather than paying the ~10 s boot each
    # time, and it comes down when they say so. Nothing here powers it down on
    # their behalf — see the note on `lte_modem_off`.

    async def lte_modem_on(
        self, timeout: float = MODEM_ON_TIMEOUT_S,
    ) -> CommandResult:
        await self._await_ready()
        tx = pack_frame(OPCODE_LTE_MODEM_ON, b"")
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LTE_MODEM_ON)

    async def lte_modem_off(self, timeout: float = 5.0) -> CommandResult:
        # Only ever called because the operator asked for it. Aborting a test
        # leaves the modem up, so a DUT stays powered until it is toggled off
        # — deliberate, so a second command does not pay the boot again.
        #
        # Like stop_test, deliberately skips the recovery wait: powering the
        # modem down is the safe direction and must stay responsive.
        tx = pack_frame(OPCODE_LTE_MODEM_OFF, b"")
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LTE_MODEM_OFF)

    async def lte_cw(
        self,
        earfcn: int,
        time_ms: int,
        tx_power: int,
        offset_hz: int,
        tstrf_cmd: LteTstrfCmd = LteTstrfCmd.START_TX_TEST,
        timeout: float = 5.0,
    ) -> CommandResult:
        await self._await_ready()
        params = LteCwParams(
            earfcn=earfcn,
            time_ms=time_ms,
            tx_power=tx_power,
            offset_hz=offset_hz,
            tstrf_cmd=tstrf_cmd,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LTE_CW)

    async def lte_modulated(
        self,
        earfcn: int,
        time_ms: int,
        tx_power: int,
        bandwidth: LteBandwidth,
        mcs: int,
        rb_count: int,
        rb_start: int = 0,
        nb_index: int = 0,
        tstrf_cmd: LteTstrfCmd = LteTstrfCmd.START_TX_TEST,
        timeout: float = 5.0,
    ) -> CommandResult:
        await self._await_ready()
        params = LteModulatedParams(
            earfcn=earfcn,
            time_ms=time_ms,
            tx_power=tx_power,
            bandwidth=bandwidth,
            mcs=mcs,
            rb_count=rb_count,
            rb_start=rb_start,
            nb_index=nb_index,
            tstrf_cmd=tstrf_cmd,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return make_result(tx, reply, expected_opcode=OPCODE_LTE_MODULATED)

    # --- meter information ---

    async def meter_info(self, timeout: float = 5.0) -> list[InfoField]:
        """Read every identity field the unit will answer.

        One failure does not sink the rest. The capture this was built from
        has the unit refusing the radio query outright (status 1) while
        answering the other eight, and the vendor dialog still fills in — it
        just prints "Not Supported" on that row. Aborting the sequence there
        would throw away eight good fields for one missing one, so each query
        is caught on its own and reported as a failed field.
        """
        await self._await_ready()
        fields: list[InfoField] = []
        for q in INFO_QUERIES:
            fields.extend(await self._read_info(q, timeout))
        return fields

    async def _read_info(self, q: InfoQuery, timeout: float) -> list[InfoField]:
        """One query in, one field per output out.

        A query can carry more than one field -- `4D 10` answers with both
        channels -- so a failure has to be reported against every field that
        reply was going to fill, not just the first. Otherwise a declined
        channels query would leave the secondary row silently blank rather
        than saying it is unavailable like its neighbour.
        """
        tx = pack_frame(q.opcode, b"")

        def failed(status: int, raw_hex: str, error: Optional[str]) -> list[InfoField]:
            return [
                InfoField(
                    key=o.key, label=o.label, ok=False, status=status,
                    raw_hex=raw_hex, value=None, error=error,
                )
                for o in q.outputs
            ]

        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            # Transport-level failure: a timeout, or a link that dropped
            # partway through the sequence. Recorded on the rows rather than
            # raised, for the reason in meter_info.
            return failed(-1, "", f"{type(e).__name__}: {e}")

        if reply.opcode != q.opcode:
            return failed(-1, "", (
                f"unexpected reply opcode {reply.opcode.hex(' ')} "
                f"for {q.opcode.hex(' ')}"
            ))

        status = reply.payload[0] if reply.payload else 0
        data = reply.payload[1:]
        raw_hex = data.hex(" ").upper()
        if status != 0:
            # The unit understood and declined. Not an error to shout about --
            # this is what "Not Supported" in the dialog actually is.
            return failed(status, raw_hex, None)

        out: list[InfoField] = []
        for o in q.outputs:
            try:
                value = o.decode(data)
            except Exception as e:
                # A short or unexpected reply. The bytes still travel, because
                # a layout guessed from one capture is exactly the thing that
                # needs looking at when this fires. Per-output, so a reply that
                # is long enough for one field and not the next still gives up
                # only the field it cannot fill.
                out.append(InfoField(
                    key=o.key, label=o.label, ok=False, status=status,
                    raw_hex=raw_hex, value=None, error=str(e),
                ))
                continue
            out.append(InfoField(
                key=o.key, label=o.label, ok=True, status=status,
                raw_hex=raw_hex, value=value,
            ))
        return out

    async def set_app_mode(self, mode: int, timeout: float = 5.0) -> AppModeWrite:
        """Change the unit's app mode.

        A write, not a read: the meter stores the mode and -- going by the
        vendor tool -- resets itself, which drops the BLE link. That makes a
        missing reply ambiguous rather than a failure, so a timeout is
        reported as "not acknowledged" instead of being raised. The caller
        reconnects and re-reads to find out what actually took.
        """
        await self._await_ready()
        tx = encode_set_app_mode(mode)
        label = APP_MODES.get(mode, str(mode))
        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            return AppModeWrite(
                mode=mode, label=label, acknowledged=False, ok=False, status=-1,
                tx_hex=tx.hex(" "), rx_hex="",
                error=f"{type(e).__name__}: {e}",
            )
        status = reply.payload[0] if reply.payload else 0
        rx = reply.opcode + len(reply.payload).to_bytes(2, "little") + reply.payload
        return AppModeWrite(
            mode=mode, label=label, acknowledged=True, ok=(status == 0),
            status=status, tx_hex=tx.hex(" "), rx_hex=rx.hex(" "),
        )

    async def set_channels(
        self, primary: int, secondary: int, timeout: float = 5.0,
    ) -> ChannelsWrite:
        """Set both radio channels.

        Both go in one frame because the command takes both -- there is no
        opcode for changing one alone, so the caller states the pair it wants
        to end up with.
        """
        await self._await_ready()
        tx = encode_set_channels(primary, secondary)
        labels = (
            PRIMARY_CHANNELS.get(primary, str(primary)),
            SECONDARY_CHANNELS.get(secondary, str(secondary)),
        )
        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            return ChannelsWrite(
                primary=primary, secondary=secondary,
                primary_label=labels[0], secondary_label=labels[1],
                acknowledged=False, ok=False, status=-1,
                tx_hex=tx.hex(" "), rx_hex="",
                error=f"{type(e).__name__}: {e}",
            )
        status = reply.payload[0] if reply.payload else 0
        rx = reply.opcode + len(reply.payload).to_bytes(2, "little") + reply.payload
        return ChannelsWrite(
            primary=primary, secondary=secondary,
            primary_label=labels[0], secondary_label=labels[1],
            acknowledged=True, ok=(status == 0), status=status,
            tx_hex=tx.hex(" "), rx_hex=rx.hex(" "),
        )

    async def save_and_reset(self, timeout: float = 5.0) -> WriteOutcome:
        """Persist staged settings and reboot the meter.

        This is what makes a channel change take: `4C 10` alone stages the
        pair and the unit comes back on the old channels without it.

        The reply arrives before the meter goes down, so an unanswered one is
        genuinely doubtful rather than routine -- unlike the writes themselves,
        where a missing reply is the expected shape. What happens *after* the
        reply is not a failure: the BLE link drops and stays down until
        something reconnects, which is the caller's problem to surface.
        """
        await self._await_ready()
        tx = encode_save_and_reset()
        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            return WriteOutcome(
                acknowledged=False, ok=False, status=-1,
                tx_hex=tx.hex(" "), rx_hex="", error=f"{type(e).__name__}: {e}",
            )
        status = reply.payload[0] if reply.payload else 0
        rx = reply.opcode + len(reply.payload).to_bytes(2, "little") + reply.payload
        return WriteOutcome(
            acknowledged=True, ok=(status == 0), status=status,
            tx_hex=tx.hex(" "), rx_hex=rx.hex(" "),
        )

    # --- BLE radio ---
    #
    # Both of these end with the DUT off the link -- see `ble.py`. The reply is
    # therefore reported the way the other link-dropping writes report theirs:
    # a missing one is "not acknowledged", not an error, and the caller
    # reconnects to find out where the DUT is.

    async def _write(self, tx: bytes, timeout: float) -> WriteOutcome:
        await self._await_ready()
        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            return WriteOutcome(
                acknowledged=False, ok=False, status=-1,
                tx_hex=tx.hex(" "), rx_hex="", error=f"{type(e).__name__}: {e}",
            )
        status = reply.payload[0] if reply.payload else 0
        rx = reply.opcode + len(reply.payload).to_bytes(2, "little") + reply.payload
        return WriteOutcome(
            acknowledged=True, ok=(status == 0), status=status,
            tx_hex=tx.hex(" "), rx_hex=rx.hex(" "),
        )

    async def ble_tx_power_set(self, param: int, timeout: float = 5.0) -> WriteOutcome:
        """Stage the tone power. Takes on the save-and-reset after it."""
        return await self._write(encode_tx_power_set(param), timeout)

    async def ble_tx_power_get(self, timeout: float = 5.0) -> BleTxPowerRead:
        """Read the tone power back. A read: the DUT stays on the link.

        Never raises for what the DUT answered -- a refusal or an undecodable
        value comes back as `param=None` with the reason -- so a caller can
        fall back to what it set rather than failing a run over a read.
        """
        await self._await_ready()
        tx = encode_tx_power_get()
        try:
            reply = await self._t.send(tx, timeout=timeout)
        except Exception as e:
            return BleTxPowerRead(
                ok=False, status=-1, param=None, tx_hex=tx.hex(" "), rx_hex="",
                error=f"{type(e).__name__}: {e}",
            )
        rx = reply.opcode + len(reply.payload).to_bytes(2, "little") + reply.payload
        status = reply.payload[0] if reply.payload else 0
        data = reply.payload[1:]
        out = BleTxPowerRead(
            ok=False, status=status, param=None, tx_hex=tx.hex(" "),
            rx_hex=rx.hex(" "), data_hex=data.hex(" ").upper(),
        )
        if reply.opcode != OPCODE_BLE_TX_POWER_GET:
            out.error = f"unexpected reply opcode {reply.opcode.hex(' ')}"
        elif status != 0:
            out.error = f"refused (status {status})"
        else:
            try:
                out.param = decode_tx_power(data)
                out.ok = True
            except ValueError as e:
                out.error = str(e)
        return out

    async def ble_tone_start(
        self, channel: int, duration_s: int, offset: int = 0, timeout: float = 3.0,
    ) -> WriteOutcome:
        """Start a test tone. The link goes with it, for `duration_s`.

        A shorter timeout than the other commands: whether a reply makes it
        out before the radio switches over is not known, and the tone is
        already on air while we wait -- the time spent here comes out of the
        point's measuring window.
        """
        tx = BleToneParams(channel=channel, duration_s=duration_s, offset=offset).encode()
        return await self._write(tx, timeout)
