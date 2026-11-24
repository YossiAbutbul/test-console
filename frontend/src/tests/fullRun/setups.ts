/**
 * The bench setups a test sequence moves between, and what the operator is told
 * when it pauses to re-cable.
 *
 * Which setup a test needs is declared on the test itself (`SweepTest.setup`);
 * this is only the words the re-cable prompt shows.
 */
import type { SetupId } from '../engine/sweepTest'
import type { SetupText } from '../../store/fullRunStore'

export const SETUP_IDS: SetupId[] = ['main', 'ble', 'load-pull']

export const DEFAULT_SETUPS: Record<SetupId, SetupText> = {
  main: {
    name: 'Main',
    instructions: 'Connect the DUT\'s main RF output (LoRa / LTE) to the coupler and power sensor.',
  },
  ble: {
    name: 'BLE',
    instructions: 'Move the cable to the DUT\'s BLE output, so the BLE radio feeds the coupler and power sensor.',
  },
  'load-pull': {
    name: 'Load Pull',
    instructions: 'Put the trombone tuner in the path: DUT → RF switch → tuner → coupler → power sensor.',
  },
}
