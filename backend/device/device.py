"""The command surface bound to an active Transport.

Protocol-specific encoding lives in `lora.py` / `lte.py`; this class is only
the async plumbing around it — recovery waits, timeouts, and the LTE power
sequence.
"""

from __future__ import annotations

import asyncio
import time

from ..protocol import Transport, pack_frame
from .common import (
    OPCODE_STOP_TEST, POST_STOP_RECOVERY_S, CommandResult, make_result,
)
from .lora import (
    OPCODE_LORA_CW_DEBUG, OPCODE_LORA_MODULATED, OPCODE_LORA_POWER,
    LoraCwParams, LoraModulatedParams, LoraPowerParams, Modem, PaMode,
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
