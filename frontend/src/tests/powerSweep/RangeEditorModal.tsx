import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { MONO, TEXT } from '../../ui'
import { RangeRow } from './RangeRow'
import { blockSteps, describeProblem, newBlock, type BlockDraft, type Bounds } from './blocks'

interface Props {
  /** The row being edited, or null to add one. Closed when undefined. */
  editing: BlockDraft | null | undefined
  bounds: Bounds
  onSave: (block: BlockDraft) => void
  /** Absent when this is the only row — a plan needs at least one. */
  onDelete?: () => void
  onClose: () => void
  /** 1-based, for the title. Absent when adding. */
  position?: number
}

/**
 * One range, edited on its own.
 *
 * A single row rather than the whole plan: editing every row at once meant a
 * grid of eighteen number fields, and the operator is almost always changing
 * one of them. The list on the page is the plan; this is one line of it.
 *
 * Uses the same `RangeRow` the simple form does, so a range looks identical
 * whether it is the only one or the third of five.
 */
export function RangeEditorModal({
  editing, bounds, onSave, onDelete, onClose, position,
}: Props) {
  const open = editing !== undefined
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      {/* Mounted only while open so the editor seeds itself from props on
          mount -- no effect, and reopening always shows what is in force. */}
      {open && (
        <Editor
          editing={editing}
          bounds={bounds}
          onSave={onSave}
          onDelete={onDelete}
          onClose={onClose}
          position={position}
        />
      )}
    </Dialog>
  )
}

function Editor({ editing, bounds, onSave, onDelete, onClose, position }: Props) {
  const [row, setRow] = useState<BlockDraft>(
    () => (editing ? { ...editing } : newBlock(bounds)),
  )
  const set = (next: Partial<BlockDraft>) => setRow((r) => ({ ...r, ...next }))

  const problem = describeProblem([row], bounds)
  const steps = blockSteps(row)

  return (
    <>
      <DialogTitle sx={{ py: 1.75 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>
              {editing ? `Edit range ${position ?? ''}`.trim() : 'New range'}
            </Typography>
            <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
              Every combination of these three spans is swept
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2.5, py: 2 }}>
        <Stack spacing={2}>
          <RangeRow
            label="Power" unit="dBm"
            lo={row.powerLo} hi={row.powerHi}
            setLo={(n) => set({ powerLo: n })} setHi={(n) => set({ powerHi: n })}
            min={bounds.power.min} max={bounds.power.max}
          />
          <RangeRow
            label="PA Duty Cycle"
            lo={row.dutyLo} hi={row.dutyHi}
            setLo={(n) => set({ dutyLo: n })} setHi={(n) => set({ dutyHi: n })}
            min={bounds.duty.min} max={bounds.duty.max}
          />
          <RangeRow
            label="HP Max"
            lo={row.hpLo} hi={row.hpHi}
            setLo={(n) => set({ hpLo: n })} setHi={(n) => set({ hpHi: n })}
            min={bounds.hp.min} max={bounds.hp.max}
          />
        </Stack>

        {problem && <Alert severity="warning" sx={{ mt: 2 }}>{problem}</Alert>}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.75 }}>
        {/* Delete sits apart from Save/Cancel, on the left: it is the one
            action here that discards work rather than keeping it. */}
        {onDelete && (
          <Button
            color="error"
            startIcon={<DeleteOutlineIcon sx={{ fontSize: 16 }} />}
            onClick={() => { onDelete(); onClose() }}
          >
            Delete
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mr: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, fontFamily: MONO }}>{steps}</Typography>
          <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
            step{steps === 1 ? '' : 's'}
          </Typography>
        </Stack>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!!problem}
          onClick={() => { onSave(row); onClose() }}
          sx={{ minWidth: 100 }}
        >
          {editing ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </>
  )
}
