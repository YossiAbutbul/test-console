"""Test Sequence routes, and the live rig a sequence drives.

    POST /sequence/run       start (409 while any run holds the rig)
    GET  /sequence/status    where it is: steps, the point in hand, a prompt
    GET  /sequence/rows      one step's rows, from index `since`
    POST /sequence/recable   answer a re-cable prompt
    POST /sequence/cancel    Stop

The page polls `status` and re-attaches after a reload: the run lives here.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..ble import manager
from ..device import MAX_TX_POWER_DBM, MODEM_ON_TIMEOUT_S, TX_POWER_SCALE, LteBandwidth, LteTstrfCmd, Modem, PaMode
from ..device.device import Device
from ..sequence import runner
from ..sequence.runner import PAGE_RUN_PREFIX
from ..sequence.models import (
    BlePoint, FreqPoint, FreqStage, LoraCwPoint, LoraModPoint, LteCwPoint, LteModPoint, PowerSource,
    RecableAnswer,
    SequenceIn, SequenceStatus,
)
from ..sequence.rig import BlePowerSet, BleWrite, Reading, TxResult
from ..sweep.models import MIN_SETTLE_MS
from ..freqacc import zoom
from .errors import handle_driver_errors
from .instruments._bus import bus
from .instruments._state import state as instrument_state
from .instruments import measure as instruments_measure
from .runs import refuse_if_running

log = logging.getLogger(__name__)

router = APIRouter(prefix="/sequence", tags=["sequence"])

#: DUT command timeout, as the pages send (device.ts).
_CMD_TIMEOUT_S = 5.0
#: Per-point LTE test duration: only a backstop, since every point aborts its
#: test once measured (LteAutomationPanel CW_TIME_MS / TX_TIME_MS).
_LTE_TIME_MS = 20_000
#: A frequency zoom's: far longer, a 10 Hz RBW sweep alone runs tens of
#: seconds (LTE_CW_TIME_MS in api/freq_accuracy.py).
_LTE_HOLD_MS = 600_000
_BLE_TONE_TIMEOUT_S = 3.0
_BLE_RELINK_S = 30.0

_POINT_MODELS = {
    "power": LoraCwPoint, "modulated": LoraModPoint, "lte-cw": LteCwPoint,
    "lte-modulated": LteModPoint, "ble-cw": BlePoint,
    "freq-accuracy": FreqPoint, "lte-freq-accuracy": FreqPoint,
}


def _tx(r) -> TxResult:
    return TxResult(ok=r.ok, status=r.status)


def _write(r) -> BleWrite:
    return BleWrite(acknowledged=r.acknowledged, ok=r.ok, status=r.status, error=getattr(r, "error", None))


class LiveRig:
    """The bench, through the same calls its routes make.

    The DUT is looked up per command rather than held: the BLE manager builds a
    new Device when it reconnects (see LiveRig in api/loadpull.py).
    """

    @staticmethod
    def _device() -> Device:
        dev = manager.device
        if dev is None:
            raise RuntimeError("DUT not connected")
        return dev

    async def _send(self, send):
        """A keying command, resent once on the new link if the old one dropped."""
        dev = self._device()
        try:
            return await send(dev)
        except Exception as e:
            log.warning("DUT command failed (%s: %s); checking the BLE link", type(e).__name__, e)
            fresh = await manager.wait_for_device(dev)
            return await send(fresh or self._device())

    # LoRa
    async def lora_power(self, freq_hz: int, power_dbm: int, pa_mode: int) -> TxResult:
        return _tx(await self._send(lambda d: d.lora_power(
            freq_hz=freq_hz, power_dbm=power_dbm, pa_mode=PaMode(pa_mode), timeout=_CMD_TIMEOUT_S)))

    async def lora_modulated(self, bandwidth: int, freq_hz: int, power_dbm: int, modem: int, datarate: int) -> TxResult:
        return _tx(await self._send(lambda d: d.lora_modulated(
            bandwidth=bandwidth, freq_hz=freq_hz, power_dbm=power_dbm, modem=Modem(modem),
            datarate=datarate, timeout=_CMD_TIMEOUT_S)))

    async def stop(self) -> None:
        await self._device().stop_test(timeout=_CMD_TIMEOUT_S)

    # LTE
    async def lte_modem_off(self) -> TxResult:
        return _tx(await self._device().lte_modem_off(timeout=_CMD_TIMEOUT_S))

    async def lte_modem_on(self) -> TxResult:
        return _tx(await self._device().lte_modem_on(timeout=MODEM_ON_TIMEOUT_S))

    async def lte_cw(self, earfcn: int, power_dbm: float, start: bool, hold: bool = False) -> TxResult:
        cmd = LteTstrfCmd.START_TX_TEST if start else LteTstrfCmd.ABORT_TEST

        def send(d: Device):
            return d.lte_cw(earfcn=earfcn, time_ms=_LTE_HOLD_MS if hold else _LTE_TIME_MS, tx_power=round(power_dbm * TX_POWER_SCALE),
                            offset_hz=0, tstrf_cmd=cmd, timeout=_CMD_TIMEOUT_S)
        return _tx(await (self._send(send) if start else send(self._device())))

    async def lte_modulated(self, earfcn: int, power_dbm: float, bandwidth: int, mcs: int, rb_count: int,
                            start: bool) -> TxResult:
        cmd = LteTstrfCmd.START_TX_TEST if start else LteTstrfCmd.ABORT_TEST

        def send(d: Device):
            return d.lte_modulated(earfcn=earfcn, time_ms=_LTE_TIME_MS, tx_power=round(power_dbm * TX_POWER_SCALE),
                                   bandwidth=LteBandwidth(bandwidth), mcs=mcs, rb_count=rb_count,
                                   rb_start=0, nb_index=0, tstrf_cmd=cmd, timeout=_CMD_TIMEOUT_S)
        return _tx(await (self._send(send) if start else send(self._device())))

    # BLE -- as the /device/ble routes: the link is let go whenever the DUT
    # goes off it (api/device/ble.py ble_tone, ble_tx_power).
    async def ble_tone(self, channel: int, duration_s: int) -> BleWrite:
        dev = self._device()
        try:
            r = await dev.ble_tone_start(channel=channel, duration_s=duration_s, offset=0,
                                         timeout=_BLE_TONE_TIMEOUT_S)
        finally:
            # Always: the tone may be on air whether or not its reply got out.
            await manager.release()
        return _write(r)

    async def ble_power_get(self) -> Optional[int]:
        return (await self._device().ble_tx_power_get()).param

    async def ble_power_set(self, param: int) -> BlePowerSet:
        dev = self._device()
        set_ = await dev.ble_tx_power_set(param, timeout=_CMD_TIMEOUT_S)
        if not (set_.acknowledged and set_.ok):
            return BlePowerSet(set=_write(set_), reset=None, released=False)
        reset = await dev.save_and_reset(timeout=_CMD_TIMEOUT_S)
        await manager.release()
        return BlePowerSet(set=_write(set_), reset=_write(reset), released=True)

    async def ble_relink(self) -> None:
        await manager.relink(_BLE_RELINK_S)

    # Instruments, through the measure route's function and so its buses.
    async def measure(self, freq_hz: int, power: PowerSource, expected_dbm: Optional[float]) -> Reading:
        s = power.spectrum
        spectrum = power.source == "spectrum"
        m = await instruments_measure(
            freq_hz=freq_hz, source=power.source,
            span_hz=s.span_hz if spectrum else None, rbw_hz=s.rbw_hz if spectrum else None,
            vbw_hz=s.vbw_hz if spectrum else None, detector=s.detector if spectrum else None,
            # The analyzer's reference level; the sensor ignores it.
            expected_dbm=expected_dbm if spectrum else None,
        )
        return Reading(power_dbm=m.power_dbm, current_a=m.current_a, voltage_v=m.voltage_v, error=m.error)

    # The frequency zoom, as api/freq_accuracy.py drives it: the session
    # /instruments holds, on its bus, never a second one on the same stream.
    @staticmethod
    def _analyzer():
        an = instrument_state.spectrum
        if an is None:
            raise RuntimeError("Spectrum analyzer not connected")
        return an

    async def zoom_begin(self) -> None:
        self._analyzer()
        # The zoom changes span, RBW, detector and reference: the next power
        # read must set the analyzer up again rather than trust it.
        instrument_state.spectrum_applied = None

    async def zoom_prepare(self, ref_level_dbm: float) -> None:
        await bus("spectrum").call(zoom.prepare, self._analyzer(), ref_level_dbm, timeout=30.0)

    async def zoom_setup(self, n: int, stage: FreqStage, center_hz: Optional[float]) -> None:
        st = zoom.Stage(stage.span_hz, stage.rbw_hz, stage.vbw_hz)
        await bus("spectrum").call(zoom.setup_stage, self._analyzer(), n, st, center_hz, timeout=30.0)

    async def zoom_measure(self, n: int, center_hz: float, stage: FreqStage) -> dict:
        st = zoom.Stage(stage.span_hz, stage.rbw_hz, stage.vbw_hz)
        r = await bus("spectrum").call(
            zoom.measure_stage, self._analyzer(), n, center_hz, st,
            timeout=zoom.sweep_timeout_s(st.span_hz, st.rbw_hz) + 15.0,
        )
        return {**asdict(r), "warning": zoom.edge_warning(r)}

    async def zoom_end(self) -> None:
        an = instrument_state.spectrum
        if an is None:
            return

        def release() -> None:
            an.set_continuous(True)
            an.read_state()   # the Spectrum page shows what the zoom left

        await bus("spectrum").call(release, timeout=15.0)


def _check_points(seq: SequenceIn) -> None:
    """Every step's points as its test reads them, before anything is keyed: a
    bad point is a 422 now, not an error at step five."""
    for i, step in enumerate(seq.steps):
        model = _POINT_MODELS[step.test]
        try:
            for p in step.points:
                model(**p)
        except ValidationError as e:
            raise HTTPException(422, f"step {i + 1} ({step.label}): {e.errors()[0].get('msg', e)}") from e
        if not step.points:
            raise HTTPException(422, f"step {i + 1} ({step.label}) has no points")
        if step.test in ("freq-accuracy", "lte-freq-accuracy"):
            _check_freq(i, step)


def _check_freq(i: int, step) -> None:
    """As the Frequency accuracy page's own start (api/freq_accuracy.py)."""
    where = f"step {i + 1} ({step.label})"
    if step.freq is None:
        raise HTTPException(422, f"{where}: no zoom stages")
    if step.settle_ms < MIN_SETTLE_MS or step.settle_ms > 10_000:
        raise HTTPException(422, f"{where}: settle must be {MIN_SETTLE_MS}-10000 ms")
    for p in (FreqPoint(**x) for x in step.points):
        if step.test == "lte-freq-accuracy":
            if p.earfcn is None:
                raise HTTPException(422, f"{where}: an LTE point needs an EARFCN")
            if p.power_dbm > MAX_TX_POWER_DBM:
                raise HTTPException(422, f"{where}: LTE power tops out at {MAX_TX_POWER_DBM} dBm")
        elif p.power_dbm != int(p.power_dbm):
            raise HTTPException(422, f"{where}: LoRa power is a whole dBm")


@router.post("/run", response_model=SequenceStatus)
async def run(seq: SequenceIn) -> SequenceStatus:
    # Named as the runner will name it, so a second start of the same page's
    # sweep gets "already in progress" rather than "stop it first".
    page = len(seq.steps) == 1 and seq.steps[0].uid.startswith(PAGE_RUN_PREFIX)
    refuse_if_running(seq.steps[0].label if page else "Test Sequence")
    _check_points(seq)
    with handle_driver_errors("sequence run"):
        return await runner.start(seq, LiveRig())


@router.get("/status", response_model=SequenceStatus)
async def status() -> SequenceStatus:
    return runner.status()


@router.get("/rows")
async def rows(step: str, since: int = 0) -> list[dict]:
    return runner.rows(step, max(0, since))


@router.post("/recable", response_model=SequenceStatus)
async def recable(answer: RecableAnswer) -> SequenceStatus:
    return runner.answer_prompt(answer.seq, answer.ok)


@router.post("/cancel", response_model=SequenceStatus)
async def cancel() -> SequenceStatus:
    return await runner.cancel()
