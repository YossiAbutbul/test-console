import { Box, Button, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { DASH, fmt } from '../../lib/format'
import { HazardGlyph, KeySpinner, MONO, ModalShell, TEXT, hazardRingSx } from '../../ui'
import { efficiency, vswrLabel } from './smith'

/** What a remeasure is doing, from the run's phase. */
const PHASE_TEXT: Record<string, string> = {
  modem: 'Restarting the modem',
  moving: 'Moving the trombone',
  vna: 'Reading the VNA',
  measuring: 'Measuring',
  attenuator: 'Waiting for the attenuator',
}

interface Props {
  /** The saved row being remeasured, and its index in the results. */
  idx: number | null
  row: LoadPullResultRow | null
  /** The new reading, once taken. */
  fresh: LoadPullResultRow | null
  /** A remeasure is under way, and what it is doing. */
  busy: boolean
  phase: string | null
  /** Why the result could not be taken (stopped, failed), or null. */
  error: string | null
  /** Why Remeasure is unavailable right now, or null. */
  blocked: string | null
  goToBusy: boolean
  goToBlocked: string | null
  /** True while a run is on: the dialog stops below the toolbar. */
  keepToolbar?: boolean
  onGoTo: () => void
  onRemeasure: () => void
  onReplace: () => void
  onClose: () => void
}

const mA = (a: number | null | undefined) => (a == null ? null : a * 1000)
const pct = (e: number | null) => (e == null ? null : e * 100)
const z = (r: LoadPullResultRow | null) =>
  !r || r.r_ohm == null || r.x_ohm == null ? DASH
    : `${r.r_ohm.toFixed(1)} ${r.x_ohm >= 0 ? '+' : '−'} j${Math.abs(r.x_ohm).toFixed(1)}`

/**
 * Remeasure one point of a run: drive the trombone back to it and take it
 * again at the settings it was taken at.
 *
 * For a point an instrument upset mid-run -- a bad VNA read leaves it off the
 * curve on the Smith chart. The new reading is shown beside the saved one and
 * replaces it only on Use new, so a remeasure that comes out no better (or
 * worse) costs nothing. Go to position only moves the trombone, for looking at
 * the load on the VNA first.
 */
export function RemeasureDialog({
  idx, row, fresh, busy, phase, error, blocked, goToBusy, goToBlocked, keepToolbar,
  onGoTo, onRemeasure, onReplace, onClose,
}: Props) {
  const open = idx != null && row != null
  const lines: Array<{ label: string; unit: string; saved: string; next: string }> = [
    { label: 'Pout', unit: 'dBm', saved: fmt(row?.power_dbm ?? null, 2), next: fmt(fresh?.power_dbm ?? null, 2) },
    { label: 'CC', unit: 'mA', saved: fmt(mA(row?.current_a), 1), next: fmt(mA(fresh?.current_a), 1) },
    { label: 'Eff', unit: '%', saved: fmt(row ? pct(efficiency(row)) : null, 1), next: fmt(fresh ? pct(efficiency(fresh)) : null, 1) },
    { label: 'Z', unit: 'Ω', saved: z(row), next: z(fresh) },
    { label: 'S11', unit: 'dB', saved: fmt(row?.s11_db ?? null, 2), next: fmt(fresh?.s11_db ?? null, 2) },
    { label: 'VSWR', unit: '', saved: row ? vswrLabel(row) : DASH, next: fresh ? vswrLabel(fresh) : DASH },
  ]
  // The point's settings, as one line under the title: what it will be taken
  // at, read once, not a block of label rows above the figures.
  const settings = row ? [
    `${row.pos_mm.toFixed(2)} mm`,
    row.earfcn != null ? `EARFCN ${row.earfcn}` : `${fmt(row.freq_mhz ?? null, 3)} MHz`,
    `${fmt(row.power_dbm_setting ?? null, 0)} dBm`,
    ...(row.att_db != null ? [`att ${row.att_db} dB`] : []),
  ].join(' · ') : ''
  // One line under the table that is always there: what is happening, what
  // went wrong, or why the key is off -- so the dialog keeps its height.
  const status = busy ? `${PHASE_TEXT[phase ?? ''] ?? 'Starting'}…`
    : error ? error
      : blocked ?? (fresh ? 'New reading taken. Use it, or remeasure again.' : 'Takes the point again at its own settings.')
  const statusColor = busy ? 'info.main' : error ? 'error.main' : blocked ? 'warning.main' : 'text.secondary'

  return (
    <ModalShell
      open={open}
      // Not closable mid-measure: the reading would land with no dialog to
      // show it. Stop (in the toolbar) ends it.
      onClose={busy ? undefined : onClose}
      title={idx != null ? `Remeasure point #${idx + 1}` : 'Remeasure'}
      subtitle={<Box component="span" sx={{ fontFamily: MONO }}>{settings}</Box>}
      maxWidth="xs"
      dividers
      keepToolbar={keepToolbar}
      footer={{
        leading: (
          <Button
            size="small" variant="outlined"
            startIcon={goToBusy ? <KeySpinner /> : <HazardGlyph kind="move" sx={{ fontSize: 16 }} />}
            onClick={onGoTo}
            disabled={busy || goToBusy || goToBlocked != null}
            title={goToBlocked ?? 'Move the trombone to this point, without measuring'}
            sx={hazardRingSx('move')}
          >
            Go to position
          </Button>
        ),
        secondary: (
          <Button variant={fresh ? 'outlined' : 'contained'} onClick={onRemeasure} disabled={busy || blocked != null}
            startIcon={busy ? <KeySpinner /> : undefined}
          >
            {fresh ? 'Again' : 'Remeasure'}
          </Button>
        ),
        primary: fresh ? (
          <Button variant="contained" onClick={onReplace} disabled={busy}>Use new</Button>
        ) : (
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>Close</Button>
        ),
      }}
    >
      {/* Saved beside New in one inset group, a hairline between readings,
          as the settings sheets are laid out. New stays laid out while empty,
          so the dialog does not grow when the reading lands; a new figure
          that differs from the saved one is marked, so what moved is seen
          without comparing digit by digit. */}
      <Box sx={(t) => ({ borderRadius: '10px', bgcolor: alpha(t.palette.text.primary, 0.04), px: 1.5, py: 0.5 })}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto auto', columnGap: 2.5, alignItems: 'center' }}>
          <Box />
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', textAlign: 'right', py: 0.75 }}>Saved</Typography>
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', textAlign: 'right', py: 0.75, minWidth: 104 }}>New</Typography>
          {lines.map((l) => {
            const moved = fresh != null && l.next !== l.saved
            const cell = { py: 0.875, borderTop: 1, borderColor: 'divider' }
            return (
              <Box key={l.label} sx={{ display: 'contents' }}>
                <Typography sx={{ ...cell, fontSize: 12.5 }}>
                  {l.label}
                  {l.unit && <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>[{l.unit}]</Box>}
                </Typography>
                <Typography sx={{ ...cell, fontSize: 12.5, fontFamily: MONO, textAlign: 'right', color: 'text.secondary' }}>
                  {l.saved}
                </Typography>
                <Typography
                  sx={{
                    ...cell, fontSize: 12.5, fontFamily: MONO, textAlign: 'right', whiteSpace: 'nowrap',
                    fontWeight: moved ? 700 : 400,
                    color: !fresh ? 'text.disabled' : moved ? 'info.main' : 'text.primary',
                  }}
                >
                  {moved && <Box component="span" sx={{ fontFamily: 'inherit', mr: 0.5, opacity: 0.7 }}>→</Box>}
                  {fresh ? l.next : DASH}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Box>
      {(row?.error || fresh?.error) && (
        <Stack spacing={0.25} sx={{ mt: 1.5 }}>
          {row?.error && <Typography sx={{ ...TEXT.micro, color: 'error.main' }}>Saved: {row.error}</Typography>}
          {fresh?.error && <Typography sx={{ ...TEXT.micro, color: 'error.main' }}>New: {fresh.error}</Typography>}
        </Stack>
      )}

      <Typography sx={{ ...TEXT.micro, color: statusColor, mt: 1.5, minHeight: 16 }}>{status}</Typography>
    </ModalShell>
  )
}
