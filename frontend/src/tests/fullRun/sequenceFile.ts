/**
 * A test sequence as a file: saved from one bench (or one day) and loaded on
 * another, so a plan is built once.
 *
 * Only the plan -- each step's test, name, note, on/off and settings -- not
 * its results, which go to a report, nor the bench's cabling, which is the
 * bench's own. Steps get fresh ids on load: two loads of one file are two
 * sets of steps.
 */
import type { FullRunStep } from '../../store/fullRunStore'
import { suiteTest } from './catalog'

/** What marks a file as one of ours, and which shape it is. */
const KIND = 'test-console/test-sequence'
const VERSION = 1

interface FileStep {
  testId: string
  name?: string
  note?: string
  enabled?: boolean
  settings: Record<string, unknown>
}

interface SequenceFile {
  kind: typeof KIND
  version: number
  steps: FileStep[]
}

/** The sequence as the file's text. */
export function sequenceToFile(steps: FullRunStep[]): string {
  const file: SequenceFile = {
    kind: KIND,
    version: VERSION,
    steps: steps.map((s) => ({
      testId: s.testId,
      ...(s.name?.trim() ? { name: s.name.trim() } : {}),
      ...(s.note?.trim() ? { note: s.note.trim() } : {}),
      ...(s.enabled === false ? { enabled: false } : {}),
      settings: s.settings,
    })),
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Read a file back into steps. Throws, with a reason the operator can act
 * on, when it is not a sequence file at all; a step whose test this build
 * does not have is left out and counted, rather than failing the whole load.
 */
export function sequenceFromFile(text: string, newUid: () => string): { steps: FullRunStep[]; skipped: number } {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('This is not a test sequence file.') }
  const f = data as Partial<SequenceFile>
  if (!f || f.kind !== KIND || !Array.isArray(f.steps)) throw new Error('This is not a test sequence file.')
  if (typeof f.version !== 'number' || f.version > VERSION) {
    throw new Error('This sequence was saved by a newer version of the app.')
  }
  const steps: FullRunStep[] = []
  let skipped = 0
  for (const s of f.steps) {
    if (!s || typeof s.testId !== 'string' || !suiteTest(s.testId)
      || typeof s.settings !== 'object' || s.settings == null) {
      skipped++
      continue
    }
    steps.push({
      uid: newUid(),
      testId: s.testId,
      settings: structuredClone(s.settings),
      ...(typeof s.name === 'string' && s.name ? { name: s.name } : {}),
      ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
      ...(s.enabled === false ? { enabled: false } : {}),
    })
  }
  return { steps, skipped }
}
