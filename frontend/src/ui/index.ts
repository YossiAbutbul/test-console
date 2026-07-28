/**
 * Shared UI kit.
 *
 * Primitives every test page composes from, so pages describe *what* they show
 * and this layer decides *how* it looks. Import from `../../ui`.
 */
export { Section, Card } from './Section'
export { PageBody } from './PageBody'
export { Eyebrow, Readout, StatusChip, StatusDot, MonoText } from './Readout'
export {
  ConnectButton, RunControls, SendStopControls, PathLossChip, FrameDump,
} from './controls'
export { ACTION_W, CARD_SX, CONTROL_H, MONO, PAGE_W, TEXT } from './tokens'
