import { ButtonBase, CircularProgress } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../context/ThemeModeContext'
import { hazardRingSx, type HazardKind } from './hazardStyle'
import { PRESS_SX } from './feel'
import { ACTION_W, CONTROL_H } from './tokens'
import { HazardGlyph } from './HazardGlyph'

interface Props {
  value: boolean
  onChange: (next: boolean) => void
  /** Label shown while `value` is false — say the state, not the action. */
  offLabel: string
  /** Label shown while `value` is true. */
  onLabel: string
  disabled?: boolean
  /** Fixed width. Defaults to `ACTION_W.wide`: fixed, not minimum, so the
   *  label changing with the state can never resize the key. */
  width?: number
  /** The request this key sent is in flight: a spinner in the lamp's place,
   *  same box. Without it a power key that takes a moment to answer looked
   *  the same as one that was not allowed. */
  pending?: boolean
  /** What the key does to the bench while off -> on: its glyph and the
   *  hazard ring. `power` (the modem, the DC supply) unless the key keys a
   *  transmitter, as the signal generator's RF key does. */
  kind?: HazardKind
}

/**
 * A button that holds its state — the latching key off an instrument front
 * panel, drawn as the app's own keys are: grey while off, the accent fill
 * while on. It used to be a grey key with a green lamp and a green border
 * when on, a look no other key in the app had; the operator asked for it to
 * read like the buttons around it.
 *
 * One click flips it, so unlike a segmented control it is *relative*: it acts
 * on the state rather than setting it. That is only safe because the key
 * states what it currently is in words, and the fill changes with it, so no
 * single channel has to survive a glance -- which matters when the thing on
 * the other end is a transmitter.
 *
 * Labels should read as states ("Modem on"), never as actions ("Turn on"): the
 * key shows what *is*, and a label that promises what a click will do turns
 * every glance into a second question.
 */
export function LatchingKey({
  value, onChange, offLabel, onLabel, disabled, width = ACTION_W.wide, pending, kind = 'power',
}: Props) {
  const p = useAppPalette()
  const on = p.actions.primary

  return (
    <ButtonBase
      disableRipple
      disabled={disabled || pending}
      aria-pressed={value}
      aria-busy={pending || undefined}
      onClick={() => onChange(!value)}
      sx={[{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        px: 1.5,
        // The header's control height, and one width for both states, so
        // "Modem off" -> "Modem on" swaps the words without moving Stop and
        // Send beside it.
        height: CONTROL_H.md,
        minWidth: width,
        width,
        overflow: 'hidden',
        borderRadius: '8px',
        // Off is a translucent grey, like the fields, so it reads as a key on
        // any surface: the opaque key grey was the sidebar's own grey to
        // within one level, and the DC supply's "Off" sat there with no key
        // around it.
        bgcolor: value ? on.bg : alpha(p.sidebar.textDim, 0.14),
        fontSize: 13.5,
        fontWeight: 500,
        color: value ? on.fg : p.sidebar.text,
        whiteSpace: 'nowrap',
        transition: 'background-color .15s ease, color .15s ease, transform 120ms',
        // The press every Button gives; this is a ButtonBase and had none, so
        // the most consequential key in the toolbar was the one that did not
        // answer the hand.
        ...PRESS_SX,
        '&:hover': { bgcolor: value ? on.bgHover : alpha(p.sidebar.textDim, 0.2) },
        // The theme's disabled keys: an accent wash while on, a lighter grey
        // with greyed words while off -- never a 50 % fade of a live key.
        '&.Mui-disabled': value
          ? { color: p.sidebar.accent, bgcolor: alpha(p.sidebar.accent, 0.14) }
          : { color: p.textDisabled, bgcolor: alpha(p.sidebar.textDim, 0.1) },
      }, hazardRingSx(value ? null : kind)]}
    >
      {/* What the key powers, beside its state; a spinner in its place while
          the request is in flight, in the same box. */}
      {pending
        ? <CircularProgress size={14} color="inherit" />
        : <HazardGlyph kind={kind} sx={{ fontSize: 17 }} />}
      {value ? onLabel : offLabel}
    </ButtonBase>
  )
}
