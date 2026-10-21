import { CONTROL_H } from './tokens'

/** Shared sizing for every header action, so button rows line up page to
 *  page. A fixed width (see ACTION_W): the label may change, the box may not.
 *  A label that would still not fit is cut with an ellipsis, never allowed to
 *  widen the key. (Its own file so `controls.tsx` exports only components,
 *  which fast refresh needs.) */
export const actionSx = (width: number) => ({
  width, minWidth: width, height: CONTROL_H.md, flexShrink: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
} as const)
