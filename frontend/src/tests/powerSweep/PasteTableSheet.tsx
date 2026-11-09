import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Popover, Stack, TextField, Typography } from '@mui/material'
import { MONO, PRESS_SX, TEXT } from '../../ui'
import { formatDuration } from '../../lib/async'
import type { BlockDraft, Bounds } from './blocks'
import { configTableBlocks, parseConfigTable } from './configTable'

const PA_NAMES = ['Off', 'On', 'Auto']

/**
 * Paste a configuration table as the advanced ranges: one single-step range
 * per row, each with its own PA mode, so the table reruns as written.
 *
 * A sheet rather than a straight read of the clipboard: the rows are about
 * to drive the PA, so the operator sees what was read -- how many, how many
 * with the PA on, and any row that is wrong -- before it replaces the plan.
 * The clipboard is read into the box on open when the browser allows it;
 * otherwise Ctrl+V into the box does the same.
 */
export function PasteTableSheet({
  anchor, onClose, bounds, replacing, estimateMs, onUse,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  bounds: Bounds
  /** Ranges the paste would replace, for the note under the summary. */
  replacing: number
  estimateMs: (steps: number) => number
  onUse: (blocks: BlockDraft[]) => void
}) {
  const [text, setText] = useState('')
  const open = !!anchor

  useEffect(() => {
    if (!open) return
    let live = true
    // Permission-gated and absent outside a secure context; a refusal just
    // leaves the box empty for a manual paste.
    navigator.clipboard?.readText?.()
      .then((t) => { if (live && t && parseConfigTable(t, bounds).rows.length) setText(t) })
      .catch(() => {})
    return () => { live = false }
  }, [open, bounds])

  const parsed = useMemo(() => parseConfigTable(text, bounds), [text, bounds])
  const n = parsed.rows.length
  const byMode = [0, 1, 2].map((m) => parsed.rows.filter((r) => r.paMode === m).length)
  const usable = n > 0 && parsed.errors.length === 0

  const summary = n === 0
    ? 'Paste rows copied from Excel: PA mode, Power (Set), PA DC, HP Max.'
    : [
        `${n} configuration${n === 1 ? '' : 's'}`,
        ...byMode.map((c, m) => (c ? `PA ${PA_NAMES[m]} ${c}` : '')).filter(Boolean),
      ].join(' · ')

  const close = () => { setText(''); onClose() }

  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            mt: 0.75, width: 460, p: 2, borderRadius: '12px', border: 1, borderColor: 'divider',
            boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
          },
        },
      }}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
        Paste configuration table
      </Typography>
      <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mb: 1.5 }}>
        Each row runs once, with its own PA mode. Measured columns are ignored.
      </Typography>

      <TextField
        multiline
        autoFocus
        fullWidth
        minRows={6}
        maxRows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Target [dBm]\tPA mode\tPower (Set)\tPA DC\tHP Max\n0\tOff\t16\t3\t1\n20\tOn\t1\t4\t1'}
        inputProps={{ 'aria-label': 'Configuration table', spellCheck: false }}
        sx={{
          // Tabs as wide as the longest header ("Target [dBm]"), so the
          // pasted columns line up under their names.
          '& textarea': {
            fontFamily: MONO, fontSize: 12, lineHeight: '18px',
            whiteSpace: 'pre', overflowX: 'auto', tabSize: 14,
          },
        }}
      />

      {/* Fixed two lines whatever the state, so the sheet does not resize as
          the table goes from empty to read to wrong. */}
      <Box sx={{ mt: 1.25, minHeight: 36 }}>
        <Typography noWrap sx={{ fontSize: 13, color: n ? 'text.primary' : 'text.secondary' }}>
          {summary}
          {usable && (
            <Box component="span" sx={{ color: 'text.secondary' }}> · ≈ {formatDuration(estimateMs(n))}</Box>
          )}
        </Typography>
        <Typography noWrap sx={{ ...TEXT.micro, color: parsed.errors.length ? 'error.main' : 'text.disabled', mt: 0.25 }}>
          {parsed.errors.length
            ? parsed.errors[0] + (parsed.errors.length > 1 ? ` (+${parsed.errors.length - 1} more)` : '')
            : replacing ? `Replaces the ${replacing} current range${replacing === 1 ? '' : 's'}.` : ' '}
        </Typography>
      </Box>

      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.25 }}>
        <Button size="small" onClick={close} sx={{ ...PRESS_SX, height: 32 }}>Cancel</Button>
        <Button
          size="small" variant="contained" disableElevation
          disabled={!usable}
          onClick={() => { onUse(configTableBlocks(parsed.rows, bounds)); close() }}
          sx={{ ...PRESS_SX, height: 32, minWidth: 132 }}
        >
          Use {usable ? n : ''} row{n === 1 ? '' : 's'}
        </Button>
      </Stack>
    </Popover>
  )
}
