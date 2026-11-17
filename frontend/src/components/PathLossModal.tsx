import { useRef, useState } from 'react'
import {
  Alert, Box, Button, IconButton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileOpenIcon from '@mui/icons-material/FileOpenRounded'
import SaveAltIcon from '@mui/icons-material/SaveAltRounded'
import { usePathLoss } from '../context/PathLossContext'
import { parsePathLossJson, pathLossToJson, type PathLossPoint } from '../lib/pathLoss'
import { saveBlob, timestamp } from '../lib/download'
import { useLog } from '../context/LogContext'
import { useNotify } from '../context/NotifyContext'
import { ModalShell, MONO, TEXT } from '../ui'
import { selectOnFocus } from '../lib/selectOnFocus'

interface Props {
  open: boolean
  onClose: () => void
}

/** A row mid-edit holds text, not numbers: "90" on the way to "902.3" is not 90. */
interface DraftRow {
  freq: string
  db: string
}

const toDraft = (p: PathLossPoint[]): DraftRow[] =>
  p.map((r) => ({ freq: String(r.freqMhz), db: String(r.db) }))

const isBlank = (r: DraftRow) => r.freq.trim() === '' && r.db.trim() === ''

/**
 * Per-frequency path loss.
 *
 * The loss of a cable, coupler and attenuator run is not flat across a band, so
 * one global figure is only ever right at one frequency. This holds a measured
 * value per frequency; anything not in the table falls back to the default and
 * is flagged wherever it is used, rather than silently corrected by a number
 * that belongs to a different frequency.
 */
export function PathLossModal({ open, onClose }: Props) {
  const { defaultDb, setDefaultDb, points, setPoints } = usePathLoss()
  const [rows, setRows] = useState<DraftRow[]>(() => toDraft(points))
  const [draftDefault, setDraftDefault] = useState(String(defaultDb))
  const { log } = useLog()
  const notify = useNotify()
  const fileInput = useRef<HTMLInputElement | null>(null)

  // Reload from context each time it opens, so a cancelled edit is really
  // discarded rather than lingering in this component's state.
  //
  // Adjusted during render on the open→ rising edge rather than in an effect:
  // an effect would set state after the dialog had already painted the stale
  // draft for a frame, and re-rendering from an effect body is the cascading
  // pattern React advises against.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setRows(toDraft(points))
      setDraftDefault(String(defaultDb))
    }
  }

  const update = (i: number, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  const parsed = rows.map((r) => ({
    freq: Number(r.freq),
    db: Number(r.db),
    freqOk: r.freq.trim() !== '' && Number.isFinite(Number(r.freq)) && Number(r.freq) > 0,
    dbOk: r.db.trim() !== '' && Number.isFinite(Number(r.db)),
  }))
  // A row still being typed should not block Save, but a filled-in row that is
  // wrong should — otherwise it is silently dropped.
  const invalid = parsed.filter((p, i) => !isBlank(rows[i]) && (!p.freqOk || !p.dbOk))
  const duplicates = new Set(
    parsed
      .filter((p, i) => p.freqOk && !isBlank(rows[i]))
      .map((p) => p.freq)
      .filter((f, i, all) => all.indexOf(f) !== i),
  )
  const defaultOk = draftDefault.trim() !== '' && Number.isFinite(Number(draftDefault))
  const canSave = invalid.length === 0 && duplicates.size === 0 && defaultOk

  /** The rows that Save would keep, sorted. */
  const keptPoints = (): PathLossPoint[] => rows
      .map((r, i) => ({ r, p: parsed[i] }))
      .filter(({ r, p }) => !isBlank(r) && p.freqOk && p.dbOk)
      // Sorted on save rather than while typing — reordering rows under the
      // cursor makes the table impossible to fill in.
      .map(({ p }) => ({ freqMhz: p.freq, db: p.db }))
      .sort((a, b) => a.freqMhz - b.freqMhz)

  const save = () => {
    setPoints(keptPoints())
    setDefaultDb(Number(draftDefault))
    onClose()
  }

  // Load fills the dialog, not the table: what came in is reviewed here and
  // applied with Save like any other edit, and Cancel still throws it away.
  const loadFile = async (file: File) => {
    try {
      const t = parsePathLossJson(await file.text())
      setRows(toDraft(t.points))
      if (t.defaultDb != null) setDraftDefault(String(t.defaultDb))
      log('System', `Loaded ${t.points.length} points from ${file.name} - Save to apply`)
    } catch (e) {
      notify.error((e as Error).message, { title: `Load ${file.name}` })
    }
  }
  // What is on screen, so a table can be saved before (or without) applying it.
  const saveFile = async () => {
    const text = pathLossToJson({ defaultDb: Number(draftDefault), points: keptPoints() })
    const name = `path-loss_${timestamp()}.json`
    try {
      if (await saveBlob(new Blob([text], { type: 'application/json' }), name) === 'saved') {
        log('System', `Saved the table to ${name}`)
      }
    } catch (e) {
      notify.error((e as Error).message, { title: 'Save path loss' })
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Path loss"
      maxWidth="sm"
      dividers
      footer={{
        // The file keys sit apart, on the left: they move the table in and
        // out of a file, while Cancel/Save decide what this app uses.
        leading: (
          <>
            <Button
              variant="text" color="inherit" size="small"
              startIcon={<FileOpenIcon sx={{ fontSize: 17 }} />}
              onClick={() => fileInput.current?.click()}
            >
              Load…
            </Button>
            <Tooltip title={canSave ? 'Save the table as shown to a .json file' : 'Fix the table first'}>
              <span>
                <Button
                  variant="text" color="inherit" size="small"
                  startIcon={<SaveAltIcon sx={{ fontSize: 17 }} />}
                  onClick={() => { void saveFile() }}
                  disabled={!canSave}
                >
                  Save as…
                </Button>
              </span>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                // Reset first: picking the same file again fires no change
                // event otherwise, so a second load would look ignored.
                e.target.value = ''
                if (f) void loadFile(f)
              }}
            />
          </>
        ),
        secondary: <Button onClick={onClose} variant="outlined" color="inherit">Cancel</Button>,
        primary: <Button onClick={save} variant="contained" disabled={!canSave}>Save</Button>,
      }}
    >
        <Stack spacing={2}>
          <Box>
            <Typography sx={{ ...TEXT.label, mb: 0.5 }}>Default</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                size="small"
                type="number"
                value={draftDefault}
                onChange={(e) => setDraftDefault(e.target.value)}
                onFocus={selectOnFocus}
                error={!defaultOk}
                inputProps={{ step: 0.1 }}
                sx={{ width: 120 }}
              />
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                dB - used for any frequency not listed below, and flagged as
                uncalibrated wherever it is applied.
              </Typography>
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography sx={{ ...TEXT.label }}>Calibrated frequencies</Typography>
              <Button
                size="small"
                startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                onClick={() => setRows((prev) => [...prev, { freq: '', db: '' }])}
              >
                Add row
              </Button>
            </Stack>

            {rows.length === 0 ? (
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary', py: 1 }}>
                No calibrated points yet - every measurement will use the default.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '45%' }}>Frequency (MHz)</TableCell>
                    <TableCell sx={{ width: '45%' }}>Loss (dB)</TableCell>
                    <TableCell sx={{ width: '10%' }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <TextField
                          size="small" type="number" fullWidth value={r.freq}
                          onChange={(e) => update(i, { freq: e.target.value })}
                          onFocus={selectOnFocus}
                          error={!isBlank(r) && (!parsed[i].freqOk || duplicates.has(parsed[i].freq))}
                          placeholder="902.3"
                          inputProps={{ step: 0.1, style: { fontFamily: MONO } }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small" type="number" fullWidth value={r.db}
                          onChange={(e) => update(i, { db: e.target.value })}
                          onFocus={selectOnFocus}
                          error={!isBlank(r) && !parsed[i].dbOk}
                          placeholder="20.5"
                          inputProps={{ step: 0.1, style: { fontFamily: MONO } }}
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Remove">
                          <IconButton
                            size="small"
                            aria-label="Remove row"
                            onClick={() => setRows((prev) => prev.filter((_, n) => n !== i))}
                            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                          >
                            <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>

          {duplicates.size > 0 && (
            <Alert severity="error" sx={{ py: 0.25, fontSize: 12.5 }}>
              Two rows share the same frequency ({[...duplicates].join(', ')} MHz).
              Only one loss can apply at a frequency.
            </Alert>
          )}
          {invalid.length > 0 && duplicates.size === 0 && (
            <Alert severity="error" sx={{ py: 0.25, fontSize: 12.5 }}>
              Every filled-in row needs a positive frequency and a numeric loss.
            </Alert>
          )}
        </Stack>
    </ModalShell>
  )
}
