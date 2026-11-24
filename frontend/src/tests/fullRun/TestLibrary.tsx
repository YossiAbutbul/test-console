/**
 * The tests a sequence can hold: click + to add one at the end, or drag it
 * into the sequence where it should go.
 *
 * Grouped by protocol, as the sidebar files the test pages, so a test is
 * found where the operator already looks for it.
 *
 * As a column beside the sequence each group is a list; across the top of a
 * narrow page the groups sit side by side, so the library takes a few lines instead of pushing the sequence off the screen.
 */
import type { DragEvent } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import { PANEL_SX, TEXT } from '../../ui'
import { LIBRARY_MIME, PROTOCOLS, SUITE_TESTS, protocolMime, shortLabel } from './catalog'

const ITEM_H = 42
const WIDE = '@container library (min-width: 480px)'

interface Props {
  disabled: boolean
  onAdd: (testId: string) => void
}

export function TestLibrary({ disabled, onAdd }: Props) {
  return (
    <Box
      sx={{
        display: 'grid', gap: 2, gridTemplateColumns: '1fr',
        [WIDE]: { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', alignItems: 'start' },
      }}
    >
      {PROTOCOLS.map((protocol) => {
        const tests = SUITE_TESTS.filter((t) => t.protocol === protocol)
        if (tests.length === 0) return null
        return (
          <Stack key={protocol} spacing={0.75}>
            <Typography sx={{ ...TEXT.hint, fontWeight: 600, color: 'text.secondary', px: 0.5 }}>
              {protocol}
            </Typography>
            <Box sx={{ ...PANEL_SX, overflow: 'hidden' }}>
              {tests.map((t, i) => (
                <LibraryItem
                  key={t.id}
                  first={i === 0}
                  label={shortLabel(t.label, protocol)}
                  ariaLabel={t.label}
                  disabled={disabled}
                  onAdd={() => onAdd(t.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(LIBRARY_MIME, t.id)
                    e.dataTransfer.setData(protocolMime(protocol), '')
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                />
              ))}
            </Box>
          </Stack>
        )
      })}
    </Box>
  )
}

function LibraryItem({ label, ariaLabel, first, disabled, onAdd, onDragStart }: {
  label: string
  /** The full name, for the + key: "Add LoRa CW", not "Add CW". */
  ariaLabel?: string
  first: boolean
  disabled: boolean
  onAdd?: () => void
  onDragStart?: (e: DragEvent) => void
}) {
  const live = !!onAdd && !disabled
  return (
    <Box
      draggable={live}
      onDragStart={live ? onDragStart : undefined}
      // Double-click adds, as + does.
      onDoubleClick={live ? onAdd : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, height: ITEM_H, pl: 1.5, pr: 0.5,
        borderTop: first ? 0 : 1, borderColor: 'divider',
        color: onAdd ? 'text.primary' : 'text.disabled',
        cursor: live ? 'grab' : 'default',
        userSelect: 'none',
        transition: 'background-color 120ms',
        '&:hover': live ? { bgcolor: 'action.hover' } : undefined,
        '&:active': live ? { cursor: 'grabbing', bgcolor: 'action.selected' } : undefined,
      }}
    >
      <Typography noWrap sx={{ fontSize: 13, fontWeight: 500, flexGrow: 1, minWidth: 0 }}>{label}</Typography>
      {onAdd && (
        <Tooltip title="Add to the end" enterDelay={500}>
          <span>
            <IconButton size="small" aria-label={`Add ${ariaLabel ?? label}`} disabled={disabled} onClick={onAdd}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  )
}
