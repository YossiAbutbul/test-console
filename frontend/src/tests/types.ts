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
  /**
   * Show at the top of the sidebar instead of inside `protocol`.
   *
   * Navigation placement only — it says nothing about what the page talks to.
   * Load Pull still drives the DUT with LoRa commands; it is filed at the root
   * because it belongs to the rig rather than to one protocol's TX menu.
   */
  root?: boolean
  icon?: ReactNode
  Page: ComponentType<TestPageProps>
  requiresConnection: boolean
}
