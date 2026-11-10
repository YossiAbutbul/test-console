import { MenuItem, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { LabeledField } from '../../components/LabeledField'
import type { FreqPointStatus } from '../../api/freqAccuracy'
import {
  FieldGrid, HeadCell, MONO, NUM_CELL_SX, Section, StatRow, StatTile, TEXT,
} from '../../ui'
import { MeasureSection, type MeasureSettings } from './MeasureSection'
import { formatErrorHz, formatHz, formatMhzToHz, mhzToHz, ppmVerdict } from './stages'

export interface ManualSettings {
  freqMhz: number
  power: number
  paMode: number
}

/**
 * One carrier, measured once: what to transmit, how to measure it, then the
 * answer and how each stage got there -- top-down, as on the CW page.
 */
export function ManualPanel({
  value, onChange, measure, onMeasureChange, limitPpm, point, phase, outcome, failed, disabled,
}: {
  value: ManualSettings
  onChange: (next: ManualSettings) => void
  measure: MeasureSettings
  onMeasureChange: (next: MeasureSettings) => void
  limitPpm: number | null
  /** This tab's last (or current) point, null before the first. */
  point: FreqPointStatus | null
  /** What the run is doing, while it runs. */
  phase: string | null
  /** How it ended, when it did not end with a reading. */
  outcome: string | null
  failed: boolean
  disabled: boolean
}) {
  const set = (patch: Partial<ManualSettings>) => onChange({ ...value, ...patch })
  const result = point?.result ?? null
  const done = point?.stages ?? []
  const stageCount = Math.max(measure.stages.length, done.length)
  const verdict = ppmVerdict(result?.error_ppm, limitPpm)
  const last = done[done.length - 1]
  const status = phase ?? outcome ?? point?.warnings[0] ?? null

  return (
    <>
      <Section title="Transmit" panel>
        <FieldGrid>
          <LabeledField label="Frequency" hint="MHz" type="number" value={value.freqMhz}
            disabled={disabled} inputProps={{ step: 0.1 }}
            onChange={(e) => set({ freqMhz: Number(e.target.value) })} />
          <LabeledField label="Power" hint="dBm" type="number" value={value.power}
            disabled={disabled} onChange={(e) => set({ power: Number(e.target.value) })} />
          <LabeledField label="PA mode" select value={value.paMode} disabled={disabled}
            onChange={(e) => set({ paMode: Number(e.target.value) })}>
            <MenuItem value={2}>Auto</MenuItem>
            <MenuItem value={1}>On</MenuItem>
            <MenuItem value={0}>Off</MenuItem>
          </LabeledField>
        </FieldGrid>
      </Section>

      <MeasureSection value={measure} onChange={onMeasureChange} disabled={disabled} />

      <Section title="Measurement" panel
        action={
          <Typography role="status" title={status ?? undefined} sx={{
            ...TEXT.hint, fontWeight: 600,
            color: failed ? 'error.main' : !phase && point?.warnings.length ? 'warning.main' : 'text.secondary',
            minWidth: 0, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {status}
          </Typography>
        }
      >
        <StatRow inCard minTile={150}>
          <StatTile primary label="Measured" unit="MHz"
            value={result ? formatMhzToHz(result.measured_hz) : '—'}
            sub={result ? `nominal ${(result.nominal_hz / 1e6).toFixed(6)} MHz` : 'not measured yet'} />
          <StatTile label="Frequency error" unit="Hz"
            value={result ? formatErrorHz(result.error_hz) : '—'}
            tone={verdict === 'fail' ? 'bad' : verdict === 'pass' ? 'ok' : undefined}
            sub={result ? `≈ ${formatHz(last.span_hz / 1000)} per trace bin` : ' '} />
          <StatTile label="Error in ppm" unit="ppm"
            value={result ? `${result.error_ppm >= 0 ? '+' : '−'}${Math.abs(result.error_ppm).toFixed(3)}` : '—'}
            tone={verdict === 'fail' ? 'bad' : verdict === 'pass' ? 'ok' : undefined}
            sub={verdict ? `${verdict === 'pass' ? 'within' : 'outside'} ± ${limitPpm} ppm` : ' '} />
          <StatTile label="Level at analyzer" unit="dBm"
            value={last?.level_dbm != null ? last.level_dbm.toFixed(1) : '—'}
            sub={result ? `ref level ${result.ref_level_dbm} dBm` : ' '} />
        </StatRow>
      </Section>

      <Section title="Stages measured" panel>
        {/* No rule under the last row: the card's own edge closes the table,
            and a hairline just above it read as a second border. */}
        <Table size="small" sx={{ '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
          <TableHead>
            <TableRow>
              <HeadCell label="Stage" />
              <HeadCell label="Centre" unit="MHz" numeric />
              <HeadCell label="Span" numeric />
              <HeadCell label="RBW" numeric />
              <HeadCell label="Peak" unit="MHz" numeric />
              <HeadCell label="Moved" unit="Hz" numeric />
              <HeadCell label="Level" unit="dBm" numeric />
            </TableRow>
          </TableHead>
          <TableBody>
            {/* One row per stage whether measured yet or not, so the table
                does not grow as the run fills it in. */}
            {Array.from({ length: stageCount }, (_, i) => {
              const r = done[i]
              const plan = measure.stages[i]
              return (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r ? mhzToHz(r.center_hz) : ''}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{formatHz(r?.span_hz ?? plan?.span_hz ?? 0)}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{formatHz(r?.rbw_hz ?? plan?.rbw_hz ?? 0)}</TableCell>
                  <TableCell sx={{ ...NUM_CELL_SX, fontFamily: MONO, color: r?.at_edge ? 'warning.main' : undefined }}>
                    {r ? mhzToHz(r.marker_hz) : ''}
                  </TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r ? formatErrorHz(r.shift_hz) : ''}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r?.level_dbm != null ? r.level_dbm.toFixed(1) : ''}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Section>
    </>
  )
}
