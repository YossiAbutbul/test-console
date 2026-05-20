import type { ComponentType, ReactNode } from 'react'

export interface TestModule {
  id: string
  label: string
  icon?: ReactNode
  Page: ComponentType
  requiresConnection: boolean
}
