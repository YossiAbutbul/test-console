import type { Dispatch, SetStateAction } from 'react'
import { Box, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import { LabeledField } from '../../components/LabeledField'
import { MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { FieldGrid, MONO, MiniAction, Section, SegmentedChoice, TEXT } from '../../ui'
import { convertChannelSpec, type ChannelUnit } from '../lte/channel'
import { ATT_MAX_LIMIT_DB } from './attSpec'

/** What the Frequency, DUT power and Att values fields accept (see
 *  lib/numericList). Any of them can also mix ranges and values. */
/** Examples of the four forms, in the field's own unit. */
const SPEC_EXAMPLES = {
  mhz: ['915', '900-930', '900-930:5', '902.3, 915'],
  lteMhz: ['1880', '1860-1900', '1860-1900:10', '1860, 1880'],
  earfcn: ['18900', '18700-19100', '18700-19100:100', '18700, 18900'],
  dbm: ['14', '10-20', '10-20:2', '10, 14, 20'],
  lteDbm: ['23', '10-23', '10-23:1', '10, 17, 23'],
  att: ['10', '0-20', '0-20:2', '0-5, 8, 9, 20'],
} as const

/**
 * The list syntax as four labelled examples. It was one sentence naming the
 * forms in prose ("a stepped range \"a-b:step\" …"), which read as a rule to
 * decode rather than something to copy.
 */
function SpecTip({ examples }: { examples: readonly string[] }) {
  const names = ['One', 'Range', 'Step', 'List']
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 1.5, rowGap: 0.25 }}>
      {examples.map((ex, i) => (
        <Box key={names[i]} sx={{ display: 'contents' }}>
          <span>{names[i]}</span>
          <Box component="span" sx={{ fontFamily: MONO }}>{ex}</Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The Load Pull page's Test point card: what each point is measured at.
 * Moved out of LoadPullPage as it stood; the page owns every value here.
 */
export function TestPointSection({
  anchorId, isLte, running,
  channelUnit, setChannelUnit, lteBands, onEditBands,
  freqSpec, setFreqSpec, freqUnit, nFreqs, unresolvedChannels, channelProblems,
  powerSpec, setPowerSpec, nPowers, powersOutOfRange,
  paMode, setPaMode,
  settleText, setSettleText, settleMs,
  attEnabled, setAttEnabled, attSpec, setAttSpec, attRangeOk, nAttSteps,
  nPositions,
}: {
  anchorId: string
  isLte: boolean
  running: boolean
  channelUnit: ChannelUnit
  setChannelUnit: (u: ChannelUnit) => void
  lteBands: number[]
  onEditBands: () => void
  freqSpec: string
  setFreqSpec: Dispatch<SetStateAction<string>>
  freqUnit: string
  nFreqs: number
  unresolvedChannels: number
  channelProblems: string[]
  powerSpec: string
  setPowerSpec: Dispatch<SetStateAction<string>>
  nPowers: number
  powersOutOfRange: boolean
  paMode: number
  setPaMode: Dispatch<SetStateAction<number>>
  settleText: string
  setSettleText: Dispatch<SetStateAction<string>>
  settleMs: number | null
  attEnabled: boolean
  setAttEnabled: Dispatch<SetStateAction<boolean>>
  attSpec: string
  setAttSpec: Dispatch<SetStateAction<string>>
  attRangeOk: boolean
  nAttSteps: number
  nPositions: number
}) {
  return (
        <Section
          title="Test point"
          anchorId={anchorId}
          panel
          // LTE only: which unit Channel is read in. The setting every LTE
          // page shares; switching here rewrites the channels typed so far
          // into the new unit, as the LTE automation tabs do.
          action={isLte && (
            <SegmentedChoice
              aria-label="Channel unit"
              value={channelUnit}
              options={[
                { value: 'mhz', label: 'MHz' },
                { value: 'earfcn', label: 'EARFCN' },
              ]}
              onChange={(next: ChannelUnit) => {
                setFreqSpec((spec) => convertChannelSpec(spec, channelUnit, next, lteBands))
                setChannelUnit(next)
              }}
              disabled={running}
            />
          )}
        >
          <FieldGrid columns={4}>
            {/* The list syntax lives on the two fields that take it, rather
                than as a line of its own under the grid. A wrapper because
                LabeledField does not forward a ref for the tooltip. */}
            <Tooltip
              title={<SpecTip examples={!isLte ? SPEC_EXAMPLES.mhz : channelUnit === 'earfcn' ? SPEC_EXAMPLES.earfcn : SPEC_EXAMPLES.lteMhz} />}
              placement="top-start"
            >
              <Box>
                {/* LTE takes channels in the unit every LTE page reads (the
                    switch on this card's header), resolved within its
                    selected bands. */}
                <LabeledField
                  label={isLte ? 'Channel' : 'Frequency'} hint={freqUnit} value={freqSpec}
                  onChange={(e) => setFreqSpec(e.target.value)}
                  disabled={running}
                  error={freqSpec.trim() !== '' && (nFreqs === 0 || unresolvedChannels > 0)}
                  placeholder={!isLte ? '915, 900-930:5 or 902.3,915'
                    : channelUnit === 'earfcn' ? '18900 or 18700-19100:100' : '1880 or 1860-1900:10'}
                />
              </Box>
            </Tooltip>
            <Tooltip title={<SpecTip examples={isLte ? SPEC_EXAMPLES.lteDbm : SPEC_EXAMPLES.dbm} />} placement="top-start">
              <Box>
                <LabeledField
                  label="DUT power" hint="dBm" value={powerSpec}
                  onChange={(e) => setPowerSpec(e.target.value)}
                  disabled={running}
                  error={powerSpec.trim() !== '' && (nPowers === 0 || powersOutOfRange)}
                  placeholder={isLte ? '23 or 10-23:1' : '14 or 10-20:2'}
                />
              </Box>
            </Tooltip>
            {/* LoRa's PA selection. The LTE modem has no such setting. */}
            {!isLte && (
              <LabeledField
                label="PA mode" select value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
                disabled={running}
              >
                <MenuItem value={2}>Auto</MenuItem>
                <MenuItem value={1}>On</MenuItem>
                <MenuItem value={0}>Off</MenuItem>
              </LabeledField>
            )}
            <LabeledField
              label="Settle" hint={`ms · min ${MIN_SETTLE_MS}`} type="number" value={settleText}
              onChange={(e) => setSettleText(e.target.value)}
              // Raise a typed-but-too-low value to the floor on blur; leave an
              // empty field empty, so it can be cleared and retyped.
              onBlur={() => setSettleText((t) => (
                t.trim() === '' ? t : String(clampSettleMs(Number(t)))
              ))}
              disabled={running}
              error={settleMs == null}
              inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
            />
            {/* The attenuator sits on the trombone's second output and is set
                by hand, so sweeping it is opt-in — off, the run behaves exactly
                as it did before. Filed with the other test-point fields rather
                than in a row of its own, which read as a different kind of
                setting. */}
            <LabeledField
              label="Attenuator" select value={attEnabled ? 1 : 0}
              onChange={(e) => setAttEnabled(Number(e.target.value) === 1)}
              disabled={running}
            >
              <MenuItem value={0}>Off</MenuItem>
              <MenuItem value={1}>Sweep</MenuItem>
            </LabeledField>
            <Tooltip title={<SpecTip examples={SPEC_EXAMPLES.att} />} placement="top-start">
              <Box>
                <LabeledField
                  label="Att values" hint={`dB · 0–${ATT_MAX_LIMIT_DB}`} value={attSpec}
                  onChange={(e) => setAttSpec(e.target.value)}
                  disabled={running || !attEnabled}
                  error={attEnabled && !attRangeOk}
                  placeholder="0-20, 0-20:2 or 0-5, 8, 20"
                />
              </Box>
            </Tooltip>
          </FieldGrid>
          {/* The plan multiplies out fast — three positions of a 30-point
              trombone sweep across four powers is 360 points — so say what it
              is a product of next to the fields that decide it. The total is
              on the Plan tile and beside Delta X; this line is only the
              factors. Always one line tall, so the card does not grow when
              the plan becomes complete. */}
          {/* LTE: the same line names any channel the selected bands cannot
              resolve, and carries Edit bands, so the band list can be fixed
              here rather than only on the LTE CW page. One line either way,
              cut with an ellipsis, so the card keeps its height. */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, minHeight: isLte ? 26 : 18 }}>
          {channelProblems.length > 0 ? (
            <Typography
              title={`Not in bands ${lteBands.join(', ')}: ${channelProblems.join('; ')}`}
              sx={{ ...TEXT.micro, color: 'warning.main', flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              Not in bands {lteBands.join(', ')}: {channelProblems.join(' · ')}
            </Typography>
          ) : (
          <Typography sx={{ ...TEXT.micro, color: 'text.secondary', flexGrow: 1, minWidth: 0 }}>
            {nPositions > 0 && nFreqs > 0 && nPowers > 0 ? (
              <>
                {nPositions} {nPositions === 1 ? 'position' : 'positions'}
                {' × '}{nFreqs} {isLte ? (nFreqs === 1 ? 'channel' : 'channels') : (nFreqs === 1 ? 'freq' : 'freqs')}
                {' × '}{nPowers} {nPowers === 1 ? 'power' : 'powers'}
                {attEnabled && attRangeOk && (
                  <>{' × '}{nAttSteps} att</>
                )}
              </>
            ) : ' '}
          </Typography>
          )}
          {isLte && (
            <MiniAction onClick={onEditBands} disabled={running}>
              Edit bands
            </MiniAction>
          )}
          </Stack>
        </Section>
  )
}
