import { describe, expect, it } from 'vitest'
import type { FullRunStep } from '../../store/fullRunStore'
import { sequenceFromFile, sequenceToFile } from './sequenceFile'

let n = 0
const uid = () => `u${++n}`

const steps: FullRunStep[] = [
  { uid: 'a', testId: 'power', name: 'High power', note: 'PA hot', settings: { rows: [{ freq: '915', power: '20' }], settleMs: 400 } },
  { uid: 'b', testId: 'ble-cw', enabled: false, settings: { rows: [{ channel: '19' }], unit: 'channel' } },
]

describe('sequence file', () => {
  it('round-trips the plan, with fresh ids', () => {
    const back = sequenceFromFile(sequenceToFile(steps), uid)
    expect(back.skipped).toBe(0)
    const withoutUid = (s: FullRunStep) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'uid'))
    expect(back.steps.map(withoutUid)).toEqual(steps.map(withoutUid))
    expect(back.steps.map((s) => s.uid)).not.toEqual(['a', 'b'])
  })

  it('leaves out a step whose test this build does not have, and counts it', () => {
    const file = JSON.parse(sequenceToFile(steps))
    file.steps.push({ testId: 'no-such-test', settings: {} })
    const back = sequenceFromFile(JSON.stringify(file), uid)
    expect(back.steps).toHaveLength(2)
    expect(back.skipped).toBe(1)
  })

  it('refuses a file that is not a sequence', () => {
    expect(() => sequenceFromFile('not json', uid)).toThrow('not a test sequence file')
    expect(() => sequenceFromFile('{"kind":"other","steps":[]}', uid)).toThrow('not a test sequence file')
    expect(() => sequenceFromFile('{"kind":"test-console/test-sequence","version":99,"steps":[]}', uid))
      .toThrow('newer version')
  })
})
