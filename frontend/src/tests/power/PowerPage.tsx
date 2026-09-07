import { useEffect, useState } from 'react'
import { Box, MenuItem, Tab, Tabs } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import {
  FieldGrid, LastFrameSection, MeasureOptions, PageBody, RunControls, Section,
  SendStopControls, measuresAnything, requiredInstruments, type MeasureSelection,
} from '../../ui'
import type { CommandResponse } from '../../types/models'
import type { TestPageProps } from '../types'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'
import { powerPageSnapshot, persistPowerPage, type PowerPageTab } from '../../store/powerPageStore'

/** What the manual tab reads back by default: everything, as it always did.
 *  The operator can drop either, or both — see `MeasureOptions`. */
const DEFAULT_MEASURE: MeasureSelection = { power: true, current: true }

export function PowerPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const hasBackend = protocol === 'LoRa'
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [power, setPower] = useState(14)
  const [paMode, setPaMode] = useState(2)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)
  const [measure, setMeasure] = useState<MeasureSelection>(
    () => powerPageSnapshot.manualMeasure ?? DEFAULT_MEASURE,
  )
  useEffect(() => { powerPageSnapshot.manualMeasure = measure; persistPowerPage() }, [measure])
  const willMeasure = measuresAnything(measure)
  const preflight = useInstrumentPreflight(requiredInstruments(measure), { verb: 'send' })
  // The automation tab owns its run; it publishes just enough for the header
  // to render the buttons in the same slot the manual tab uses.
  const [autoCtl, setAutoCtl] = useState<AutomationControls | null>(null)
  const [tab, setTab] = useState<PowerPageTab>(() => powerPageSnapshot.tab ?? 'manual')
  useEffect(() => { powerPageSnapshot.tab = tab; persistPowerPage() }, [tab])

  const send = useMutation({
    mutationFn: async () => {
      if (!hasBackend) {
        log('DUT', `${protocol} Power: no backend wired yet`, 'warn')
        return null
      }
      // Connect the instruments before keying the PA, not after: the card
      // auto-measures once the command lands, and connecting a VISA session
      // takes long enough that the DUT would already be transmitting into a
      // sensor nobody was reading.
      //
      // Skipped outright when nothing is being measured. Preflight with an
      // empty list still puts a dialog in front of a transmit that needs no
      // instruments at all.
      if (willMeasure && !(await preflight.run())) {
        log('DUT', 'Send cancelled — instruments not ready', 'warn')
        return null
      }
      return device.loraPower({
        freq_hz: Math.round(freqMhz * 1_000_000),
        power_dbm: power,
        pa_mode: paMode,
      })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `Power sent: ok=${r.ok} status=${r.status}`)
      if (r.ok && willMeasure) setMeasureTrigger((n) => n + 1)
    },
    onError: (e: Error) => log('DUT', `Power failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    mutationFn: () => {
      if (!hasBackend) return Promise.resolve(null)
      return device.stop()
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `Stop sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log('DUT', `Stop failed: ${e.message}`, 'error'),
  })

  const busy = send.isPending || stop.isPending

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="CW"
        actions={
          // Both tabs put their primary action in the same place, so switching
          // tabs does not move Run/Send to a different part of the screen.
          tab === 'manual' ? (
            <SendStopControls
              busy={busy}
              sending={send.isPending}
              stopping={stop.isPending}
              onSend={() => send.mutate()}
              onStop={() => stop.mutate()}
            />
          ) : autoCtl ? (
            <RunControls
              running={autoCtl.running}
              canRun={autoCtl.canRun}
              progress={autoCtl.progress}
              onRun={autoCtl.onRun}
              onStop={autoCtl.onStop}
            />
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          minHeight: 36, mt: -0.5,
          borderBottom: 1, borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 36, py: 0.25, fontSize: 13 },
        }}
      >
        <Tab value="manual" label="Manual" />
        <Tab value="automation" label="Automation" />
      </Tabs>

      {/* Both panels stay mounted; toggle via display so switching is instant. */}
      <Box sx={{ display: tab === 'manual' ? 'block' : 'none' }}>
        <PageBody width="fluid">
          {/* Top-down: what to transmit, what went over the wire, what came
              back. The result sits last because that is where the eye lands
              after pressing Send. */}
          {/* Every field on one row: they are three short values, and stacking
              them made a tall lonely column that pushed the result off screen. */}
          <Section title="Transmit" panel>
            <FieldGrid>
              <LabeledField label="Frequency" hint="MHz" type="number" value={freqMhz}
                onChange={(e) => setFreqMhz(Number(e.target.value))}
                inputProps={{ step: 0.1 }} />
              <LabeledField label="Power" hint="dBm" type="number" value={power}
                onChange={(e) => setPower(Number(e.target.value))} />
              <LabeledField
                label="PA Mode"
                select
                value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
              >
                <MenuItem value={2}>Auto</MenuItem>
                <MenuItem value={1}>On</MenuItem>
                <MenuItem value={0}>Off</MenuItem>
              </LabeledField>
            </FieldGrid>
          </Section>

          {/* What to read back after the send. Above the result rather than
              beside it, because it decides whether there is one. */}
          <Section title="Measure" panel>
            <MeasureOptions value={measure} onChange={setMeasure} disabled={busy} />
          </Section>

          {/* The answer: what we asked for, what came out, and the error
              between them — the question this page exists to settle. Hidden
              when nothing is being measured; an empty strip of dashes reads
              as a failed read rather than one that was never asked for. */}
          {willMeasure && (
            <MeasurementCard
              freqHz={Math.round(freqMhz * 1_000_000)}
              triggerId={measureTrigger}
              targetDbm={power}
              wants={measure}
            />
          )}

          {/* Wire detail last, and collapsed: it explains a result you have
              already read. */}
          <LastFrameSection result={last} />
        </PageBody>
      </Box>

      <Box
        sx={{
          mt: 2, flexGrow: 1, minHeight: 0, flexDirection: 'column',
          display: tab === 'automation' ? 'flex' : 'none',
        }}
      >
        <AutomationPanel protocol={protocol} onControlsChange={setAutoCtl} />
      </Box>

      {preflight.dialog}
    </Box>
  )
}
