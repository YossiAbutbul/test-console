/**
 * "Add to report": keep this run in a product's report.
 *
 * One key for every test page, beside its Export. The page hands over its
 * results table exactly as it exports it (its CSV_HEADER / toCsvBody), so a
 * report and a CSV of the same run read alike. The table is copied when the
 * dialog opens: a run that starts while it is up does not change what is
 * added.
 *
 * Reports are per product model (backend/api/reports.py). The last one used
 * is preselected, so a day of runs on one product is one click and Add each.
 *
 * The unit is the one the results were measured on, not whichever is
 * connected when Add is pressed: each test's results are fingerprinted, and
 * the DUT connected while they came in is remembered against them (in local
 * storage, so a reload keeps it). Disconnecting afterwards, or connecting
 * another unit, leaves the run's MAC as it was. The MAC can still be typed or
 * corrected in the dialog.
 */
import { useEffect, useState } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import PostAddIcon from '@mui/icons-material/PostAddRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reportsApi, type ReportEntryDraft } from '../../api/reports'
import { LabeledField } from '../LabeledField'
import { useConnection } from '../../context/ConnectionContext'
import { useNicknames } from '../../context/NicknamesContext'
import { useNotify } from '../../context/NotifyContext'
import { usePageBadge } from '../../context/tabBadges'
import { useLog } from '../../context/LogContext'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { KeySpinner, MiniAction, ModalShell, TEXT } from '../../ui'
import { fingerprint, nextRunDut, normMac, type RunDut } from './runDut'

const NEW = '__new__'

/** Pass/fail counts from the table's Verdict column, as the backend counts. */
function tally(d: ReportEntryDraft) {
  const i = d.columns.findIndex((c) => c.trim().toLowerCase() === 'verdict')
  let pass = 0
  let fail = 0
  if (i >= 0) {
    for (const r of d.rows) {
      const v = String(r[i] ?? '').trim().toLowerCase()
      if (v.startsWith('pass')) pass++
      else if (v.startsWith('fail')) fail++
    }
  }
  return { points: d.rows.length, pass, fail }
}

