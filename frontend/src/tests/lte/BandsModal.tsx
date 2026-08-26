import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Stack, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import {
  DEFAULT_BANDS, KNOWN_BANDS, bandRangeMhz, uplinkFromMhz,
} from '../../lib/earfcn'
import { MONO, TEXT } from '../../ui'

interface Props {
  open: boolean
  onClose: () => void
  bands: number[]
  onSave: (bands: number[]) => void
}

/**
 * Which uplink bands this rig tests.
 *
 * This exists because EARFCN → frequency is one-to-one but frequency → EARFCN
 * is not: uplink bands overlap, so 1880 MHz is a real channel in bands 2, 25
 * and 39 at once, with a different EARFCN in each. Narrowing to the bands
 * actually in use is what lets a frequency name one channel.
 *
 * So this is not a list of frequencies to maintain by hand. Every channel in a
 * selected band is available the moment the band is ticked, computed from the
 * 3GPP formula rather than typed in — which is also why it cannot drift out of
 * step with the standard.
 */
export function BandsModal({ open, onClose, bands, onSave }: Props) {
  const [draft, setDraft] = useState<number[]>(bands)

  // Reload from props on the open→ rising edge rather than in an effect, so a
  // cancelled edit is really discarded and no stale draft is painted first.
  // Same pattern as PathLossModal.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(bands)
  }

  const toggle = (band: number) =>
    setDraft((d) => (d.includes(band) ? d.filter((b) => b !== band) : [...d, band].sort((a, b) => a - b)))

  /**
   * Frequencies covered by more than one selected band.
   *
   * Overlapping selections put the ambiguity straight back: with 2 and 25 both
   * ticked, 1880 MHz has two answers and the frequency input has to refuse it.
   * Better to say so here, while it is still a setting, than at the point
   * somebody is trying to start a sweep.
   */
  const overlaps = (): string[] => {
    const out: string[] = []
    for (let i = 0; i < draft.length; i++) {
      for (let j = i + 1; j < draft.length; j++) {
        const a = bandRangeMhz(draft[i])
        const b = bandRangeMhz(draft[j])
        if (!a || !b) continue
        const lo = Math.max(a.lo, b.lo)
        const hi = Math.min(a.hi, b.hi)
        // Only a real clash if a channel centre actually lands in both.
        if (lo <= hi && uplinkFromMhz(lo, [draft[i], draft[j]]).length > 1) {
          out.push(`B${draft[i]} and B${draft[j]} both cover ${lo}–${hi} MHz`)
        }
      }
    }
    return out
  }
  const clashes = overlaps()

  const save = () => {
    onSave([...draft].sort((a, b) => a - b))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 620 }}>Bands in use</Typography>
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              Narrows what a frequency in MHz can mean. Every channel in a ticked
              band is available — nothing to enter by hand.
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {clashes.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5, fontSize: 13 }}>
            <Box sx={{ fontWeight: 600, mb: 0.25 }}>Overlapping bands selected</Box>
            {clashes.map((c) => <Box key={c}>{c}</Box>)}
            <Box sx={{ mt: 0.5 }}>
              A frequency in the shared span has more than one EARFCN, so it will
              be refused until one of the bands is unticked.
            </Box>
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            columnGap: 2,
          }}
        >
          {KNOWN_BANDS.map((band) => {
            const r = bandRangeMhz(band)
            const on = draft.includes(band)
            return (
              <Stack
                key={band}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  py: 0.25,
                  cursor: 'pointer',
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                onClick={() => toggle(band)}
              >
                <Checkbox size="small" checked={on} sx={{ p: 0.5 }} />
                <Typography sx={{ fontSize: 13, fontWeight: on ? 600 : 400, minWidth: 40 }}>
                  B{band}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: 'text.secondary' }}>
                  {r ? `${r.lo}–${r.hi} MHz` : ''}
                </Typography>
              </Stack>
            )
          })}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25 }}>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mr: 'auto' }}>
          {draft.length} band{draft.length === 1 ? '' : 's'} selected
        </Typography>
        <Button size="small" color="inherit" onClick={() => setDraft(DEFAULT_BANDS)}>
          Reset
        </Button>
        <Button size="small" color="inherit" onClick={onClose}>Cancel</Button>
        <Button size="small" variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
