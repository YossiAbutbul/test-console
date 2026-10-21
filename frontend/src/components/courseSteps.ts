import type { ReactNode } from 'react'
import type { CheckState } from '../ui'

/** A page's own check on its course (Load Pull's RF path, test point, ...). */
export interface CourseStep {
  id: string
  label: string
  state: CheckState
  summary?: ReactNode
  /** The element the step scrolls to when clicked (its DOM id). */
  targetId?: string
}
