/**
 * The three illustrations of the path loss calibration guide, as SVG driven by
 * one looping clock per scene. Everything a scene shows -- knob angle, both
 * readouts, the trace -- is computed from that one `t`, so the generator's
 * knob, its display and the meter can never drift out of step with each other.
 *
 * With reduced motion the clock stands at the end of the loop: each scene is
 * shown in its final, explanatory state, still and complete.
 */
import { useEffect, useState } from 'react'
import { useTheme } from '@mui/material'
import { useAppPalette } from '../../context/ThemeModeContext'

export type Meter = 'sensor' | 'analyzer'

/** Cable and connector losses of the reference cable and of the chain, as the
 *  illustration's worked numbers. Not measured: only an example. */
const REF_CABLE_DB = 0.8
const CHAIN_DB = 31.4

// ---------------------------------------------------------------- clock

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** 0..1 repeating every `periodMs`; 1 throughout under reduced motion. */
function useLoop(periodMs: number): number {
  const [t, setT] = useState(() => (prefersReducedMotion() ? 1 : 0))
  useEffect(() => {
    if (prefersReducedMotion()) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      setT(((now - start) % periodMs) / periodMs)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [periodMs])
  return t
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Progress through [a, b] of the loop, 0 before and 1 after. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
/** Critically damped feel: fast out, no overshoot. */
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// ------------------------------------------------------------- colours

function useColors() {
  const theme = useTheme()
  const p = useAppPalette()
  const light = theme.palette.mode === 'light'
  return {
    body: p.paper,
    bodyStroke: light ? '#C7C7CC' : 'rgba(255,255,255,0.22)',
    label: theme.palette.text.secondary,
    ink: theme.palette.text.primary,
    cable: light ? '#3A3A3C' : '#AEAEB2',
    accent: theme.palette.primary.main,
    ok: p.data.ok,
    // Instrument screens are dark in every mode, as the real ones are.
    screen: '#0E141B',
    screenGrid: 'rgba(255,255,255,0.08)',
    screenText: '#E8F0F7',
    trace: '#F2C94C',
    refLine: 'rgba(255,255,255,0.35)',
    sgText: '#7FE0A0',
  }
}

type Colors = ReturnType<typeof useColors>

// ------------------------------------------------------------ geometry

const VB = { w: 360, h: 196 }
const SG = { x: 12, y: 40, w: 112, h: 78 }
const SG_PORT = { x: 104, y: 104 }
const SG_KNOB = { x: 100, y: 72, r: 13 }
const AN = { x: 236, y: 34, w: 112, h: 92 }
const SENSOR_BOX = { x: 248, y: 40, w: 96, h: 40 }

/** Where the reference cable / the chain ends on the meter. */
function meterPort(meter: Meter) {
  return meter === 'analyzer' ? { x: 252, y: 114 } : { x: 236, y: 112 }
}

// ---------------------------------------------------------- instruments

function SignalGenerator({ c, levelDbm, knobDeg, locked }: {
  c: Colors; levelDbm: number | null; knobDeg: number; locked?: boolean
}) {
  return (
    <g>
      <text x={SG.x + SG.w / 2} y={SG.y - 10} textAnchor="middle" fontSize="10.5" fill={c.label}>
        Signal generator
      </text>
      <rect x={SG.x} y={SG.y} width={SG.w} height={SG.h} rx="9" fill={c.body} stroke={c.bodyStroke} />
      <rect x={SG.x + 10} y={SG.y + 12} width="62" height="26" rx="4" fill={c.screen} />
      <text x={SG.x + 66} y={SG.y + 30} textAnchor="end" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={c.sgText}>
        {levelDbm == null ? '-- dBm' : `${levelDbm >= 0 ? '+' : ''}${levelDbm.toFixed(1)}`}
      </text>
      {levelDbm != null && (
        <text x={SG.x + 14} y={SG.y + 30} fontSize="7" fill={c.sgText} opacity="0.7">dBm</text>
      )}
      {/* The level knob; its mark turns with the level. */}
      <g transform={`rotate(${knobDeg} ${SG_KNOB.x} ${SG_KNOB.y})`}>
        <circle cx={SG_KNOB.x} cy={SG_KNOB.y} r={SG_KNOB.r} fill={c.body} stroke={c.bodyStroke} strokeWidth="1.5" />
        <line x1={SG_KNOB.x} y1={SG_KNOB.y - 3} x2={SG_KNOB.x} y2={SG_KNOB.y - SG_KNOB.r + 3}
          stroke={c.ink} strokeWidth="2" strokeLinecap="round" />
      </g>
      {locked && (
        // Left where step 2 put it: a small padlock under the display.
        <g transform={`translate(${SG.x + 12} ${SG.y + 46})`} opacity="0.85">
          <rect x="0" y="5" width="9" height="7" rx="1.5" fill={c.label} />
          <path d="M2 5 V3.5 a2.5 2.5 0 0 1 5 0 V5" fill="none" stroke={c.label} strokeWidth="1.3" />
          <text x="13" y="11.5" fontSize="8.5" fill={c.label}>level unchanged</text>
        </g>
      )}
      <Port c={c} x={SG_PORT.x} y={SG_PORT.y} />
      <text x={SG_PORT.x - 10} y={SG_PORT.y + 3} textAnchor="end" fontSize="8" fill={c.label}>RF out</text>
    </g>
  )
}

function Port({ c, x, y, glow = 0 }: { c: Colors; x: number; y: number; glow?: number }) {
  return (
    <g>
      {glow > 0 && <circle cx={x} cy={y} r={6 + 8 * glow} fill="none" stroke={c.accent} strokeWidth="1.5" opacity={1 - glow} />}
      <circle cx={x} cy={y} r="5" fill={c.body} stroke={c.cable} strokeWidth="1.5" />
      <circle cx={x} cy={y} r="1.8" fill={c.cable} />
    </g>
  )
}

/** The meter's reading, shared by both kinds: "--" before anything arrives. */
function reading(dbm: number | null): string {
  return dbm == null ? '--.--' : `${dbm >= 0 && dbm < 0.005 ? ' ' : ''}${dbm.toFixed(2)}`
}

function Analyzer({ c, dbm, done, glow }: { c: Colors; dbm: number | null; done?: boolean; glow?: number }) {
  const sx = AN.x + 8, sy = AN.y + 8, sw = AN.w - 16, sh = 62
  const refY = sy + 12                       // the 0 dBm reference line
  const yOf = (l: number) => Math.min(sy + sh - 6, refY + (0 - l) * 1.05)
  const floor = sy + sh - 7
  const peakY = dbm == null ? floor : yOf(dbm)
  // Noise floor with a little texture, and the CW line in the middle.
  const pts: string[] = []
  for (let i = 0; i <= 52; i++) {
    const x = sx + (i / 52) * sw
    const d = Math.abs(i - 26)
    const noise = ((i * 37) % 7) * 0.45
    const y = d === 0 ? peakY : d === 1 ? Math.min(floor, peakY + (floor - peakY) * 0.55) : floor - noise
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  const port = meterPort('analyzer')
  return (
    <g>
      <text x={AN.x + AN.w / 2} y={AN.y - 10} textAnchor="middle" fontSize="10.5" fill={c.label}>Spectrum analyzer</text>
      <rect x={AN.x} y={AN.y} width={AN.w} height={AN.h} rx="9" fill={c.body} stroke={c.bodyStroke} />
      <rect x={sx} y={sy} width={sw} height={sh} rx="4" fill={c.screen} />
      {[1, 2, 3].map((k) => (
        <line key={k} x1={sx} x2={sx + sw} y1={sy + (k * sh) / 4} y2={sy + (k * sh) / 4} stroke={c.screenGrid} />
      ))}
      <line x1={sx} x2={sx + sw} y1={refY} y2={refY} stroke={c.refLine} strokeDasharray="3 3" />
      <text x={sx + 3} y={refY - 3} fontSize="6.5" fill={c.refLine}>0 dBm</text>
      <polyline points={pts.join(' ')} fill="none" stroke={c.trace} strokeWidth="1.2" strokeLinejoin="round" />
      <text x={sx + sw - 4} y={sy + 10} textAnchor="end" fontSize="8.5" fontFamily="ui-monospace, Menlo, monospace"
        fill={done ? c.sgText : c.screenText}>
        {reading(dbm)} dBm
      </text>
      <Port c={c} x={port.x} y={port.y} glow={glow} />
      <text x={port.x + 10} y={port.y + 3} fontSize="8" fill={c.label}>RF in</text>
    </g>
  )
}

function PowerSensor({ c, dbm, done, glow }: { c: Colors; dbm: number | null; done?: boolean; glow?: number }) {
  const port = meterPort('sensor')
  const b = SENSOR_BOX
  return (
    <g>
      <text x={b.x + b.w / 2} y={b.y - 10} textAnchor="middle" fontSize="10.5" fill={c.label}>Power sensor</text>
      {/* The reading as the app shows it, on a small screen. */}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="7" fill={c.screen} />
      <text x={b.x + b.w - 8} y={b.y + 26} textAnchor="end" fontSize="14" fontFamily="ui-monospace, Menlo, monospace"
        fill={done ? c.sgText : c.screenText}>
        {reading(dbm)}
      </text>
      <text x={b.x + 8} y={b.y + 13} fontSize="7" fill={c.refLine}>dBm</text>
      {/* The sensor head, its USB lead up to the reading. */}
      <path d={`M${port.x + 70} ${port.y} C ${port.x + 92} ${port.y}, ${b.x + b.w - 8} ${port.y - 10}, ${b.x + b.w - 14} ${b.y + b.h}`}
        fill="none" stroke={c.cable} strokeWidth="1.6" />
      <rect x={port.x + 4} y={port.y - 10} width="66" height="20" rx="10" fill={c.body} stroke={c.bodyStroke} />
      <text x={port.x + 37} y={port.y + 3.5} textAnchor="middle" fontSize="7.5" fill={c.label}>sensor head</text>
      <Port c={c} x={port.x} y={port.y} glow={glow} />
    </g>
  )
}

function MeterView({ meter, ...rest }: { meter: Meter; c: Colors; dbm: number | null; done?: boolean; glow?: number }) {
  return meter === 'analyzer' ? <Analyzer {...rest} /> : <PowerSensor {...rest} />
}

/** The reference cable's path from the generator's port to the meter's. */
function cablePath(meter: Meter): string {
  const m = meterPort(meter)
  return `M${SG_PORT.x} ${SG_PORT.y} C ${SG_PORT.x} ${SG_PORT.y + 58}, ${m.x - 40} ${m.y + 52}, ${m.x} ${m.y}`
}

function Stage({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} width="100%" role="img" aria-label={label}
      style={{ display: 'block', overflow: 'visible' }}>
      {children}
    </svg>
  )
}

// -------------------------------------------------------------- step 1

/** The reference cable draws itself from RF out to the meter, which lights
 *  its port as it lands. */
export function ConnectScene({ meter }: { meter: Meter }) {
  const c = useColors()
  const t = useLoop(3400)
  const draw = easeInOut(seg(t, 0.08, 0.55))
  const glow = seg(t, 0.55, 0.85)
  const fade = 1 - seg(t, 0.92, 1)
  const head = draw > 0 && draw < 1
  const m = meterPort(meter)
  return (
    <Stage label="A cable from the signal generator's RF out to the meter's input">
      <SignalGenerator c={c} levelDbm={null} knobDeg={0} />
      <MeterView meter={meter} c={c} dbm={null} glow={glow > 0 && glow < 1 ? easeOut(glow) : 0} />
      <path d={cablePath(meter)} pathLength={1} fill="none" stroke={c.cable} strokeWidth="2.6"
        strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - draw} opacity={fade} />
      {/* Its connector, travelling with the drawn end. */}
      {head && <ConnectorHead c={c} meter={meter} at={draw} />}
      {draw >= 1 && <circle cx={m.x} cy={m.y} r="3" fill={c.accent} opacity={fade} />}
      <Caption c={c} text="Reference cable only" />
    </Stage>
  )
}

function ConnectorHead({ c, meter, at }: { c: Colors; meter: Meter; at: number }) {
  // A cubic Bezier evaluated at `at`, the same curve as cablePath.
  const m = meterPort(meter)
  const P = [
    [SG_PORT.x, SG_PORT.y], [SG_PORT.x, SG_PORT.y + 58], [m.x - 40, m.y + 52], [m.x, m.y],
  ]
  const u = 1 - at
  const x = u * u * u * P[0][0] + 3 * u * u * at * P[1][0] + 3 * u * at * at * P[2][0] + at * at * at * P[3][0]
  const y = u * u * u * P[0][1] + 3 * u * u * at * P[1][1] + 3 * u * at * at * P[2][1] + at * at * at * P[3][1]
  return <circle cx={x} cy={y} r="4" fill={c.body} stroke={c.cable} strokeWidth="2" />
}

function Caption({ c, text, tone }: { c: Colors; text: string; tone?: 'ok' | 'accent' }) {
  const color = tone === 'ok' ? c.ok : tone === 'accent' ? c.accent : c.label
  return (
    <text x={VB.w / 2} y={VB.h - 6} textAnchor="middle" fontSize="10.5" fontWeight={tone ? 600 : 400} fill={color}>
      {text}
    </text>
  )
}

// -------------------------------------------------------------- step 2

/** The knob turns, the generator's level climbs, and the meter follows a
 *  cable's loss behind it until it reads 0.00 dBm. */
export function LevelScene({ meter }: { meter: Meter }) {
  const c = useColors()
  const t = useLoop(4400)
  const p = easeOut(seg(t, 0.06, 0.62))
  const start = -12
  const sg = start + p * (REF_CABLE_DB - start)
  const meterDbm = sg - REF_CABLE_DB
  const done = p >= 1
  const settle = seg(t, 0.62, 0.8)
  return (
    <Stage label="The signal generator's level is turned up until the meter reads 0 dBm">
      <SignalGenerator c={c} levelDbm={sg} knobDeg={p * 300} />
      <MeterView meter={meter} c={c} dbm={meterDbm} done={done} glow={done && settle < 1 ? easeOut(settle) : 0} />
      <path d={cablePath(meter)} fill="none" stroke={c.cable} strokeWidth="2.6" strokeLinecap="round" />
      {/* A turning hint around the knob while it moves. */}
      {!done && (
        <path d={arc(SG_KNOB.x, SG_KNOB.y, SG_KNOB.r + 6, -60, 40)} fill="none" stroke={c.accent}
          strokeWidth="1.6" strokeLinecap="round" markerEnd="url(#plg-arrow)" opacity="0.9" />
      )}
      <defs>
        <marker id="plg-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill={c.accent} />
        </marker>
      </defs>
      <Caption c={c} text={done ? '0.00 dBm at the meter' : 'Turn to 0 dBm'}
        tone={done ? 'ok' : undefined} />
    </Stage>
  )
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const [x1, y1] = pt(fromDeg)
  const [x2, y2] = pt(toDeg)
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

// -------------------------------------------------------------- step 3

const BLOCKS = [
  { x: 130, label: '20 dB', sub: 'attenuator' },
  { x: 178, label: '10 dB', sub: 'attenuator' },
]
const BLOCK = { y: 150, w: 38, h: 22 }

/** The reference cable gives way to the test chain, the reading drops, and
 *  what it dropped by is the path loss. */
export function ChainScene({ meter }: { meter: Meter }) {
  const c = useColors()
  const t = useLoop(5200)
  const out = seg(t, 0.04, 0.18)               // reference cable leaves
  const drop = (i: number) => easeOut(seg(t, 0.16 + i * 0.08, 0.32 + i * 0.08))
  const wire = seg(t, 0.36, 0.48)              // the chain's cables join up
  const fall = easeInOut(seg(t, 0.48, 0.72))
  const done = fall >= 1
  const reveal = easeOut(seg(t, 0.72, 0.86))
  const fade = 1 - seg(t, 0.95, 1)
  const meterDbm = 0 - fall * CHAIN_DB
  const m = meterPort(meter)
  const midY = BLOCK.y + BLOCK.h / 2
  const chain = [
    `M${SG_PORT.x} ${SG_PORT.y} C ${SG_PORT.x} ${midY}, ${BLOCKS[0].x - 20} ${midY}, ${BLOCKS[0].x} ${midY}`,
    `M${BLOCKS[0].x + BLOCK.w} ${midY} L ${BLOCKS[1].x} ${midY}`,
    `M${BLOCKS[1].x + BLOCK.w} ${midY} C ${BLOCKS[1].x + BLOCK.w + 26} ${midY}, ${m.x} ${midY}, ${m.x} ${m.y}`,
  ]
  return (
    <Stage label="The cables and attenuators are connected between the generator and the meter, and the drop in the reading is the path loss">
      <SignalGenerator c={c} levelDbm={REF_CABLE_DB} knobDeg={300} locked />
      <MeterView meter={meter} c={c} dbm={meterDbm} />
      <path d={cablePath(meter)} fill="none" stroke={c.cable} strokeWidth="2.6" strokeLinecap="round"
        opacity={(1 - out) * 0.9} strokeDasharray="4 4" />
      <g opacity={fade}>
        {chain.map((d, i) => (
          <path key={i} d={d} pathLength={1} fill="none" stroke={c.cable} strokeWidth="2.6" strokeLinecap="round"
            strokeDasharray="1 1" strokeDashoffset={1 - wire} />
        ))}
        {BLOCKS.map((b, i) => {
          const k = drop(i)
          return (
            <g key={b.label} opacity={k} transform={`translate(0 ${(1 - k) * -14})`}>
              <rect x={b.x} y={BLOCK.y} width={BLOCK.w} height={BLOCK.h} rx="5" fill={c.body} stroke={c.bodyStroke} />
              <text x={b.x + BLOCK.w / 2} y={BLOCK.y + 14.5} textAnchor="middle" fontSize="9" fontWeight="600" fill={c.ink}>
                {b.label}
              </text>
            </g>
          )
        })}
        <text x={(BLOCKS[0].x + BLOCKS[1].x + BLOCK.w) / 2} y={BLOCK.y - 5} textAnchor="middle" fontSize="8"
          fill={c.label} opacity={drop(1)}>
          cables + attenuators
        </text>
      </g>
      <g opacity={reveal * fade}>
        <Caption c={c} tone="accent" text={`Path loss = ${CHAIN_DB.toFixed(1)} dB`} />
      </g>
      {!done && reveal === 0 && <Caption c={c} text="Through the chain" />}
    </Stage>
  )
}
