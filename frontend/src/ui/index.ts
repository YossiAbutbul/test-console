/**
 * Shared UI kit.
 *
 * Primitives every test page composes from, so pages describe *what* they show
 * and this layer decides *how* it looks. Import from `../../ui`.
 */
export { Section, Card } from './Section'
export { PageBody, TwoCol } from './PageBody'
export { FieldGrid } from './FieldGrid'
export { StatTile, StatRow, StatGrid } from './StatTile'
export { Eyebrow, Readout, StatusChip, StatusDot, MonoText } from './Readout'
export {
  ConnectButton, EmergencyStop, RunControls, SendStopControls, PathLossChip,
  FrameDump, LastFrameSection,
} from './controls'
export {
  ACTION_W, CARD_SX, CARD_PAD, CONTROL_H, FIELD_MAX_W, GRID_GAP, MONO,
  PANEL_SX, PAGE_W, TEXT, TILE_PAD, type TileAccent,
} from './tokens'
