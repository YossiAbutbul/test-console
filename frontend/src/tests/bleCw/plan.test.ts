import { describe, expect, it } from 'vitest'
import type { BleAutomationRow } from '../../store/bleCwPageStore'
import {
  AUTO_TONE_FIRST_S, AUTO_TONE_MAX_S, POWER_CHANGE_EST_MS, autoToneSeconds, buildPlan, convertChannelSpec, estimateRunMs, minToneSeconds, powerChanges, rowIssues,
  specChannels,
} from './plan'

const row = (over: Partial<BleAutomationRow> = {}): BleAutomationRow => ({
  channel: '0', power: '31', minDbm: '', maxDbm: '', ...over,
})

describe('specChannels', () => {
  it('reads channel numbers', () => {
    expect(specChannels('0-4:2, 39', 'channel')).toEqual([0, 2, 4, 39])
  })

  it('reads MHz, keeping only exact channels', () => {
    expect(specChannels('2402, 2403, 2480', 'mhz')).toEqual([0, 39])
  })

  it('drops what is not a channel', () => {
    expect(specChannels('38-41', 'channel')).toEqual([38, 39])
  })
})

describe('rowIssues', () => {
  it('names each bad field', () => {
    expect(rowIssues(row({ channel: '40' }), 'channel').channel).toMatch(/0–39/)
    expect(rowIssues(row({ channel: '2403' }), 'mhz').channel).toMatch(/2402–2480/)
    expect(rowIssues(row({ power: '5' }), 'channel').power).toMatch(/6–31/)
    expect(rowIssues(row({ power: '' }), 'channel').power).toMatch(/Enter/)
    expect(rowIssues(row({ minDbm: '5', maxDbm: '3' }), 'channel').limits).toMatch(/above/)
    expect(rowIssues(row({ minDbm: 'x' }), 'channel').limits).toMatch(/dBm/)
  })

  it('finds nothing wrong with a good row, or a blank channel', () => {
    expect(rowIssues(row(), 'channel')).toEqual({ channel: null, power: null, limits: null })
    expect(rowIssues(row({ channel: '' }), 'channel').channel).toBeNull()
  })
})

describe('buildPlan', () => {
  it('groups by power so each power costs one reset', () => {
    const plan = buildPlan([
      row({ channel: '0,39', power: '31,10' }),
      row({ channel: '22', power: '10,31' }),
    ], 'channel')
    expect(plan.map((p) => [p.power, p.channel])).toEqual([
      [31, 0], [31, 39], [31, 22],
      [10, 0], [10, 39], [10, 22],
    ])
    expect(powerChanges(plan)).toBe(2)
  })

  it('carries each row its own limits and frequency', () => {
    const [p] = buildPlan([row({ channel: '22', minDbm: '3', maxDbm: '6' })], 'channel')
    expect(p).toEqual({ channel: 22, freqMhz: 2446, power: 31, minDbm: 3, maxDbm: 6 })
  })

  it('leaves out a row with any bad field rather than running part of it', () => {
    expect(buildPlan([row({ channel: '0,40' })], 'channel')).toEqual([])
  })
})

describe('timing', () => {
  it('counts a reset per power and a tone plus relink per point', () => {
    const plan = buildPlan([row({ channel: '0-1', power: '6,31' })], 'channel')
    const tone = 5
    const perPoint = estimateRunMs(plan.slice(0, 1), tone) - POWER_CHANGE_EST_MS
    expect(estimateRunMs(plan, tone)).toBe(2 * POWER_CHANGE_EST_MS + 4 * perPoint)
  })

  it('wants a tone long enough to measure inside', () => {
    expect(minToneSeconds(400)).toBe(3)
    expect(minToneSeconds(2000)).toBe(5)
  })
})

describe('convertChannelSpec', () => {
  it('keeps a spec its shape across units', () => {
    expect(convertChannelSpec('0-38:2, 39', 'channel', 'mhz')).toBe('2402-2478:4,2480')
    expect(convertChannelSpec('2402-2478:4,2480', 'mhz', 'channel')).toBe('0-38:2,39')
    expect(convertChannelSpec('22', 'channel', 'mhz')).toBe('2446')
  })

  it('writes the step a channel range implies', () => {
    // One channel is two MHz; "2402-2480" alone would name every MHz.
    expect(convertChannelSpec('0-39', 'channel', 'mhz')).toBe('2402-2480:2')
    expect(convertChannelSpec('2402-2480:2', 'mhz', 'channel')).toBe('0-39')
    expect(convertChannelSpec('2402-2480', 'mhz', 'channel')).toBe('2402-2480')
  })

  it('names the same channels either way round', () => {
    const spec = '0-10:3, 22, 30-39, 5-7'
    expect(specChannels(convertChannelSpec(spec, 'channel', 'mhz'), 'mhz'))
      .toEqual(specChannels(spec, 'channel'))
  })

  it('leaves a spec it cannot convert exactly alone', () => {
    expect(convertChannelSpec('2403', 'mhz', 'channel')).toBe('2403')
    expect(convertChannelSpec('2402-2410:3', 'mhz', 'channel')).toBe('2402-2410:3')
    expect(convertChannelSpec('40', 'channel', 'mhz')).toBe('40')
    expect(convertChannelSpec('abc', 'channel', 'mhz')).toBe('abc')
    expect(convertChannelSpec('', 'channel', 'mhz')).toBe('')
  })
})

describe('autoToneSeconds', () => {
  it('starts generous, with nothing timed yet', () => {
    expect(autoToneSeconds(null)).toBe(AUTO_TONE_FIRST_S)
  })

  it('sizes the tone to the slowest window seen, with headroom', () => {
    expect(autoToneSeconds(1_500)).toBe(3) // 1.5 * 1.2 + 0.3 = 2.1 -> 3
    expect(autoToneSeconds(2_400)).toBe(4) // 3.18 -> 4
  })

  it('stays within its floor and ceiling', () => {
    expect(autoToneSeconds(100)).toBe(2)
    expect(autoToneSeconds(60_000)).toBe(AUTO_TONE_MAX_S)
  })
})
