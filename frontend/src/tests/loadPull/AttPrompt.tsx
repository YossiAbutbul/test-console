import { useCallback, useRef, useState } from 'react'
import {
  Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, InputBase, Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import TuneIcon from '@mui/icons-material/TuneRounded'
import { MONO, PRESS_SX, TEXT } from '../../ui'
import { TOP_BAR_H } from '../../ui/tokens'

/** The attenuator's range -- ATT_MAX_LIMIT_DB on the Load Pull page. */
const ATT_MAX_DB = 20
/** Upcoming settings offered as chips; the rest can still be typed. */
const MAX_CHIPS = 8

interface Pending {
  db: number
  cycle: number
  cycles: number
  upcoming: number[]
  resolve: (answer: AttAnswer) => void
}

/** Whether to go on, and the setting dialled in when it is not the one asked
 *  for (null: as asked). */
export interface AttAnswer {
  proceed: boolean
  db: number | null
}

/** A typed setting, or null while empty or not a whole dB in range. */
function parseDb(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 0 && n <= ATT_MAX_DB ? n : null
}

/**
 * Ask the operator to set the attenuator, and wait.
 *
 * The attenuator on the trombone's second output is manual, so a sweep over it
 * cannot be driven — the run has to stop at each step, say what to dial in, and
 * continue only once someone confirms. The value is taken on trust: nothing on
 * the bench can read back what was actually set.
 *
 * The value is a field rather than a figure: mid-run the operator may not want
 * the whole range. A later setting of the sweep jumps to it, passing over the
 * cycles between; any other runs this cycle only, recorded as what it was.
 */
export function useAttPrompt() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState('')
  const pendingRef = useRef<Pending | null>(null)

  const ask = useCallback(
    (db: number, cycle: number, cycles: number, upcoming: number[] = []) => new Promise<AttAnswer>((resolve) => {
      const p = { db, cycle, cycles, upcoming, resolve }
      pendingRef.current = p
      setText(String(db))
      setPending(p)
    }),
    [],
  )

  const settle = (answer: AttAnswer) => {
    pendingRef.current?.resolve(answer)
    pendingRef.current = null
    setPending(null)
  }

  /** Resolve anything still waiting — a Stop must not leave the run parked. */
  const cancel = useCallback(() => {
    pendingRef.current?.resolve({ proceed: false, db: null })
    pendingRef.current = null
    setPending(null)
  }, [])

  const typed = parseDb(text)
  const asked = pending?.db ?? 0
  const jumpBy = typed == null ? -1 : (pending?.upcoming.indexOf(typed) ?? -1)
  const confirm = () => {
    if (typed == null) return
    settle({ proceed: true, db: typed === asked ? null : typed })
  }
  // What the typed value will do, in one line that is always there, so the
  // dialog keeps its height while typing.
  const effect = typed == null ? `A whole number, 0 to ${ATT_MAX_DB} dB`
    : typed === asked ? 'As planned'
      : jumpBy === 0 ? `Next in the sweep (${asked} dB skipped)`
        : jumpBy > 0 ? `Jumps ahead, skipping ${jumpBy + 1} settings`
          : 'This cycle only, then the sweep carries on'

  const upcoming = pending?.upcoming ?? []

  const dialog = (
    <Dialog
      open={pending != null}
      // No backdrop or Escape dismissal: closing this by accident would let the
      // sweep carry on measuring at the previous attenuation.
      disableEscapeKeyDown
      onClose={(_e, reason) => { if (reason === 'backdropClick') return }}
      maxWidth="xs"
      fullWidth
      // Below the toolbar, scrim included. This only ever opens mid-run, and a
      // full-window scrim hid E-STOP and Stop behind it -- both of which
      // answer this prompt themselves (they cancel it). Focus is not held
      // inside, so the keyboard can reach them too.
      sx={{ top: TOP_BAR_H }}
      disableEnforceFocus
      slotProps={{ backdrop: { sx: { top: TOP_BAR_H } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        <TuneIcon sx={{ fontSize: 20, color: 'warning.main' }} />
        <Typography sx={TEXT.dialog}>Set the attenuator</Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25} alignItems="center" sx={{ py: 1 }}>
          <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
            Change the configurable attenuator to
          </Typography>
          {/* The figure itself is the field: selected on open, so typing
              replaces it, and Enter confirms. */}
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <InputBase
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
              inputProps={{ inputMode: 'numeric', 'aria-label': 'Attenuator setting (dB)' }}
              sx={(t) => ({
                width: 112, fontFamily: MONO, fontSize: 40, fontWeight: 700, lineHeight: 1,
                borderRadius: '10px', bgcolor: alpha(t.palette.text.primary, 0.05),
                boxShadow: `inset 0 0 0 1.5px ${typed == null ? t.palette.error.main : 'transparent'}`,
                '&.Mui-focused': {
                  boxShadow: `inset 0 0 0 1.5px ${typed == null ? t.palette.error.main : t.palette.primary.main}`,
                },
                '& input': { textAlign: 'center', py: 0.75, px: 1, fontVariantNumeric: 'tabular-nums' },
              })}
            />
            <Box sx={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: 'text.secondary' }}>dB</Box>
          </Stack>
          <Typography
            sx={{ ...TEXT.micro, minHeight: 16, color: typed == null ? 'error.main' : typed === asked ? 'text.disabled' : 'info.main' }}
          >
            {effect}
          </Typography>

          {/* The rest of the sweep, a press away. Always the same rows, so the
              dialog does not change size as the run goes on. */}
          {upcoming.length > 0 && (
            <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" useFlexGap flexWrap="wrap">
              <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>Later</Typography>
              {upcoming.slice(0, MAX_CHIPS).map((v) => (
                <ButtonBase
                  key={v}
                  onClick={() => setText(String(v))}
                  aria-pressed={typed === v}
                  sx={(t) => ({
                    ...PRESS_SX,
                    minWidth: 32, height: 24, px: 0.75, borderRadius: '6px',
                    fontFamily: MONO, fontSize: 12, fontWeight: 600,
                    bgcolor: typed === v ? t.palette.primary.main : alpha(t.palette.text.primary, 0.06),
                    color: typed === v ? t.palette.primary.contrastText : 'text.primary',
                    '&:hover': { bgcolor: typed === v ? t.palette.primary.main : alpha(t.palette.text.primary, 0.1) },
                  })}
                >
                  {v}
                </ButtonBase>
              ))}
              {upcoming.length > MAX_CHIPS && (
                <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>…</Typography>
              )}
            </Stack>
          )}

          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', textAlign: 'center' }}>
            cycle {(pending?.cycle ?? 0) + 1} of {pending?.cycles ?? 0}
            {' · '}the switch is on the VNA so you can watch it take effect
            <br />
            the trombone returns to the start and the run continues when you
            confirm
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => settle({ proceed: false, db: null })} color="inherit">Stop run</Button>
        <Button onClick={confirm} variant="contained" disabled={typed == null}>Attenuator is set</Button>
      </DialogActions>
    </Dialog>
  )

  return { dialog, ask, cancel }
}
