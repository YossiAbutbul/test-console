import { Box, MenuItem, Stack, Typography } from '@mui/material'
import { FieldGrid, SegmentedChoice, TEXT } from '../ui'
import { LabeledField } from './LabeledField'
import { DETECTOR_NAMES } from '../api/spectrum'
import {
  SPECTRUM_DETECTORS, khzToHz, type PowerSource, type PowerSourceState,
} from '../lib/powerSource'

const SOURCES: { value: PowerSource; label: string }[] = [
  { value: 'sensor', label: 'Power sensor' },
  { value: 'spectrum', label: 'Spectrum analyzer' },
]

/**
 * What reads TX power on a test, and the analyzer's settings when it is the
 * analyzer. One component for every page that measures power, so the choice
 * reads and sits the same everywhere: inside the page's Measure section,
 * beside what it qualifies.
 *
 * The analyzer fields are always laid out, dimmed and inert while the sensor
 * is chosen, rather than appearing with the analyzer: a section that came and
 * went pushed everything under it up and down the page with each switch. A
 * line under them says what the dimming means, so it does not read as
 * broken. No centre (each step's own frequency) and no offset (zeroed by the
 * read: path loss is added in software), as in Mode Sweep.
 *
 * `disabled` covers a run in progress and "Measure power" unchecked alike.
 */
export function PowerSourceFields({ value, onChange, disabled, compact }: {
  value: PowerSourceState
  onChange: (next: PowerSourceState) => void
  disabled?: boolean
  /** One row: the choice, then the analyzer's four fields beside it, without
   *  the line under them -- for a Test Sequence step, where room is short. */
  compact?: boolean
}) {
  const spectrum = value.source === 'spectrum'
  const fieldsOff = disabled || !spectrum
  const set = (patch: Partial<PowerSourceState>) => onChange({ ...value, ...patch })
  const khz = (key: 'spanKhz' | 'rbwKhz' | 'vbwKhz', label: string) => (
    <LabeledField
      label={label}
      hint="kHz"
      type="number"
      value={value[key]}
      onChange={(e) => set({ [key]: e.target.value })}
      // Only a wrong value the run would use is an error: a stray entry
      // while the sensor reads power stops nothing.
      error={spectrum && khzToHz(value[key]) == null}
      disabled={fieldsOff}
    />
  )
  if (compact) {
    return (
      <Box
        sx={{
          // Top-aligned, labels on one line and controls on the next, the
          // shape of every other row of fields in a sequence step.
          display: 'grid', columnGap: 1.5, rowGap: 1, alignItems: 'start',
          gridTemplateColumns: 'auto repeat(4, minmax(88px, 1fr))',
          '@container (max-width: 640px)': { gridTemplateColumns: 'repeat(4, minmax(80px, 1fr))', '& > :first-of-type': { gridColumn: '1 / -1' } },
        }}
      >
        {/* Labelled as LabeledField labels its fields (and the sweep its
            columns), so the row's labels read as one line. */}
        <Stack spacing={0.5}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap' }}>Power from</Typography>
          {/* The fields' height (32), not the heading controls' (28). */}
          <SegmentedChoice
            text size="md" aria-label="Power from" value={value.source} options={SOURCES}
            onChange={(v) => set({ source: v })} disabled={disabled}
          />
        </Stack>
        {/* Dimmed, not hidden, with the sensor chosen: the row keeps its
            shape whichever reads power. */}
        <Box sx={{ display: 'contents', '& > *': { opacity: spectrum ? 1 : 0.55, transition: 'opacity 160ms ease-out' } }}>
          {khz('spanKhz', 'Span')}
          {khz('rbwKhz', 'RBW')}
          {khz('vbwKhz', 'VBW')}
          <LabeledField
            label="Detector"
            select
            value={value.detector}
            onChange={(e) => set({ detector: e.target.value })}
            disabled={fieldsOff}
          >
            {SPECTRUM_DETECTORS.map((d) => (
              <MenuItem key={d} value={d}>{DETECTOR_NAMES[d] ?? d}</MenuItem>
            ))}
          </LabeledField>
        </Box>
      </Box>
    )
  }
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
        <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>Power from</Typography>
        <SegmentedChoice
          text aria-label="Power from" value={value.source} options={SOURCES}
          onChange={(v) => set({ source: v })} disabled={disabled}
        />
      </Stack>
      <Box sx={{ opacity: spectrum ? 1 : 0.55, transition: 'opacity 160ms ease-out' }}>
        <FieldGrid columns={4} wide>
          {khz('spanKhz', 'Span')}
          {khz('rbwKhz', 'RBW')}
          {khz('vbwKhz', 'VBW')}
          <LabeledField
            label="Detector"
            select
            value={value.detector}
            onChange={(e) => set({ detector: e.target.value })}
            disabled={fieldsOff}
          >
            {SPECTRUM_DETECTORS.map((d) => (
              <MenuItem key={d} value={d}>{DETECTOR_NAMES[d] ?? d}</MenuItem>
            ))}
          </LabeledField>
        </FieldGrid>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mt: 0.75 }}>
          {spectrum
            ? 'Analyzer centred on each step’s frequency; path loss is added in software.'
            : 'Analyzer settings, used when power is read from the spectrum analyzer.'}
        </Typography>
      </Box>
    </Stack>
  )
}
