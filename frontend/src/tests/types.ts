import type { ComponentType, ReactNode } from 'react'

export type Protocol = 'LoRa' | 'LTE' | 'BLE'

export interface TestPageProps {
  protocol: Protocol
  group?: string
  /**
   * True only for the page currently on screen.
   *
   * Every page stays mounted so navigation is instant, which means an effect
   * that publishes to an app-wide surface — the notice stack — runs on all of
   * them at once. Anything global must be gated on this.
   */
  active?: boolean
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
