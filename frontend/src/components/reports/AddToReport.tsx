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
 */
import { useState, type ReactNode } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import PostAddIcon from '@mui/icons-material/PostAddRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reportsApi, type ReportEntryDraft } from '../../api/reports'
import { LabeledField } from '../LabeledField'
import { useConnection } from '../../context/ConnectionContext'
import { useNicknames } from '../../context/NicknamesContext'
import { useNotify } from '../../context/NotifyContext'
import { useLog } from '../../context/LogContext'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { CONTROL_H, KeySpinner, MiniAction, ModalShell, MonoText, TEXT } from '../../ui'

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

export function AddToReport({ build, disabled }: {
  /** The run as it stands; called when the dialog opens. */
  build: () => ReportEntryDraft
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<ReportEntryDraft | null>(null)
  return (
    <>
      <MiniAction startIcon={<PostAddIcon />} disabled={disabled} onClick={() => setDraft(build())}>
        Add to report
      </MiniAction>
      {draft && <AddDialog draft={draft} onClose={() => setDraft(null)} />}
    </>
  )
}

/** A label over a value that is shown, not typed -- LabeledField's label, so
 *  the dialog's rows read as one form. */
function ReadOnlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack spacing={0.5}>
      {/* A block around an inline label, as LabeledField has it: the block
          sets the line box, so this label sits level with the field's. */}
      <Box>
        <Typography component="span" sx={{ ...TEXT.label, color: 'text.primary' }}>
          {label}
        </Typography>
      </Box>
      <Box sx={{ minHeight: CONTROL_H.md, display: 'flex', alignItems: 'center' }}>{children}</Box>
    </Stack>
  )
}

function AddDialog({ draft, onClose }: { draft: ReportEntryDraft; onClose: () => void }) {
  const qc = useQueryClient()
  const { success } = useNotify()
  const { log } = useLog()
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

  const mac = ble?.address ?? null
  const nickname = mac ? nick.get(mac) ?? null : null
  const t = tally(draft)

  const add = useMutation({
    mutationFn: async () => {
      const pid = creating ? (await reportsApi.create(newName.trim())).id : target
      await reportsApi.addEntry(pid, {
        ...draft,
        note: note.trim(),
        operator: operator.trim(),
        dut: { mac, name: ble?.name ?? null, nickname },
      })
      return { pid, name: creating ? newName.trim() : products.find((p) => p.id === pid)?.name ?? '' }
    },
    onSuccess: ({ pid, name }) => {
      setActiveId(pid)
      void qc.invalidateQueries({ queryKey: ['reports'] })
      void qc.invalidateQueries({ queryKey: ['report', pid] })
      success(`Added to "${name}"`)
      log('Report', `${draft.title}: ${t.points} points added to "${name}"`)
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
          <span><b>{t.points}</b> point{t.points === 1 ? '' : 's'}</span>
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
            <ReadOnlyRow label="Unit">
              {mac
                ? <MonoText>{nickname ? `${nickname} · ${mac}` : mac}</MonoText>
                : <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>No DUT connected</Typography>}
            </ReadOnlyRow>
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