export function AddToReport({ build, more, addBuild = true, disabled }: {
  /** The run as it stands. Copied when the dialog opens; also read on each
   *  render to notice a new run coming in, so it must be free of effects. */
  build: () => ReportEntryDraft
  /**
   * Further entries added with it, in order, under the same note, operator
   * and DUT -- a Full Run's steps after its summary. Read when the dialog
   * opens.
   */
  more?: () => ReportEntryDraft[]
  /**
   * False when `build` only names the batch -- the dialog's subtitle and the
   * DUT it was measured on -- and the entries are `more` alone. A Test
   * Sequence adds each step on its own test's tab; its summary was a tab of
   * its own that nobody looked for.
   */
  addBuild?: boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<ReportEntryDraft | null>(null)
  const [extra, setExtra] = useState<ReportEntryDraft[]>([])
  const { status: ble } = useConnection()
  const [duts, setDuts] = usePersistedState<Record<string, RunDut>>(STORAGE_KEYS.reportRunDut, {})

  // The results as they stand, to notice a new run coming in.
  const now = build()
  const test = now.test
  const fp = fingerprint(now)
  const liveMac = ble?.connected ? ble.address ?? null : null
  const liveName = ble?.connected ? ble.name ?? null : null
  useEffect(() => {
    setDuts((all) => {
      const next = nextRunDut(all[test], fp, liveMac ? { mac: liveMac, name: liveName } : null)
      if (next === all[test]) return all
      const out = { ...all }
      if (next) out[test] = next
      else delete out[test]
      return out
    })
  }, [test, fp, liveMac, liveName, setDuts])

  const remembered = duts[test]?.fp === fp ? duts[test] : undefined
  return (
    <>
      <MiniAction startIcon={<PostAddIcon />} disabled={disabled} onClick={() => { setDraft(build()); setExtra(more?.() ?? []) }}>
        Add to report
      </MiniAction>
      {draft && (
        <AddDialog draft={draft} more={extra} addDraft={addBuild} onClose={() => setDraft(null)}
          measuredOn={remembered && remembered.fp === fingerprint(draft) ? remembered : null} />
      )}
    </>
  )
}

function AddDialog({ draft, more, addDraft, onClose, measuredOn }: {
  draft: ReportEntryDraft
  more: ReportEntryDraft[]
  /** Whether `draft` is an entry too, or only names the batch. */
  addDraft: boolean
  onClose: () => void
  /** The DUT these results were measured on, when it is known. */
  measuredOn: RunDut | null
}) {
  const qc = useQueryClient()
  const { success } = useNotify()
  const { log } = useLog()
  const badge = usePageBadge()
  const { status: ble } = useConnection()
  const nick = useNicknames()
  const [activeId, setActiveId] = usePersistedState<string>(STORAGE_KEYS.activeReport, '')
  const [operator, setOperator] = usePersistedState<string>(STORAGE_KEYS.reportOperator, '')
  const [note, setNote] = useState('')
  const [newName, setNewName] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['reports'], queryFn: reportsApi.list })
  const products = list.data ?? []
  // The one picked here, else the last one used if it still exists, else a
  // new one (also the only choice before any report exists).
  const target = picked ?? (products.some((p) => p.id === activeId) ? activeId : products[0]?.id ?? NEW)
  const creating = target === NEW

  const liveMac = ble?.connected ? ble.address ?? null : null
  // The unit that measured the run, else the one connected now; editable.
  const [macText, setMacText] = useState(measuredOn?.mac ?? liveMac ?? '')
  const mac = normMac(macText) || null
  const nickname = mac ? nick.get(mac) ?? null : null
  const deviceName = mac && mac === measuredOn?.mac ? measuredOn.name
    : mac && mac === normMac(liveMac) ? ble?.name ?? null : null
  const source = !mac ? null
    : mac === measuredOn?.mac ? 'measured on this unit'
      : mac === normMac(liveMac) ? 'the DUT connected now' : 'typed'
  const entries = addDraft ? [draft, ...more] : more
  // Points and verdicts across what goes in: one entry's own, or, for a
  // batch named apart from its entries, theirs together.
  const t = addDraft ? tally(draft) : more.map(tally).reduce(
    (a, x) => ({ points: a.points + x.points, pass: a.pass + x.pass, fail: a.fail + x.fail }),
    { points: 0, pass: 0, fail: 0 },
  )

  const add = useMutation({
    mutationFn: async () => {
      const pid = creating ? (await reportsApi.create(newName.trim())).id : target
      // One after another, so the report holds them in the order given.
      for (const d of entries) {
        await reportsApi.addEntry(pid, {
          ...d,
          note: note.trim(),
          operator: operator.trim(),
          dut: { mac, name: deviceName, nickname },
        })
      }
      return { pid, name: creating ? newName.trim() : products.find((p) => p.id === pid)?.name ?? '' }
    },
    onSuccess: ({ pid, name }) => {
      setActiveId(pid)
      void qc.invalidateQueries({ queryKey: ['reports'] })
      void qc.invalidateQueries({ queryKey: ['report', pid] })
      success(`Added to "${name}"`)
      // Something new on Product reports (its module id is 'reports').
      badge('info', 'reports')
      log('Report', entries.length > 1
        ? `${draft.title}: ${entries.length} entries added to "${name}"`
        : `${draft.title}: ${t.points} points added to "${name}"`)
      onClose()
    },
  })

  const canAdd = !add.isPending && !list.isLoading && (!creating || newName.trim() !== '')

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Add to report"
      subtitle={draft.title}
      maxWidth="sm"
      footer={{
        secondary: <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>,
        primary: (
          <Button variant="contained" disabled={!canAdd} onClick={() => add.mutate()}
            startIcon={add.isPending ? <KeySpinner /> : <PostAddIcon />}>
            Add
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        {/* What goes in, before where it goes: the counts are what the
            report's summary will say about this run. */}
        <Stack direction="row" spacing={2.5} sx={{ ...TEXT.label, fontVariantNumeric: 'tabular-nums' }}>
          {/* Several entries: the first is a summary with a row per entry
              after it, so its rows are counted as those. */}
          {entries.length > 1
            ? <span><b>{entries.length}</b> entries</span>
            : <span><b>{t.points}</b> point{t.points === 1 ? '' : 's'}</span>}
          {(t.pass > 0 || t.fail > 0) && (
            <>
              <Box component="span" sx={{ color: 'success.main' }}><b>{t.pass}</b> pass</Box>
              <Box component="span" sx={{ color: t.fail ? 'error.main' : 'text.secondary' }}><b>{t.fail}</b> fail</Box>
            </>
          )}
        </Stack>

        <LabeledField select label="Product" value={list.isLoading ? '' : target}
          hint={list.isError ? 'could not load the list' : undefined}
          disabled={list.isLoading} onChange={(e) => setPicked(e.target.value)}>
          {products.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
              <Box component="span" sx={{ ...TEXT.hint, color: 'text.secondary', ml: 1 }}>
                {p.entry_count} entr{p.entry_count === 1 ? 'y' : 'ies'}
              </Box>
            </MenuItem>
          ))}
          <MenuItem value={NEW}>New product…</MenuItem>
        </LabeledField>

        {/* Kept in the layout while an existing product is picked, so
            switching to "New product" does not grow the dialog. */}
        <Box sx={{ display: creating ? 'block' : 'none' }}>
          <LabeledField label="Product name" autoFocus={creating} value={newName}
            placeholder="e.g. Sonata 2 IL rev B" onChange={(e) => setNewName(e.target.value)} />
        </Box>

        <Stack direction="row" spacing={2}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <LabeledField label="Operator" value={operator} onChange={(e) => setOperator(e.target.value)} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <LabeledField label="DUT MAC" value={macText} placeholder="e.g. 80E127FAA9F9"
              hint={nickname ? `${nickname}${source ? ` · ${source}` : ''}` : source ?? 'no DUT known for this run'}
              onChange={(e) => setMacText(e.target.value)}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' }, spellCheck: false } }} />
          </Box>
        </Stack>

        <LabeledField label="Note" hint="optional" multiline minRows={2} value={note}
          placeholder="What this run was for, rework, conditions"
          onChange={(e) => setNote(e.target.value)} />

        {add.isError && (
          <Typography sx={{ ...TEXT.hint, color: 'error.main' }}>
            Could not add: {(add.error as Error).message}
          </Typography>
        )}
      </Stack>
    </ModalShell>
  )
}
