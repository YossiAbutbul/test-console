"""The DUT's BLE radio, driven by a run: port of `useBleLink.tsx`.

The radio under test is the one carrying our commands, and both of its test
commands take it off the link:

    set_power(p)    TX_POWER_SET -> SAVE_AND_RESET (DUT reboots)
                    -> relink -> TX_POWER_GET (confirms it took)
    ensure_power(p) TX_POWER_GET, then set_power only if it differs
    tone(ch, s)     TEST_TONE_START (DUT on air, off the link)
    finish_tone()   wait out the duration -> relink

A tone cannot be cut short: there is no link to send a stop over, and the DUT
will not take a connection while it transmits. So a run that is stopped still
waits for the tone to end and the DUT to come back.
"""

from __future__ import annotations

from typing import Awaitable, Callable, Optional

from .rig import BleWrite, Rig

#: Past the tone's estimated end before the relink starts.
TONE_END_GRACE_MS = 200


class BleLink:
    def __init__(
        self,
        rig: Rig,
        now_ms: Callable[[], float],
        sleep: Callable[[float], Awaitable[None]],
        note: Callable[[str], None] = lambda _m: None,
    ) -> None:
        self._rig = rig
        self._now_ms = now_ms
        self._sleep = sleep
        self._note = note
        #: The tone power the DUT is on, as last read or confirmed; None when
        #: unknown. Never assumed: a reset in flight makes it unknown.
        self.power: Optional[int] = None
        #: Epoch ms the tone on air ends at, or None.
        self.until_ms: Optional[float] = None

    async def read_power(self) -> Optional[int]:
        self.power = await self._rig.ble_power_get()
        return self.power

    async def set_power(self, param: int) -> None:
        r = await self._rig.ble_power_set(param)
        if not r.released:
            # Refused and nothing reset: the DUT is still on the link, on the
            # power it had.
            if r.set.acknowledged:
                raise RuntimeError(f"tone power {param} refused (status {r.set.status})")
            raise RuntimeError(f"tone power {param} not acknowledged — {r.set.error or 'no reply'}")
        # Unknown until the DUT is back: a reset that did not happen would
        # leave it on the old power with the belief saying otherwise.
        self.power = None
        await self._rig.ble_relink()
        # Confirmed by reading it back -- the DUT's word, not ours.
        read = await self.read_power()
        if read == param:
            return
        if read is not None:
            raise RuntimeError(f"the DUT reports tone power {read} after the reset, not {param}")
        # The read could not be trusted: an acknowledged reset means the set
        # was persisted; an unanswered one is doubtful, and a power that is
        # only maybe set is not one to measure at.
        if r.reset is not None and r.reset.acknowledged and r.reset.ok:
            self.power = param
            return
        raise RuntimeError(f"tone power {param} could not be confirmed after the reset")

    async def ensure_power(self, param: int) -> bool:
        """`set_power` unless the DUT is on `param` already. True when it reset."""
        known = self.power if self.power is not None else await self.read_power()
        if known == param:
            return False
        await self.set_power(param)
        return True

    async def tone(self, channel: int, duration_s: int) -> BleWrite:
        # The tone's end, estimated from before the request: it is on air as
        # soon as the frame lands, and an estimate that runs late can only
        # relink a moment early, where one that runs short would try to
        # connect to a DUT still on air.
        sent_at = self._now_ms()
        r = await self._rig.ble_tone(channel, duration_s)
        if r.acknowledged and not r.ok:
            # Refused: nothing on air, but the link was let go regardless.
            await self._rig.ble_relink()
            raise RuntimeError(f"tone refused (status {r.status})")
        self.until_ms = sent_at + duration_s * 1000
        return r

    async def finish_tone(self) -> None:
        """Wait for the tone on air to end, then relink. A no-op with none.
        Not stoppable: the DUT transmits until its duration runs out."""
        until = self.until_ms
        if until is None:
            return
        wait = until + TONE_END_GRACE_MS - self._now_ms()
        if wait > 0:
            await self._sleep(wait / 1000)
        self.until_ms = None
        await self._rig.ble_relink()
