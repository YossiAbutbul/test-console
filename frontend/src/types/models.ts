export interface ScannedDevice {
  address: string
  name?: string | null
  rssi?: number | null
  metadata: Record<string, unknown>
}

export interface ScanRequest {
  duration: number
}

export interface ConnectRequest {
  address: string
  timeout?: number
}

export interface ConnectionStatus {
  connected: boolean
  address?: string | null
  name?: string | null
  transport_ready: boolean
  transport_error?: string | null
  write_uuid?: string | null
  notify_uuid?: string | null
}

export interface LoraCwRequest {
  freq_hz: number
  power_dbm: number
  pa_duty_cycle: number
  hp_max: number
  pa_mode?: number
  timeout?: number
}

/**
 * HWTP_MODEM_TEST_RF_CW.
 *
 * Units match the wire: `time_ms` in milliseconds, `offset_hz` in Hz. The page
 * takes the duration in seconds because a test runs for tens of them, and
 * converts on the way out. `tx_power_dbm` is real dBm — the backend scales it
 * to the 0.01 dBm the wire carries, and caps it at the modem's 23 dBm.
 */
export interface LteCwRequest {
  earfcn: number
  time_ms: number
  tx_power_dbm: number
  offset_hz?: number
  /** true = START_TX_TEST, false = ABORT_TEST */
  start?: boolean
  timeout?: number
}

export interface LoraPowerRequest {
  freq_hz: number
  power_dbm: number
  pa_mode?: number
  timeout?: number
}

export interface LoraModulatedRequest {
  bandwidth: number
  freq_hz: number
  power_dbm: number
  modem: number
  datarate: number
  timeout?: number
}

export interface StopRequest {
  timeout?: number
}

export interface CommandResponse {
  ok: boolean
  status: number
  tx_hex: string
  rx_hex: string
  reply_opcode_hex: string
  reply_payload_hex: string
}

export interface SweepConfig {
  freq_hz: number
  power_values: number[]
  duty_values: number[]
  hp_values: number[]
  settle_ms: number
  cmd_timeout_s: number
  pa_mode?: number
  path_loss_db?: number
}

export interface StartRequest {
  config: SweepConfig
  power_sensor_serial?: string | null
  dc_analyzer_resource?: string | null
  dc_analyzer_channel: number
}

export type RunState = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface ResultRow {
  idx: number
  freq_hz: number
  power_dbm_setting: number
  pa_duty_cycle: number
  hp_max: number
  tx_power_dbm?: number | null
  current_a?: number | null
  voltage_v?: number | null
  tx_hex: string
  rx_hex: string
  ok: boolean
  status: number
  error?: string | null
  t_ms: number
}

export interface RunStatus {
  state: RunState
  completed: number
  total: number
  started_at?: number | null
  finished_at?: number | null
  error?: string | null
  config?: SweepConfig | null
  last_row?: ResultRow | null
}
