import { memo, useState } from 'react'
import { Box, ButtonBase, MenuItem, Popover, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { MONO, PRESS_SX, TEXT } from '../../../ui'

/**
 * One view control: a caption, then the value.
 *
 * The caption sits beside the select rather than floating above it. A floating
 * MUI label notches the outline and reserves a row of space for two words,
 * which is what made the header top-heavy.
 */
export const Picker = memo(function Picker({
  label, unit, value, options, onChange,
}: {
  label: string
  unit: string
  value: number | null
  options: number[]
  onChange: (v: number) => void
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <TextField
        select
        size="small"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        inputProps={{ 'aria-label': `${label} (${unit})` }}
        sx={{
          minWidth: 96,
          '& .MuiInputBase-root': { height: 32 },
          '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5, py: 0.5 },
        }}
      >
        {/* Bare numbers — the unit is stated once, after the control. */}
        {options.map((o) => (
          <MenuItem key={o} value={o} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            {o}
          </MenuItem>
        ))}
      </TextField>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>{unit}</Typography>
    </Stack>
  )
})

/**
 * Which attenuator settings are on the chart. Every setting belongs on one
 * chart (sweeping it is what moves the load), but with a dozen trajectories
 * overlaid, comparing two or three of them meant reading through the rest.
 *
 * The field is the same select as Freq beside it; it opens a small sheet,
 * not a list. The list was a tall column of rows each tinted blue with a
 * tick -- nine identical loud rows that said "all on" by shouting -- with All
 * and None as two more rows of it. Here the settings are chips in a grid, a
 * shown one softly filled and ticked, a hidden one plain and dimmed; All and
 * None are quiet keys in the sheet's head. Double-click a chip for only that
 * setting. With the chart coloured by attenuator each chip carries its dot.
 */
export const AttPicker = memo(function AttPicker({
  options, hidden, onChange, colorOf,
}: {
  options: number[]
  hidden: ReadonlySet<number>
  onChange: (hidden: Set<number>) => void
  /** The setting's colour on the chart, when the chart is coloured by it. */
  colorOf?: (att: number) => string
}) {
  const pal = useAppPalette()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const shown = options.filter((o) => !hidden.has(o))
  const label = shown.length === options.length ? 'All'
    : shown.length === 0 ? 'None'
    : shown.join(', ')
  const toggle = (o: number) => {
    const next = new Set(hidden)
    if (next.has(o)) next.delete(o)
    else next.add(o)
    onChange(next)
  }
  const quietKey = (text: string, onClick: () => void, disabled: boolean) => (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        ...PRESS_SX, fontSize: 12, fontWeight: 500, borderRadius: '6px', px: 0.75, py: 0.25,
        color: 'primary.main', '&.Mui-disabled': { color: 'text.disabled' },
        '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.06) },
      }}
    >
      {text}
    </ButtonBase>
  )
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        Att
      </Typography>
      <TextField
        select
        size="small"
        value="shown"
        SelectProps={{
          // Never opens its own list: the sheet below is the menu.
          open: false,
          onOpen: (e) => setAnchor((e.currentTarget as HTMLElement).closest('.MuiInputBase-root') as HTMLElement),
          renderValue: () => label,
        }}
        inputProps={{ 'aria-label': 'Attenuator settings shown (dB)' }}
        sx={{
          minWidth: 96, maxWidth: 220,
          '& .MuiInputBase-root': { height: 32 },
          '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5, py: 0.5 },
        }}
      >
        <MenuItem value="shown">{label}</MenuItem>
      </TextField>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>dB</Typography>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75, p: 1.25, width: 232, borderRadius: '12px', border: 1, borderColor: 'divider',
              boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
            },
          },
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ px: 0.5, mb: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Attenuator</Typography>
          {quietKey('All', () => onChange(new Set()), hidden.size === 0)}
          {quietKey('None', () => onChange(new Set(options)), shown.length === 0)}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5 }}>
          {options.map((o) => {
            const on = !hidden.has(o)
            return (
              <ButtonBase
                key={o}
                aria-pressed={on}
                aria-label={`${o} dB`}
                onClick={() => toggle(o)}
                onDoubleClick={() => onChange(new Set(options.filter((x) => x !== o)))}
                sx={{
                  ...PRESS_SX,
                  height: 30, borderRadius: '8px', gap: 0.5,
                  fontFamily: MONO, fontSize: 12.5, fontWeight: on ? 600 : 400,
                  color: on ? 'text.primary' : 'text.disabled',
                  bgcolor: on ? alpha(pal.sidebar.text, 0.08) : 'transparent',
                  boxShadow: on ? 'none' : `inset 0 0 0 1px ${alpha(pal.sidebar.text, 0.1)}`,
                  '&:hover': { bgcolor: alpha(pal.sidebar.text, on ? 0.12 : 0.05) },
                }}
              >
                {colorOf ? (
                  <Box
                    component="span"
                    sx={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      bgcolor: on ? colorOf(o) : 'transparent',
                      boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${colorOf(o)}`,
                    }}
                  />
                ) : on && <CheckRoundedIcon sx={{ fontSize: 13, color: 'primary.main' }} />}
                {o}
              </ButtonBase>
            )
          })}
        </Box>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', px: 0.5, mt: 1 }}>
          Double-click a setting to show only it
        </Typography>
      </Popover>
    </Stack>
  )
})
