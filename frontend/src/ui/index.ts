/**
 * Shared UI kit.
 *
 * Primitives every test page composes from, so pages describe *what* they show
 * and this layer decides *how* it looks. Import from `../../ui`.
 */
export { Section, Card } from './Section'
export { PageBody, TwoCol } from './PageBody'
export { FieldGrid } from './FieldGrid'
export { LatchingKey } from './LatchingKey'
export { SegmentedChoice, type ChoiceOption } from './SegmentedChoice'
export { StatTile, StatRow, StatGrid } from './StatTile'
export { MeasureOptions } from './MeasureOptions'
export {
  MEASURE_ALL, measuresAnything, requiredInstruments, type MeasureSelection,
} from './measure'
export { Eyebrow, Readout, StatusChip, StatusDot, MonoText } from './Readout'
export {
  ConnectButton, EmergencyStop, RunControls, SendStopControls,
  FrameDump, LastFrameSection, MiniAction, DenseTabs, KeySpinner,
} from './controls'
export { actionSx } from './actionSx'
export { REDUCED_MOTION, PRESS_SX, focusRing, focusRingOf, scrollBehavior } from './feel'
export {
  ACTION_W, CARD_SX, CARD_PAD, CONTROL_H, TOP_BAR_H, FIELD_MAX_W, GRID_GAP, MONO,
  PANEL_SX, PAGE_W, TEXT, TILE_PAD, type TileAccent,
} from './tokens'
export { useShellLayout, type ShellLayout } from './useShellLayout'
export { InstrumentBar, type InstrumentBarStatus } from './InstrumentBar'
export { RunTiming } from './RunTiming'
export { JogPad } from './JogPad'
export {
  CheckRail, CheckStep, CheckMark, CheckDetail, type CheckState,
} from './CheckRail'
export { DutGateContext, useDutGated } from './gate'
export { ToolbarSlotContext, PageActiveContext, useToolbarSlot, usePageActive } from './toolbarSlot'
export { hazardRingSx, type HazardKind } from './hazardStyle'
export { HazardGlyph } from './HazardGlyph'
export { InstrumentError } from './InstrumentError'
export { HeadCell, VerdictMark, VerdictTally, type VerdictFilter } from './table'
export { FAIL_ROW_SX, NUM_CELL_SX, deltaText } from './tableFormat'
export { useRunEta, formatRunTiming } from './useRunEta'
export { ChartFrame, ChartToolbar, ChartSwitch } from './chart/ChartFrame'
export { useChart, useChartTheme, type ChartHandle, type ChartTheme } from './chart/useChart'
export {
  DEFAULT_CHART_OPTIONS, yDomain, type ChartOptions, type DomainBound,
} from './chart/chartOptions'
export { downloadChartPng, fileTimestamp, type LegendItem } from './chart/exportPng'
export { ModalShell, type ModalFooter } from './ModalShell'
