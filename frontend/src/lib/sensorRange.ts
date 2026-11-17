/**
 * The power sensor's dynamic range: where its raw reading can be trusted.
 *
 * Judged on the raw reading at the sensor's input, never the path-loss
 * corrected figure -- the correction moves the number by tens of dB without
 * moving where the sensor actually was.
 *
 * One setting for the app (set on the Power Meter page, in the sensor's own
 * settings), read wherever a sensor reading is shown: the Power Meter's
 * At sensor tile, the CW/Modulated measurement card and the Load Pull
 * results. Defaults to -30 to +20 dBm.
 */
import { STORAGE_KEYS, usePersistedState } from '../store'

export interface SensorRange {
  minDbm: number
  maxDbm: number
}

export const SENSOR_RANGE_DEFAULT: SensorRange = { minDbm: -30, maxDbm: 20 }

/** 'under' / 'over' when the raw reading is outside the range (its ends are
 *  inside), null when inside or when there is no reading. */
export function outsideSensorRange(
  rawDbm: number | null | undefined,
  range: SensorRange,
): 'under' | 'over' | null {
  if (rawDbm == null || !Number.isFinite(rawDbm)) return null
  if (rawDbm < range.minDbm) return 'under'
  if (rawDbm > range.maxDbm) return 'over'
  return null
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** "-30 to +20 dBm". */
export const sensorRangeText = (r: SensorRange) => `${signed(r.minDbm)} to ${signed(r.maxDbm)} dBm`

/** The sentence shown with an out-of-range reading. */
export function outsideRangeMessage(rawDbm: number, range: SensorRange): string {
  return `${rawDbm.toFixed(2)} dBm at the sensor is outside its dynamic range (${sensorRangeText(range)})`
}

/** A stored range, or the default when what is stored is not a usable one. */
export function validSensorRange(r: Partial<SensorRange> | null | undefined): SensorRange {
  const min = Number(r?.minDbm), max = Number(r?.maxDbm)
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? { minDbm: min, maxDbm: max } : SENSOR_RANGE_DEFAULT
}

export function useSensorRange(): [SensorRange, (r: SensorRange) => void] {
  const [stored, setStored] = usePersistedState<SensorRange>(STORAGE_KEYS.sensorRange, SENSOR_RANGE_DEFAULT)
  return [validSensorRange(stored), setStored]
}
