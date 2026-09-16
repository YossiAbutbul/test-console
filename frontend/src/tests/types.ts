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
  /**
   * True for a page that exists only to drive an instrument, and so has
   * nothing to offer a build without instrument support (see
   * CapabilitiesContext). Such a page is shown greyed out with a reason
   * rather than hidden, so the app looks the same everywhere and the
   * operator can see what the rig would add.
   *
   * Not the same as "uses an instrument". The TX pages command the DUT and
   * measure what comes back; without instruments they still transmit, and
   * the existing preflight already offers to run without the readings. Those
   * stay enabled.
   */
  requiresInstruments?: boolean
}
