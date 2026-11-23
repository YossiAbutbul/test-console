import { memo, useSyncExternalStore, type Ref } from 'react'
import { Box, Stack } from '@mui/material'
import type { CursorStore } from './cursorStore'
import type { Pt } from './model'
import { LIST_ROW_SX, NUM_SX, TXT_SX, listCols } from './pointList'

/** One row of the point list. See Dot for why it is memoised. */
export const ListRow = memo(function ListRow({
  pt, color, hasAtt, hovered, onPick, rowRef,
}: {
  pt: Pt; color: string; hasAtt: boolean
  hovered: CursorStore
  onPick: (idx: number) => void
  rowRef?: Ref<HTMLDivElement>
}) {
  const on = useSyncExternalStore(hovered.subscribe, () => hovered.get() === pt.idx)
  return (
    <Stack
      ref={rowRef}
      direction="row"
      data-on={on}
      onMouseEnter={() => hovered.set(pt.idx)}
      onMouseLeave={() => hovered.set(null)}
      onDoubleClick={() => onPick(pt.idx)}
      sx={LIST_ROW_SX}
      style={{ gridTemplateColumns: listCols(hasAtt) }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        {/* The same colour the point carries on the chart, so a row and
            its dot are findable from each other. A plain style: the colour
            changes with the efficiency range, and in `sx` every new value
            would be a generated class. */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
        }} />
        {pt.idx + 1}
      </Box>
      <Box sx={NUM_SX}>{pt.row.pos_mm.toFixed(1)}</Box>
      {/* Every attenuation is on the chart at once, so the
          list is where a dot says which cycle it came from. */}
      {hasAtt && (
        <Box sx={NUM_SX}>
          {pt.row.att_db == null ? '—' : pt.row.att_db}
        </Box>
      )}
      <Box sx={{ ...TXT_SX, pl: 0.75 }} title={pt.row.r_ohm == null || pt.row.x_ohm == null ? undefined
        : `${pt.row.r_ohm.toFixed(1)} ${pt.row.x_ohm >= 0 ? '+' : '−'} j${Math.abs(pt.row.x_ohm).toFixed(1)} Ω`}
      >
        {pt.row.r_ohm == null || pt.row.x_ohm == null
          ? '—'
          : `${pt.row.r_ohm.toFixed(0)}${pt.row.x_ohm >= 0 ? '+' : '−'}j${Math.abs(pt.row.x_ohm).toFixed(0)}`}
      </Box>
      <Box sx={NUM_SX}>
        {pt.row.power_dbm == null ? '—' : pt.row.power_dbm.toFixed(1)}
      </Box>
      <Box sx={NUM_SX}>
        {pt.eff == null ? '—' : `${(pt.eff * 100).toFixed(1)}%`}
      </Box>
    </Stack>
  )
})
