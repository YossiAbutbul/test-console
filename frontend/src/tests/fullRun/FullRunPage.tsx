/**
 * Test Sequence: several tests chained into one run.
 *
 * The operator builds a sequence from the test library -- the same test as
 * often as they like, each copy with its own name and settings -- orders it,
 * and presses Run once. The run goes step by step, pauses with a re-cable
 * prompt wherever the next step needs the bench cabled differently, and Stop
 * ends all of it.
 *
 * Library on the left, the sequence on the right: the library is where tests
 * come from, the sequence where they are arranged and edited, and the one list
 * is also the run's progress, so the eye stays in one place while it runs.
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Divider, Stack, Tooltip, Typography } from '@mui/material'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import FolderOpenIcon from '@mui/icons-material/FolderOpenRounded'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import UndoIcon from '@mui/icons-material/UndoRounded'
import { PageHeader } from '../../components/PageHeader'
import { AddToReport } from '../../components/reports/AddToReport'
import type { ReportEntryDraft } from '../../api/reports'
import { useNotify } from '../../context/NotifyContext'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../../context/ThemeModeContext'
import { formatDuration } from '../../lib/async'
import { saveBlob, timestamp } from '../../lib/download'
import {
  CheckRail, CheckStep, GRID_GAP, MiniAction, PageBody, RunControls, RunTiming, Section, TEXT,
  type CheckState,
} from '../../ui'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  fullRunSnapshot, persistFullRun, type FullRunStep, type StepResult,
} from '../../store/fullRunStore'
import type { SetupId } from '../engine/sweepTest'
import type { JudgedRow } from '../engine/sweepTest'
import { LIBRARY_MIME, PROTOCOLS, protocolColor, shortLabel, suiteTest } from './catalog'
import { RecablePrompt } from './RecablePrompt'
import { sequenceFromFile, sequenceToFile } from './sequenceFile'
import { recablePoints } from './suiteVerdict'
import { DEFAULT_SETUPS } from './setups'
import { StepDetail, type StepView as StepTabView } from './StepDetail'
import { StepList, type StepView } from './StepList'
import { TestLibrary } from './TestLibrary'
import { FULL_RUN_ID, useFullRun } from './useFullRun'

const newUid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/** Steps read back from storage, minus any whose test this build lacks. */
function loadSteps(): FullRunStep[] {
  return (fullRunSnapshot.steps ?? []).filter((s) => !!suiteTest(s.testId) && !!s.uid)
}

const SUMMARY_HEADER = [
  'Step', 'Name', 'Test', 'Setup', 'Measures at', 'Pass', 'Fail', 'Measured', 'Planned', 'Errors', 'Time', 'Verdict', 'Note',
]
const VERDICT_WORD = {
  pass: 'Pass', fail: 'Fail', na: 'N/A', error: 'Error', stopped: 'Stopped', 'not-run': 'Not run',
} as const

/**
 * The sequence, grouped by protocol in the sidebar's order (LoRa, LTE, BLE),
 * each group in the operator's own order. Kept so at all times -- on load,
 * after an add, a swap, an undo -- so a run switches radio as few times as it
 * can, and, LoRa and LTE sharing the main output, re-cables as few times too.
 * A stable sort: within a protocol nothing moves.
 */
function byProtocol(steps: FullRunStep[]): FullRunStep[] {
  const rank = (s: FullRunStep) => PROTOCOLS.indexOf(suiteTest(s.testId)?.protocol ?? 'BLE')
  return steps.map((s, i) => ({ s, i })).sort((x, y) => rank(x.s) - rank(y.s) || x.i - y.i).map((x) => x.s)
}

/** The library beside the sequence, until the page is too narrow for both. */
const LIBRARY_W = 264
const TWO_COL_MIN = 980

/** The scrollbar's lane (theme.ts sets it at 10 px), for a scroll area
 *  that keeps its lane in a panel's padding. */
const SCROLLBAR_W = 10

