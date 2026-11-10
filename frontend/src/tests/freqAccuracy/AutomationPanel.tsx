import { useState } from 'react'
import {
  Box, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import { useConnection } from '../../context/ConnectionContext'
import { downloadCsv, exportName } from '../../lib/download'
import { selectOnFocus } from '../../lib/selectOnFocus'
import {
  FAIL_ROW_SX, HeadCell, MONO, MiniAction, NUM_CELL_SX, Section, TEXT, VerdictMark, VerdictTally,
  type VerdictFilter,
} from '../../ui'
import { MeasureSection, type MeasureSettings } from './MeasureSection'
import {
  DEFAULT_ROWS, PA_MODE_LABEL, formatErrorHz, mhzToHz, planPoints, ppmVerdict, rowFreqs, rowPower, type PlanRow,
} from './stages'

/** One measured point, as kept between visits and exported. */
export interface AutoResult {
  freqMhz: number
  power: number
  paMode: number
  measuredHz: number | null
  errorHz: number | null
  errorPpm: number | null
  levelDbm: number | null
  /** Why there is no reading, or what to be wary of in the one there is. */
  note: string
}

const COLS = 'minmax(180px, 2fr) minmax(90px, 1fr) minmax(100px, 1fr) 32px'

const CSV_HEADER = [
  'Frequency [MHz]', 'Power [dBm]', 'PA mode', 'Measured [MHz]', 'Error [Hz]', 'Error [ppm]',
  'Level [dBm]', 'Verdict', 'Note',
]

export function AutomationPanel({
  rows, onRowsChange, measure, onMeasureChange, limitPpm, results, planned, onClear, disabled,
}: {
  rows: PlanRow[]
  onRowsChange: (next: PlanRow[]) => void
  measure: MeasureSettings
  onMeasureChange: (next: MeasureSettings) => void
  limitPpm: number | null
  /** Measured so far, in plan order. */
  results: AutoResult[]
  /** Points in the run filling `results` in, while one is. */
  planned?: number
  onClear: () => void
  disabled: boolean
}) {
  const { status: bleStatus } = useConnection()
  const [filter, setFilter] = useState<VerdictFilter>('all')
  const total = planPoints(rows).length
  const update = (i: number, patch: Partial<PlanRow>) =>
    onRowsChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  const verdicts = results.map((r) => ppmVerdict(r.errorPpm, limitPpm))
  const pass = verdicts.filter((v) => v === 'pass').length
  const fail = verdicts.filter((v) => v === 'fail').length
  const shown = results
    .map((r, i) => ({ r, v: verdicts[i], i }))
    .filter(({ v }) => filter === 'all' || v === filter)

  const exportCsv = () => {
    const mac = bleStatus?.address ?? null
    void downloadCsv(CSV_HEADER, results.map((r, i) => [
      r.freqMhz, r.power, PA_MODE_LABEL[r.paMode] ?? r.paMode,
      r.measuredHz != null ? mhzToHz(r.measuredHz) : '',
      r.errorHz != null ? Math.round(r.errorHz) : '',
      r.errorPpm != null ? r.errorPpm.toFixed(4) : '',
      r.levelDbm != null ? r.levelDbm.toFixed(2) : '',
      verdicts[i] ?? '', r.note,
    ]), exportName('frequency-accuracy', mac, 'csv'), {
      test: 'LoRa frequency accuracy', dut_mac: mac,
      limit_ppm: limitPpm ?? undefined,
      stages: measure.stages.map((s) => `${s.span_hz}/${s.rbw_hz}/${s.vbw_hz} Hz`).join(' > '),
    })
  }

  return (
    <>
      <Section
        title="Sweep"
        panel
        action={
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {total} point{total === 1 ? '' : 's'}
            </Typography>
            <MiniAction startIcon={<AddIcon />} disabled={disabled}
              onClick={() => onRowsChange([...rows, { ...(rows[rows.length - 1] ?? DEFAULT_ROWS[0]), freq: '' }])}>
              Add
            </MiniAction>
          </Stack>
        }
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, mb: 0.75 }}>
          <ColHead label="Frequency" hint="MHz · 868.1, 902.3-927.5:0.2" />
          <ColHead label="Power" hint="dBm" />
          <ColHead label="PA mode" />
          <Box />
        </Box>
        <Stack spacing={0.75}>
          {rows.map((r, i) => {
            const badFreq = rowFreqs(r) === null
            const badPower = rowPower(r) === null
            return (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center' }}>
                <TextField size="small" value={r.freq} placeholder="915" disabled={disabled}
                  error={badFreq} onFocus={selectOnFocus}
                  title={badFreq ? 'Try 915, 868.1, 902.3 or 902.3-927.5:0.2' : undefined}
                  onChange={(e) => update(i, { freq: e.target.value })} />
                <TextField size="small" type="number" value={r.power} disabled={disabled}
                  error={badPower} onFocus={selectOnFocus}
                  onChange={(e) => update(i, { power: e.target.value })} />
                <TextField size="small" select value={r.paMode} disabled={disabled}
                  onChange={(e) => update(i, { paMode: Number(e.target.value) })}>
                  <MenuItem value={2}>Auto</MenuItem>
                  <MenuItem value={1}>On</MenuItem>
                  <MenuItem value={0}>Off</MenuItem>
                </TextField>
                <IconButton size="small" aria-label={`Remove row ${i + 1}`}
                  disabled={disabled || rows.length <= 1}
                  onClick={() => onRowsChange(rows.filter((_, k) => k !== i))}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            )
          })}
        </Stack>
      </Section>

      <MeasureSection value={measure} onChange={onMeasureChange} disabled={disabled} />

      <Section
        title="Results"
        panel
        action={
          <Stack direction="row" spacing={0.5}>
            <MiniAction startIcon={<DownloadIcon />} disabled={results.length === 0} onClick={exportCsv}>
              Export
            </MiniAction>
            <MiniAction tone="destructive" startIcon={<DeleteSweepIcon />}
              disabled={disabled || results.length === 0}
              onClick={() => { setFilter('all'); onClear() }}>
              Clear
            </MiniAction>
          </Stack>
        }
      >
        <Box sx={{ mb: 1 }}>
          <VerdictTally pass={pass} fail={fail} na={results.length - pass - fail}
            measured={results.length} planned={planned} filter={filter} onFilter={setFilter} />
        </Box>
        <Table size="small" sx={{ '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
          <TableHead>
            <TableRow>
              <HeadCell label="#" />
              <HeadCell label="Frequency" unit="MHz" numeric />
              <HeadCell label="Power" unit="dBm" numeric />
              <HeadCell label="PA" />
              <HeadCell label="Measured" unit="MHz" numeric />
              <HeadCell label="Error" unit="Hz" numeric />
              <HeadCell label="Error" unit="ppm" numeric />
              <HeadCell label="Level" unit="dBm" numeric />
              <HeadCell label="Verdict" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ ...TEXT.hint, color: 'text.secondary', py: 2 }}>
                  {results.length === 0 ? 'Run the sweep to measure each frequency.' : 'No rows match the filter.'}
                </TableCell>
              </TableRow>
            )}
            {shown.map(({ r, v, i }) => (
              <TableRow key={i} sx={v === 'fail' ? FAIL_ROW_SX : undefined} title={r.note || undefined}>
                <TableCell>{i + 1}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.freqMhz.toFixed(4)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.power}</TableCell>
                <TableCell>{PA_MODE_LABEL[r.paMode] ?? r.paMode}</TableCell>
                <TableCell sx={{ ...NUM_CELL_SX, fontFamily: MONO }}>
                  {r.measuredHz != null ? mhzToHz(r.measuredHz) : ''}
                </TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.errorHz != null ? formatErrorHz(r.errorHz) : ''}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.errorPpm != null ? r.errorPpm.toFixed(3) : ''}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.levelDbm != null ? r.levelDbm.toFixed(1) : ''}</TableCell>
                <TableCell>
                  {r.measuredHz == null
                    ? <Box component="span" sx={{ color: 'error.main', fontSize: 12.5 }}>{r.note || 'Failed'}</Box>
                    : <VerdictMark verdict={v} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  )
}

function ColHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <Typography sx={{ ...TEXT.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {label}
      {hint && <Box component="span" sx={{ ...TEXT.hint, color: 'text.secondary', ml: 0.75 }}>{hint}</Box>}
    </Typography>
  )
}
