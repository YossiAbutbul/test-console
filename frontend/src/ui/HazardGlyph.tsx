import SensorsRoundedIcon from '@mui/icons-material/SensorsRounded'
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded'
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded'
import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded'
import type { SxProps, Theme } from '@mui/material/styles'
import type { HazardKind } from './hazardStyle'

const ICON = {
  tx: SensorsRoundedIcon,
  power: PowerSettingsNewRoundedIcon,
  move: SwapHorizRoundedIcon,
  path: AltRouteRoundedIcon,
} as const

/** The glyph for a kind of hazard, the same one the live-output pill for it
 *  uses where there is one (RF, DC). */
export function HazardGlyph({ kind, sx }: { kind: HazardKind; sx?: SxProps<Theme> }) {
  const Icon = ICON[kind]
  return <Icon sx={[{ fontSize: 17 }, ...(Array.isArray(sx) ? sx : [sx])]} />
}