export function FullRunPage() {
  const palette = useAppPalette()
  const notify = useNotify()

  const [steps, setStepsRaw] = useSnapshotState<FullRunStep[]>(
    () => byProtocol(loadSteps()),
    (v) => { fullRunSnapshot.steps = v; persistFullRun() },
  )
  /** Every change to the sequence comes out grouped by protocol. */
  const setSteps = (next: FullRunStep[] | ((arr: FullRunStep[]) => FullRunStep[])) =>
    setStepsRaw((arr) => byProtocol(typeof next === 'function' ? next(arr) : next))
  // Each setup's name and re-cable wording. Fixed for now; a diagram per
  // setup, as the path loss guide has, may replace the words later.
  const setups = DEFAULT_SETUPS
  const [bench, setBench] = useSnapshotState<SetupId | null>(
    () => fullRunSnapshot.bench ?? null,
    (v) => { fullRunSnapshot.bench = v; persistFullRun() },
  )
  const [results, setResults] = useSnapshotState<Record<string, StepResult>>(
    () => fullRunSnapshot.results ?? {},
    (v) => { fullRunSnapshot.results = v; persistFullRun() },
  )
  // Bumped when a step's settings are edited in place, to re-read them.
  const [, setEdits] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  // Each step's last-used tab, so it reopens where it was left; Sweep for
  // a step not opened yet.
  const [stepTabs, setStepTabs] = useState<Record<string, StepTabView>>({})
  // The Sequence panel as the drop target, and how a drag from the library
  // stands: under way anywhere, or over the panel.
  const [zone, setZone] = useState<HTMLElement | null>(null)
  const [libraryDrag, setLibraryDrag] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  useEffect(() => {
    const start = (e: DragEvent) => { if (e.dataTransfer?.types.includes(LIBRARY_MIME)) setLibraryDrag(true) }
    const end = () => { setLibraryDrag(false); setDropOver(false) }
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [])

  const run = useFullRun({
    steps,
    bench,
    onBench: setBench,
    onResult: (uid, r) => setResults((all) => ({ ...all, [uid]: { ...r, planKey: planKeyOf(uid) } })),
    onStart: () => { setOpen(null); setResults({}); fullRunSnapshot.lastRunAt = Date.now() },
  })
  const { running } = run

  // What each step resolves to now: its plan, cost and problems.
  const resolved = steps.map((s) => {
    const t = suiteTest(s.testId)!
    const r = t.resolve(s.settings)
    const plan = t.plan(r)
    return {
      step: s, test: t, plan,
      enabled: s.enabled !== false,
      title: s.name?.trim() || shortLabel(t.label, t.protocol),
      // For a report or a file, where no tag stands beside it.
      fullTitle: s.name?.trim() || t.label,
      problem: t.problem(r) ?? (plan.length === 0 ? 'no points to measure' : null),
      estimateMs: t.estimateMs(r, plan),
      summary: t.summary(r, plan),
    }
  })
  const active = resolved.filter((x) => x.enabled)
  const activeSteps = active.map((x) => ({ uid: x.step.uid, setup: x.test.setup }))
  // Only the re-cables between two steps -- the lines the list shows. The
  // prompt before the first step, when the bench's cabling is not known,
  // is the run checking, not a change of setup.
  const recables = recablePoints(activeSteps, bench).filter((i) => i > 0)
  const recableUids = new Set(recables.map((i) => activeSteps[i].uid))
  const totalMs = active.reduce((a, x) => a + x.estimateMs, 0)
  const totalPoints = active.reduce((a, x) => a + x.plan.length, 0)
  const problems = active.filter((x) => x.problem)

  const views: StepView[] = resolved.map((x, idx) => {
    // The setup the bench is on when this step comes up: the last step
    // before it that runs, or the bench as the run starts.
    const ai = active.indexOf(x)
    const prev = ai > 0 ? active[ai - 1].test.setup : bench
    const res = results[x.step.uid]
    const liveHere = running && run.live?.uid === x.step.uid
    return {
      uid: x.step.uid,
      title: x.title,
      testLabel: x.step.name?.trim() ? x.test.label : null,
      // The operator's own words when they wrote some; otherwise what the
      // step measures at.
      summary: x.step.note?.trim() || x.summary,
      protocol: x.test.protocol,
      setupName: `${setups[x.test.setup].name} setup`,
      color: protocolColor(x.test.protocol, palette.chart.series),
      enabled: x.enabled,
      points: x.plan.length,
      estimateMs: x.estimateMs,
      problem: x.problem,
      outcome: liveHere ? null : res?.outcome ?? null,
      live: liveHere && run.live ? { done: run.live.done, total: run.live.total } : null,
      // A heading over each protocol's group. It names a re-cable only
      // where the run will pause for one: between two steps that run.
      group: idx === 0 || resolved[idx - 1].test.protocol !== x.test.protocol
        ? {
            name: x.test.protocol,
            from: recableUids.has(x.step.uid) && prev ? setups[prev].name : null,
          }
        : null,
    }
  })

  /** What a step would do, as a string to compare: its settings resolved,
   *  so a field filled in or a value tidied is the same plan. */
  const planKeyOf = (uid: string): string => {
    // The step objects are edited in place, so this render's list is current.
    const st = steps.find((x) => x.uid === uid)
    const t = st && suiteTest(st.testId)
    return t && st ? `${st.testId}:${JSON.stringify(t.resolve(st.settings))}` : ''
  }

  // ---- sequence edits
  // One step of undo for the edits that throw an order or a step away:
  // Remove and Group by setup. The key is always in the bar, so it appearing
  // moves nothing.
  const [undo, setUndo] = useState<{ label: string; steps: FullRunStep[] } | null>(null)
  // The step added last, which the list brings in with a short arrival.
  const [arrived, setArrived] = useState<string | null>(null)
  /** Add a test at `at`, or at the end. The end is read inside the update,
   *  so two quick clicks on + land one after the other, not both at the
   *  length the page last rendered with. */
  const insert = (testId: string, at?: number) => {
    const t = suiteTest(testId)
    if (!t) return
    const step: FullRunStep = { uid: newUid(), testId, settings: t.fromPage() as Record<string, unknown> }
    setArrived(step.uid)
    setSteps((arr) => {
      // At the end, or where it was dropped; grouping then takes it to the
      // end of its protocol, or the nearest place in it.
      const i = at == null ? arr.length : Math.min(at, arr.length)
      return [...arr.slice(0, i), step, ...arr.slice(i)]
    })
  }
  const patch = (uid: string, p: Partial<FullRunStep>) => {
    setSteps((arr) => arr.map((s) => (s.uid === uid ? { ...s, ...p } : s)))
    // Another test, or other settings: the last result no longer describes it.
    if ((p.testId || p.settings) && results[uid]) dropResult(uid)
  }
  const dropResult = (uid: string) => setResults((all) => {
    const next = { ...all }
    delete next[uid]
    return next
  })
  const duplicate = (uid: string) => {
    const copyUid = newUid()
    setArrived(copyUid)
    setSteps((arr) => {
      const i = arr.findIndex((s) => s.uid === uid)
      if (i < 0) return arr
      const src = arr[i]
      const copy: FullRunStep = {
        ...src, uid: copyUid, settings: structuredClone(src.settings),
        name: src.name?.trim() ? `${src.name.trim()} (copy)` : src.name,
      }
      return [...arr.slice(0, i + 1), copy, ...arr.slice(i + 1)]
    })
  }
  const remove = (uid: string) => {
    setUndo({ label: 'Undo remove', steps })
    if (open === uid) setOpen(null)
    setSteps((arr) => arr.filter((s) => s.uid !== uid))
  }
  const moveStep = (from: number, to: number) => setSteps((arr) => {
    const next = [...arr]
    const [s] = next.splice(from, 1)
    next.splice(to, 0, s)
    return next
  })
  const openStep = steps.find((s) => s.uid === open) ?? null
  const onSettingsChange = () => {
    persistFullRun()
    setEdits((n) => n + 1)
    // Only a real change: the editor writes the settings back, tidied, the
    // moment it opens, and that is not an edit -- it used to throw the
    // result away when the step was merely looked at.
    const kept = open ? results[open] : undefined
    if (open && kept?.planKey && kept.planKey !== planKeyOf(open)) dropResult(open)
  }

  // ---- results out
  const ranAny = resolved.some((x) => results[x.step.uid])
  const summaryRows = () => resolved.map((x, i) => {
    const o = results[x.step.uid]?.outcome
    return [
      i + 1, x.fullTitle, x.test.label, setups[x.test.setup].name, x.summary,
      o?.pass ?? 0, o?.fail ?? 0, o?.measured ?? 0, o?.planned ?? x.plan.length, o?.errors ?? 0,
      o ? formatDuration(o.ms) : '', x.enabled ? VERDICT_WORD[o?.verdict ?? 'not-run'] : 'Skipped',
      x.step.note?.trim() ?? '',
    ]
  })
  const summaryDraft = (): ReportEntryDraft => ({
    test: 'full-run',
    title: 'Test Sequence',
    settings: [['Steps', String(steps.length)], ['Run', String(active.length)]],
    columns: SUMMARY_HEADER,
    rows: summaryRows(),
  })
  const stepDrafts = (): ReportEntryDraft[] => resolved.flatMap((x, i) => {
    const res = results[x.step.uid]
    if (!res || res.rows.length === 0) return []
    const d = x.test.report(x.test.resolve(x.step.settings), res.rows)
    // Under its own test's id, so it lands on that test's tab beside the
    // runs from the test's page. Titled by step, so two copies of one test
    // stay apart there, and say where they came from.
    return [{ ...d, title: `${x.fullTitle} · ${x.summary} (Test Sequence step ${i + 1})` }]
  })
  // How many steps use each test, for the library's count beside it.
  const libraryCounts: Record<string, number> = {}
  for (const st of steps) libraryCounts[st.testId] = (libraryCounts[st.testId] ?? 0) + 1
  // ---- the sequence as a file
  const fileInput = useRef<HTMLInputElement | null>(null)
  const exportSequence = () => {
    const blob = new Blob([sequenceToFile(steps)], { type: 'application/json' })
    void saveBlob(blob, `test-sequence_${timestamp()}.json`)
  }
  const loadSequence = async (f: File) => {
    try {
      const { steps: loaded, skipped } = sequenceFromFile(await f.text(), newUid)
      // Replaces the sequence; Undo brings the one it replaced back.
      setUndo({ label: 'Undo open steps', steps })
      setOpen(null)
      setArrived(null)
      setSteps(loaded)
      notify.success(`Opened ${loaded.length} step${loaded.length === 1 ? '' : 's'} from ${f.name}`
        + (skipped ? ` · ${skipped} left out (test not in this version)` : ''))
    } catch (e) {
      notify.error((e as Error).message, { title: 'Could not open these steps' })
    }
  }

  // ---- the course: what the run will do, before it does it
  const planState: CheckState = active.length === 0 || problems.length ? 'block' : 'ok'
  const planSummary = steps.length === 0
    ? 'Add a test from the library'
    : active.length === 0
      ? 'Every step is switched off'
      : problems.length
        ? `Step ${resolved.indexOf(problems[0]) + 1}: ${problems[0].problem}`
        : `${active.length} step${active.length === 1 ? '' : 's'} · ${totalPoints} points · ≈ ${formatDuration(totalMs)}`
  const done = active.filter((x) => results[x.step.uid]).length
  const fails = active.filter((x) => results[x.step.uid]?.outcome.verdict === 'fail').length

  const canRun = active.length > 0 && problems.length === 0
  const progress = run.live ? `${run.live.index + 1}/${active.length}` : ''

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        label="Test Sequence"
        actions={
          <RunControls
            running={running}
            canRun={canRun}
            runLabel="Run sequence"
            progress={progress}
            blockedBy={active.length === 0 ? 'a step' : 'settings'}
            onRun={() => void run.start()}
            onStop={run.stop}
          />
        }
      />

      <PageBody width="fluid" grow>
        <CheckRail>
          <CheckStep state={planState} label="Sequence" summary={planSummary} />
          <CheckStep
            state={recables.length === 0 ? 'ok' : 'warn'}
            label="Re-cabling"
            summary={recables.length === 0
              ? 'None needed'
              : `${recables.length} pause${recables.length === 1 ? '' : 's'}`}
          />
          <CheckStep
            state={running ? 'busy' : !ranAny ? 'todo' : fails ? 'block' : 'ok'}
            label="Results"
            summary={running
              ? (
                <>
                  Step {(run.live?.index ?? 0) + 1} of {active.length} ·{' '}
                  <RunTiming
                    running={running}
                    completed={run.live?.index ?? 0}
                    total={active.length}
                    plannedTotalMs={totalMs}
                    sx={{ display: 'inline' }}
                  />
                </>
              )
              : !ranAny ? 'Not run yet' : `${done} of ${active.length} ran · ${fails} failed`}
          />
        </CheckRail>

        <Box
          sx={{
            flexGrow: 1, minHeight: 0, display: 'grid', gap: `${GRID_GAP}px`,
            gridTemplateColumns: '1fr', gridTemplateRows: 'auto minmax(0, 1fr)',
            [`@container (min-width: ${TWO_COL_MIN}px)`]: {
              gridTemplateColumns: `${LIBRARY_W}px minmax(0, 1fr)`,
              gridTemplateRows: 'minmax(0, 1fr)',
            },
          }}
        >
          <Section title="Tests" panel grow>
            {/* `scrollbarGutter: stable`: the bar's lane is kept whether or
                not it is needed, so it never narrows the content when it
                appears. The lane sits in the panel's right padding (a
                negative margin its width), or the list ended 10 px short of
                that side and the panel looked lopsided. */}
            <Box sx={{
              flexGrow: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable',
              mr: `-${SCROLLBAR_W}px`, containerType: 'inline-size', containerName: 'library',
            }}
            >
              <TestLibrary disabled={running} onAdd={(id) => insert(id)} counts={libraryCounts} />
            </Box>
          </Section>

          {/* The whole panel takes a test dragged from the library: a dashed
              outline while one is being dragged anywhere, solid with a tint
              once it is over the panel. */}
          <Box
            ref={setZone}
            sx={{
              display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: '12px',
              outline: libraryDrag ? `${dropOver ? 2 : 1.5}px ${dropOver ? 'solid' : 'dashed'} ${alpha(palette.sidebar.accent, dropOver ? 0.9 : 0.45)}` : 'none',
              outlineOffset: 2,
              bgcolor: dropOver ? alpha(palette.sidebar.accent, 0.04) : 'transparent',
              transition: 'outline-color 150ms, background-color 150ms',
              '& > *': { flexGrow: 1 },
            }}
          >
            <Section
              title="Sequence"
              panel
              grow
              action={
                // The list keeps a lane for its scrollbar; this row keeps the
                // same lane, so the keys end where the list does.
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{ flexShrink: 0, overflow: 'hidden', scrollbarGutter: 'stable' }}
                >
                  <Tooltip title={undo?.label ?? 'Nothing to undo'}>
                    <span>
                      <MiniAction
                        startIcon={<UndoIcon />}
                        disabled={running || !undo}
                        onClick={() => { if (undo) { setSteps(undo.steps); setUndo(null) } }}
                      >
                        Undo
                      </MiniAction>
                    </span>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
                  {/* The sequence itself -- its steps and their settings -- to
                      and from a file. "Load" / "Export" read as importing or
                      exporting test results, which is what Add to report is
                      for; these name what they move, with document icons
                      rather than upload / download arrows. */}
                  <Tooltip title="Open saved steps, not results">
                    <span>
                      <MiniAction startIcon={<FolderOpenIcon />} disabled={running} onClick={() => fileInput.current?.click()}>
                        Open steps
                      </MiniAction>
                    </span>
                  </Tooltip>
                  <Tooltip title="Save steps to a file, not results">
                    <span>
                      <MiniAction startIcon={<SaveIcon />} disabled={running || steps.length === 0} onClick={exportSequence}>
                        Save steps
                      </MiniAction>
                    </span>
                  </Tooltip>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    aria-label="Sequence file"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      // Reset first: picking the same file again fires no
                      // change otherwise, and the second load looks ignored.
                      e.target.value = ''
                      if (f) void loadSequence(f)
                    }}
                  />
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
                  <AddToReport disabled={!ranAny || running} build={summaryDraft} more={stepDrafts} addBuild={false} />
                  <MiniAction
                    tone="destructive"
                    startIcon={<DeleteSweepIcon />}
                    disabled={!ranAny || running}
                    onClick={() => setResults({})}
                  >
                    Clear
                  </MiniAction>
                </Stack>
              }
            >
              {/* The scroll area reaches into the panel's padding (negative
                  margin, matching padding), so its clip edge sits there: a
                  step lifted to drag is drawn a little larger and with a
                  shadow, and clipped at the rows' own edge it looked pushed
                  under the panel's border. The rows stay where they were. */}
              <Box sx={{
                flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', scrollbarGutter: 'stable',
                mx: -1.75, px: 1.75,
              }}
              >
                <Box sx={{ minWidth: 680, pb: 0.5, height: '100%' }}>
                  <StepList
                    steps={views}
                    running={running}
                    open={open}
                    onOpen={(uid) => {
                    // Opening the new step is seeing it: it stops being new.
                    if (uid && uid === arrived) setArrived(null)
                    setOpen(uid)
                  }}
                    detail={openStep && (
                      <StepDetail
                        key={openStep.uid}
                        step={openStep}
                        link={run.link}
                        modem={run.modem}
                        onSettings={onSettingsChange}
                        onPatch={(p) => patch(openStep.uid, p)}
                        onDuplicate={() => duplicate(openStep.uid)}
                        onRemove={() => remove(openStep.uid)}
                        results={(results[openStep.uid]?.rows as JudgedRow[] | undefined) ?? null}
                        running={running}
                        live={running && run.live?.uid === openStep.uid}
                        tab={stepTabs[openStep.uid] ?? 'sweep'}
                        onTab={(v) => setStepTabs((all) => ({ ...all, [openStep.uid]: v }))}
                      />
                    )}
                    arrived={arrived}
                    onMove={moveStep}
                    onInsert={insert}
                    onToggle={(uid, enabled) => patch(uid, { enabled })}
                    onDuplicate={duplicate}
                    onRemove={remove}
                    zone={zone}
                  onDropOver={setDropOver}
                  empty={
                      <Typography sx={{ ...TEXT.label, color: 'text.secondary' }}>
                        Drag a test here, or press +
                      </Typography>
                    }
                  />
                </Box>
              </Box>

            </Section>
          </Box>
        </Box>
      </PageBody>

      {run.prompt && (
        <RecablePrompt
          open
          stepLabel={`step ${run.prompt.index + 1} · ${resolved.find((x) => x.step.uid === run.prompt?.uid)?.fullTitle ?? ''}`}
          from={run.prompt.from ? setups[run.prompt.from] : null}
          to={setups[run.prompt.to]}
          onContinue={() => run.prompt?.answer(true)}
          onStop={run.stop}
        />
      )}

      {run.modem.dialog}
      {run.preflightDialog}
    </Box>
  )
}

export { FULL_RUN_ID }
