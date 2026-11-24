/**
 * The tests a sequence can hold: click + to add one at the end, or drag it
 * into the sequence where it should go.
 *
 * Grouped by protocol, as the sidebar files the test pages, so a test is
 * found where the operator already looks for it. Each group wears its
 * protocol's colour -- the dot on its heading, the tint of its + -- the same
 * colour its steps carry in the sequence, so a test and its steps read as one
 * thing across the page.
 *
 * Styled as a source list rather than bordered cards: the library already
 * sits in a panel, and a card inside a card drew three outlines around one
 * row. Rows are filled, not outlined, with inset dividers.
 *
 * As a column beside the sequence each group is a list; across the top of a
 * narrow page the groups sit side by side, so the library takes a few lines
 * instead of pushing the sequence off the screen.
 */
import { useState, type DragEvent } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/AddRounded'
import DragIcon from '@mui/icons-material/DragIndicatorRounded'
import { useAppPalette } from '../../context/ThemeModeContext'
import { TEXT } from '../../ui'
import { LIBRARY_MIME, PROTOCOLS, SUITE_TESTS, protocolColor, protocolMime, shortLabel } from './catalog'

const ITEM_H = 40
const RADIUS = 10
const WIDE = '@container library (min-width: 480px)'
/** Under reduced motion the press and drag cues stay, without the movement. */
const REDUCED = '@media (prefers-reduced-motion: reduce)'

interface Props {
  disabled: boolean
  onAdd: (testId: string) => void
  /** How many steps of the sequence use each test, by test id. */
  counts?: Record<string, number>
}

export function TestLibrary({ disabled, onAdd, counts = {} }: Props) {
  const palette = useAppPalette()
  return (
    <Box
      sx={{
        display: 'grid', gap: 2.25, gridTemplateColumns: '1fr',
        [WIDE]: { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', alignItems: 'start' },
      }}
    >
      {PROTOCOLS.map((protocol) => {
        const tests = SUITE_TESTS.filter((t) => t.protocol === protocol)
        if (tests.length === 0) return null
        const color = protocolColor(protocol, palette.chart.series)
        return (
          <Stack key={protocol} spacing={0.75}>
            {/* The same heading the sequence gives a protocol. */}
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 0.75 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
              <Typography sx={{ ...TEXT.hint, fontWeight: 600, color: 'text.secondary', letterSpacing: 0.1 }}>
                {protocol}
              </Typography>
            </Stack>
            <Box
              role="list"
              aria-label={`${protocol} tests`}
              sx={(t) => ({
                borderRadius: `${RADIUS}px`, overflow: 'hidden',
                bgcolor: alpha(t.palette.text.primary, t.palette.mode === 'dark' ? 0.06 : 0.035),
              })}
            >
              {tests.map((t, i) => (
                <LibraryItem
                  key={t.id}
                  first={i === 0}
                  color={color}
                  label={shortLabel(t.label, protocol)}
                  ariaLabel={t.label}
                  count={counts[t.id] ?? 0}
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

function LibraryItem({ label, ariaLabel, first, color, count, disabled, onAdd, onDragStart }: {
  label: string
  /** The full name, for the + key: "Add LoRa CW", not "Add CW". */
  ariaLabel: string
  first: boolean
  color: string
  count: number
  disabled: boolean
  onAdd: () => void
  onDragStart: (e: DragEvent) => void
}) {
  const live = !disabled
  // The row being carried fades where it was picked up, as a Finder item
  // does: the drag image is the one that moves.
  const [dragging, setDragging] = useState(false)
  return (
    <Box
      role="listitem"
      draggable={live}
      onDragStart={live ? (e) => { setDragging(true); onDragStart(e) } : undefined}
      onDragEnd={() => setDragging(false)}
      // Double-click adds, as + does.
      onDoubleClick={live ? onAdd : undefined}
      sx={(t) => ({
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 0.5, height: ITEM_H, pl: 0.5, pr: 0.75,
        color: live ? 'text.primary' : 'text.disabled',
        cursor: live ? 'grab' : 'default',
        userSelect: 'none',
        opacity: dragging ? 0.45 : 1,
        transition: 'background-color 120ms, opacity 120ms, transform 100ms ease-out',
        // Inset divider, from the label rather than the edge, as in a
        // grouped list: rows of one group, not separate boxes.
        '&::before': first ? undefined : {
          content: '""', position: 'absolute', top: 0, left: 28, right: 0,
          borderTop: `1px solid ${t.palette.divider}`,
        },
        ...(live ? {
          '&:hover': { bgcolor: alpha(t.palette.text.primary, 0.04) },
          '&:hover .lib-grip': { opacity: 0.55 },
          '&:hover .lib-add': { bgcolor: color, color: t.palette.getContrastText(color) },
          // Feedback on the press itself, not on release.
          '&:active': { cursor: 'grabbing', bgcolor: alpha(t.palette.text.primary, 0.07), transform: 'scale(0.985)' },
        } : null),
        [REDUCED]: { transition: 'background-color 120ms, opacity 120ms', '&:active': { transform: 'none' } },
      })}
    >
      {/* Shown on hover, in a lane kept whether or not it shows, so the
          label never moves. */}
      <DragIcon
        className="lib-grip"
        aria-hidden
        sx={{ fontSize: 18, width: 22, flexShrink: 0, color: 'text.secondary', opacity: 0, transition: 'opacity 120ms' }}
      />
      <Typography noWrap sx={{ fontSize: 13, fontWeight: 500, flexGrow: 1, minWidth: 0 }}>{label}</Typography>
      {count > 0 && (
        <Tooltip title={`${count} step${count === 1 ? '' : 's'} in the sequence`} enterDelay={400}>
          <Box
            component="span"
            aria-label={`${count} in the sequence`}
            sx={{
              minWidth: 20, height: 18, px: 0.75, borderRadius: 9, flexShrink: 0,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color, bgcolor: alpha(color, 0.14),
            }}
          >
            {count}
          </Box>
        </Tooltip>
      )}
      <Tooltip title="Add to the end" enterDelay={500}>
        <span>
          <IconButton
            className="lib-add"
            size="small"
            aria-label={`Add ${ariaLabel}`}
            disabled={disabled}
            onClick={onAdd}
            sx={{
              width: 24, height: 24, ml: 0.25,
              color, bgcolor: alpha(color, 0.12),
              transition: 'background-color 120ms, color 120ms, transform 100ms ease-out',
              '&:hover': { bgcolor: color },
              '&:active': { transform: 'scale(0.9)' },
              '&.Mui-disabled': { color: 'text.disabled', bgcolor: 'transparent' },
              [REDUCED]: { '&:active': { transform: 'none' } },
            }}
          >
            <AddIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}
