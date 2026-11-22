import { useMemo } from 'react'
import { useNotify } from './NotifyContext'

/** Long enough to read a few words; a Send is followed by watching the
 *  instruments, not the toast. */
const DUT_TOAST_MS = 2500

/**
 * Feedback for a command the operator sent to the DUT by hand.
 *
 * Commands used to answer only in the log, so a Send that went through looked
 * the same as one that never left. Manual sends only: an automation run
 * reports through its own progress, and a toast per step would bury it.
 * A refusal or a failure stays until dismissed, like any other problem.
 */
export function useDutToast() {
  const notify = useNotify()
  return useMemo(() => ({
    /** Sent and answered ok. */
    sent: (what: string) => notify.success(what, { title: 'DUT', autoHideMs: DUT_TOAST_MS }),
    /** The DUT's reply: ok, or refused with its status. Nothing for no reply
     *  object (the send was skipped). */
    answered: (what: string, r: { ok: boolean; status: number } | null | undefined) => {
      if (!r) return
      if (r.ok) notify.success(what, { title: 'DUT', autoHideMs: DUT_TOAST_MS })
      else notify.warning(`Refused, status ${r.status}`, { title: what })
    },
    failed: (what: string, e: Error) => notify.error(e.message, { title: `${what} failed` }),
  }), [notify])
}
