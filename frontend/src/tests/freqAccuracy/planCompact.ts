import { createContext } from 'react'

/**
 * Inside a Test Sequence step: the plan tables drop their row numbers, as the
 * other tests' step editors do -- the index track goes and each grid's first
 * cell is hidden (planTable.tsx).
 */
export const PlanCompact = createContext(false)
