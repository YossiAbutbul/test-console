import { Box, ButtonBase } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../context/ThemeModeContext'
import { hazardRingSx } from './hazardStyle'
import { CONTROL_H } from './tokens'
import { HazardGlyph } from './HazardGlyph'

interface Props {
  value: boolean
  onChange: (next: boolean) => void
  /** Label shown while `value` is false — say the state, not the action. */
  offLabel: string
  /** Label shown while `value` is true. */
  onLabel: string
  disabled?: boolean
  /** Fixed width, when the labels are short and the key sits in a tight row. */
  width?: number
}

/**
 * A button that holds its state, with an indicator lamp beside it — the
 * latching key off an instrument front panel.
 *
 * One click flips it, so unlike a segmented control it is *relative*: it acts
 * on the state rather than setting it. That is only safe because the key
 * states what it currently is in words, and three things move together when
 * it changes — the lamp colour, the lamp's glow, and the border tint. No
 * single channel has to survive a glance, which matters when the thing on the
 * other end is a transmitter.
 *
 * Labels should read as states ("Modem on"), never as actions ("Turn on"): the
 * key shows what *is*, and a label that promises what a click will do turns
 * every glance into a second question.
 */
export function LatchingKey({
  value, onChange, offLabel, onLabel, disabled, width,
}: Props) {
  const p = useAppPalette()
  // Lit borrows the green the instrument dots use for a live connection.
  // Anodized reserves colour for measurements, but connection and power state
  // were always the exception.
  const lit = p.data.ok

  return (
    <ButtonBase
      disableRipple
      disabled={disabled}
      aria-pressed={value}
      onClick={() => onChange(!value)}
      sx={[{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.1,
        pl: 1.25,
        pr: 1.5,
        // The header's control height, and one width for both states, so
        // "Modem off" -> "Modem on" swaps the words without moving Stop and
        // Send beside it.
        height: CONTROL_H.md,
        minWidth: width ?? 136,
        width,
        justifyContent: 'flex-start',
        borderRadius: 1.5,
        border: 1,
        borderColor: value ? alpha(lit, 0.55) : p.appBarBorder,
        bgcolor: p.paper,
        fontSize: 13,
        fontWeight: 560,
        color: p.sidebar.text,
        whiteSpace: 'nowrap',
        transition: 'border-color .18s ease',
        '&:hover': { borderColor: value ? alpha(lit, 0.8) : p.sidebar.textDim },
        '&.Mui-disabled': { opacity: 0.5, color: p.sidebar.text },
      // A hazard key while it would power the modem: switching it off is the
      // safe way out and carries no ring.
      }, hazardRingSx(value ? null : 'power')]}
    >
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '2px',
          flex: 'none',
          bgcolor: value ? lit : p.sidebar.successOff,
          // Two rings rather than one: the tight halo reads at a glance, the
          // wide one carries across a dim bench.
          boxShadow: value
            ? `0 0 0 2px ${alpha(lit, 0.26)}, 0 0 9px ${alpha(lit, 0.65)}`
            : 'none',
          transition: 'background-color .18s ease, box-shadow .18s ease',
        }}
      />
      {/* What the key powers, beside its state: it switches the modem on, and
          in a header next to Stop and Send it read as a filter chip. */}
      <HazardGlyph kind="power" sx={{ fontSize: 15, color: p.sidebar.textDim, ml: -0.25 }} />
      {value ? onLabel : offLabel}
    </ButtonBase>
  )
}
