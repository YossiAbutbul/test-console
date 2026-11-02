import { Box, ButtonBase } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { PRESS_SX, REDUCED_MOTION } from './feel'
import type { FollowBottom } from './followBottom'

/**
 * "↓ 12 new rows": shown while a list is not following and rows have landed
 * below, so a table held still is not mistaken for a run that stopped.
 *
 * The last child of the scrolling element. It takes no room -- a zero-height
 * strip stuck to the bottom of the view, the pill floating above it -- so
 * nothing in the table moves when it comes and goes.
 */
export function FollowLatest({ follow }: { follow: FollowBottom }) {
  const shown = follow.unseen > 0
  return (
    <Box
      aria-hidden={!shown}
      sx={{ position: 'sticky', left: 0, bottom: 0, height: 0, display: 'flex', justifyContent: 'center', zIndex: 3 }}
    >
      <ButtonBase
        onClick={follow.jump}
        tabIndex={shown ? 0 : -1}
        sx={(t) => ({
          position: 'absolute',
          bottom: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 26,
          px: 1.25,
          borderRadius: 13,
          fontSize: 12,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: t.palette.info.contrastText,
          bgcolor: t.palette.info.main,
          boxShadow: `0 2px 8px ${alpha(t.palette.common.black, 0.2)}`,
          opacity: shown ? 1 : 0,
          transform: shown ? 'none' : 'translateY(6px)',
          pointerEvents: shown ? 'auto' : 'none',
          transition: 'opacity 160ms ease-out, transform 160ms ease-out',
          ...PRESS_SX,
          // Replaces PRESS_SX's own reduced-motion entry, so it carries its
          // still press as well.
          [REDUCED_MOTION]: {
            transition: 'opacity 160ms ease-out',
            transform: 'none',
            '&:active:not(.Mui-disabled)': { transform: 'none' },
          },
        })}
      >
        <ArrowDownwardIcon sx={{ fontSize: 14 }} />
        {follow.unseen === 1 ? '1 new row' : `${follow.unseen} new rows`}
      </ButtonBase>
    </Box>
  )
}
