/**
 * The circle at a sidebar tab's top right: how many things happened on that
 * page while it was off screen, coloured by the worst (lib/tabBadges.ts).
 *
 * Positioned over the row, not in it, so a badge appearing or going never
 * moves the label beside it.
 */
import { Box } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { badgeLabel, type Badge, type BadgeStatus } from '../lib/tabBadges'

const COLOR: Record<BadgeStatus, (t: Theme) => string> = {
  error: (t) => t.palette.error.main,
  attention: (t) => t.palette.warning.main,
  success: (t) => t.palette.success.main,
  info: (t) => t.palette.info.main,
}

const MEANING: Record<BadgeStatus, string> = {
  error: 'a failure',
  attention: 'needs you',
  success: 'finished',
  info: 'new',
}

export function TabBadge({ badge, sx }: { badge: Badge; sx?: object }) {
  const label = badgeLabel(badge.count)
  return (
    <Box
      component="span"
      role="status"
      aria-label={`${badge.count} new on this page, ${MEANING[badge.status]}`}
      title={`${badge.count} new · ${MEANING[badge.status]}`}
      sx={[
        (t: Theme) => ({
          position: 'absolute', top: 2, right: 4, zIndex: 1,
          minWidth: 16, height: 16, px: label.length > 1 ? '4px' : 0, boxSizing: 'border-box',
          borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: COLOR[badge.status](t), color: t.palette.getContrastText(COLOR[badge.status](t)),
          fontSize: 10.5, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          // A hairline in the sidebar's own colour, so the circle reads as
          // sitting on the row rather than cut into it.
          boxShadow: `0 0 0 1.5px ${t.palette.background.paper}`,
          pointerEvents: 'none',
        }),
        ...(sx ? [sx] : []),
      ]}
    >
      {label}
    </Box>
  )
}
