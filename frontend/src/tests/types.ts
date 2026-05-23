import type { ComponentType, ReactNode } from 'react'

export type Protocol = 'LoRa' | 'LTE' | 'BLE'

export interface TestPageProps {
  protocol: Protocol
  group?: string
}

export interface TestModule {
  id: string
  label: string
  protocol: Protocol
  group?: string
  icon?: ReactNode
  Page: ComponentType<TestPageProps>
  requiresConnection: boolean
}
