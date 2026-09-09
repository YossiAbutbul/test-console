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

export interface LteModulatedRequest {
  earfcn: number
  time_ms: number
  tx_power_dbm: number
  /** 0=1.4, 1=3, 2=5, 3=10, 4=15, 5=20 MHz */
  bandwidth: number
  mcs: number
  rb_count: number
  /** Both default to 0 on the backend, and the automation never sends
   *  anything else — the byte order of these two is the one part of the frame
   *  the captures do not pin. */
  rb_start?: number
  nb_index?: number
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

/** One group of combinations in a multi-range plan. Mirrors `SweepBlock` in
 *  backend/sweep/models.py. */
export interface SweepBlock {
  power_values: number[]
  duty_values: number[]
  hp_values: number[]
}

export interface SweepConfig {
  freq_hz: number
  power_values: number[]
  duty_values: number[]
  hp_values: number[]
  /** Multi-range plan. Omitted or empty means the three lists above are run as
   *  a single cross-product, which is what the simple form sends. */
  blocks?: SweepBlock[]
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

/** One row of the Meter Information read.
 *
 *  `ok: false` is an answer, not a transport failure — a unit that declines a
 *  query (status != 0) is what the dialog shows as "Not Supported". `raw_hex`
 *  travels even on success: these layouts were decoded from a single capture,
 *  so the bytes are worth keeping next to the value. Mirrors
 *  `MeterInfoField` in backend/api/device/info.py.
 */
export interface MeterInfoField {
  key: string
  label: string
  ok: boolean
  status: number
  raw_hex: string
  value?: string | null
  error?: string | null
}

export interface MeterInfoResponse {
  fields: MeterInfoField[]
}

/** App mode options, served from the backend so the names have one home.
 *  Mirrors `APP_MODES` in backend/device/info.py. */
export interface AppModeOption {
  mode: number
  label: string
}

export interface AppModesResponse {
  modes: AppModeOption[]
}

/** Result of a mode change.
 *
 *  `acknowledged` and `ok` are separate questions: the unit saves the mode and
 *  resets, so a reply can go missing because the link dropped underneath it.
 *  `acknowledged: false` is neither success nor failure. Mirrors
 *  `SetAppModeResponse` in backend/api/device/info.py. */
export interface SetAppModeResponse {
  mode: number
  label: string
  acknowledged: boolean
  ok: boolean
  status: number
  tx_hex: string
  rx_hex: string
  error?: string | null
}

/** Primary/secondary channel options. Same {mode,label} shape as app modes.
 *  Mirrors `ChannelOptionsResponse` in backend/api/device/info.py. */
export interface ChannelOptionsResponse {
  primary: AppModeOption[]
  secondary: AppModeOption[]
}

/** Result of a channel change. Same three-way shape as SetAppModeResponse:
 *  whether the unit answered is a separate question from whether it agreed. */
export interface SetChannelsResponse {
  primary: number
  secondary: number
  primary_label: string
  secondary_label: string
  acknowledged: boolean
  ok: boolean
  status: number
  tx_hex: string
  rx_hex: string
  error?: string | null
}

/** Outcome of `POST /device/save-reset`.
 *
 *  Success means the meter accepted the command and is going down — the BLE
 *  link drops and stays down until something reconnects. That is the expected
 *  result, not an error. Mirrors `SaveResetResponse` in
 *  backend/api/device/info.py. */
export interface SaveResetResponse {
  acknowledged: boolean
  ok: boolean
  status: number
  tx_hex: string
  rx_hex: string
  error?: string | null
}
