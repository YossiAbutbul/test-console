import { describe, it, expect } from 'vitest'
import {
  POWER_SOURCE_DEFAULT, khzToHz, measureSpectrumOf, powerInstrument, powerSourceOf,
  powerSourceValid, spectrumSettingsOf,
} from './powerSource'
import { requiredInstruments } from '../ui/measure'

describe('powerSource', () => {
  it('defaults to the sensor with Mode Sweep’s analyzer settings', () => {
    expect(POWER_SOURCE_DEFAULT.source).toBe('sensor')
    expect(spectrumSettingsOf(POWER_SOURCE_DEFAULT)).toEqual({
      span_hz: 1_000_000, rbw_hz: 100_000, vbw_hz: 300_000, detector: 'POS',
    })
  })

  it('fills a saved state from before a field existed', () => {
    expect(powerSourceOf({ source: 'spectrum' })).toEqual({ ...POWER_SOURCE_DEFAULT, source: 'spectrum' })
    expect(powerSourceOf(undefined)).toEqual(POWER_SOURCE_DEFAULT)
  })

  it('reads kHz fields as Hz and refuses anything not positive', () => {
    expect(khzToHz('12.5')).toBe(12_500)
    expect(khzToHz('')).toBeNull()
    expect(khzToHz('0')).toBeNull()
    expect(khzToHz('-3')).toBeNull()
    expect(khzToHz('abc')).toBeNull()
  })

  it('is valid with the sensor whatever the analyzer fields hold', () => {
    const bad = { ...POWER_SOURCE_DEFAULT, rbwKhz: '' }
    expect(powerSourceValid(bad)).toBe(true)
    expect(powerSourceValid({ ...bad, source: 'spectrum' })).toBe(false)
  })

  it('sends analyzer settings only for the analyzer', () => {
    expect(measureSpectrumOf(POWER_SOURCE_DEFAULT)).toBeUndefined()
    expect(measureSpectrumOf(undefined)).toBeUndefined()
    expect(measureSpectrumOf({ ...POWER_SOURCE_DEFAULT, source: 'spectrum', detector: 'RMS' }))
      .toMatchObject({ span_hz: 1_000_000, detector: 'RMS' })
  })

  it('names the instrument preflight brings up', () => {
    expect(powerInstrument('sensor')).toBe('power-sensor')
    expect(powerInstrument({ ...POWER_SOURCE_DEFAULT, source: 'spectrum' })).toBe('spectrum')
    expect(requiredInstruments({ power: true, current: true }, 'spectrum')).toEqual(['spectrum', 'dc-analyzer'])
    expect(requiredInstruments({ power: true, current: false })).toEqual(['power-sensor'])
  })
})
