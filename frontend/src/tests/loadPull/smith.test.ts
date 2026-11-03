import { describe, it, expect } from 'vitest'
import { reflection, dbmToW, efficiency, rampColor, RAMP, gammaMag, vswr, vswrLabel, chartRows, deembed, deembedRows } from './smith'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'

const row = (p: Partial<LoadPullResultRow>): LoadPullResultRow => ({
  pos_pulses: 0, pos_mm: 0, power_dbm: null, current_a: null,
  r_ohm: null, x_ohm: null, s11_db: null, error: null, ...p,
})

describe('reflection (Γ)', () => {
  it('matched 50Ω load → centre (0,0)', () => {
    const g = reflection(50, 0)
    expect(g.gr).toBeCloseTo(0, 6)
    expect(g.gi).toBeCloseTo(0, 6)
  })
  it('short (0Ω) → Γ = -1', () => {
    const g = reflection(0, 0)
    expect(g.gr).toBeCloseTo(-1, 6)
    expect(g.gi).toBeCloseTo(0, 6)
  })
  it('open (huge R) → Γ ≈ +1', () => {
    const g = reflection(1e9, 0)
    expect(g.gr).toBeCloseTo(1, 4)
  })
  it('purely reactive load stays on the unit circle (|Γ|=1)', () => {
    const g = reflection(0, 50)
    expect(Math.hypot(g.gr, g.gi)).toBeCloseTo(1, 6)
  })
})

describe('dbmToW', () => {
  it('30 dBm = 1 W', () => expect(dbmToW(30)).toBeCloseTo(1, 9))
  it('0 dBm = 1 mW', () => expect(dbmToW(0)).toBeCloseTo(1e-3, 12))
  it('+3 dBm ≈ 2 mW', () => expect(dbmToW(3)).toBeCloseTo(1.995e-3, 6))
})

describe('efficiency', () => {
  it('null when power or current missing', () => {
    expect(efficiency(row({ power_dbm: 20 }))).toBeNull()
    expect(efficiency(row({ current_a: 0.1 }))).toBeNull()
  })
  it('null when current is zero/negative', () => {
    expect(efficiency(row({ power_dbm: 20, current_a: 0 }))).toBeNull()
  })
  it('30 dBm @ 3.6V·1A = 1W/3.6W ≈ 0.2778', () => {
    expect(efficiency(row({ power_dbm: 30, current_a: 1 }))).toBeCloseTo(1 / 3.6, 6)
  })
})

describe('rampColor', () => {
  it('clamps endpoints to the ramp ends', () => {
    expect(rampColor(-5)).toBe(RAMP[0])
    expect(rampColor(2)).toBe(RAMP[RAMP.length - 1])
  })
  it('returns a hex colour', () => {
    expect(rampColor(0.5)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('gammaMag', () => {
  it('reads |S11| in dB when the marker reported one', () => {
    expect(gammaMag(row({ s11_db: 0 }))).toBeCloseTo(1, 9)
    expect(gammaMag(row({ s11_db: -20 }))).toBeCloseTo(0.1, 9)
  })
  it('falls back to the impedance when S11 is missing', () => {
    // Short: |Γ| = 1 whichever way it is worked out.
    expect(gammaMag(row({ r_ohm: 0, x_ohm: 0 }))).toBeCloseTo(1, 6)
  })
  it('null with nothing to work from', () => {
    expect(gammaMag(row({}))).toBeNull()
    expect(gammaMag(row({ r_ohm: 50 }))).toBeNull()
  })
})

describe('vswr', () => {
  it('matched load (|Γ|=0) is 1:1', () => {
    expect(vswr(row({ r_ohm: 50, x_ohm: 0 }))).toBeCloseTo(1, 6)
  })
  it('-20 dB return loss → |Γ|=0.1 → 1.222', () => {
    expect(vswr(row({ s11_db: -20 }))).toBeCloseTo(1.2222, 4)
  })
  it('-9.54 dB → |Γ|≈1/3 → 2:1', () => {
    expect(vswr(row({ s11_db: -9.542 }))).toBeCloseTo(2, 3)
  })
  it('total reflection is unbounded, not a small positive number', () => {
    expect(vswr(row({ s11_db: 0 }))).toBe(Infinity)
    // Slightly over 0 dB happens on a stale calibration; the plain formula
    // would flip the sign and return something that looks like a good match.
    expect(vswr(row({ s11_db: 0.5 }))).toBe(Infinity)
  })
  it('null when the point was never measured', () => {
    expect(vswr(row({}))).toBeNull()
  })
})

describe('vswrLabel', () => {
  it('two decimals, dash when unmeasured, ∞ at total reflection', () => {
    expect(vswrLabel(row({ s11_db: -20 }))).toBe('1.22')
    expect(vswrLabel(row({}))).toBe('—')
    expect(vswrLabel(row({ s11_db: 0 }))).toBe('∞')
  })
})

describe('chartRows', () => {
  it('keeps each row\'s index in the whole run, so chart step == table #', () => {
    const results = [
      row({ freq_mhz: 900, power_dbm_setting: 10 }),
      row({ freq_mhz: 915, power_dbm_setting: 10 }),
      row({ freq_mhz: 900, power_dbm_setting: 14 }),
      row({ freq_mhz: 900, power_dbm_setting: 10 }),
    ]
    const shown = chartRows(results, 900, 10)
    expect(shown.map((s) => s.idx)).toEqual([0, 3])
    expect(shown[1].row).toBe(results[3])
  })
  it('applies no filter to rows that carry no frequency or power', () => {
    const results = [row({}), row({ freq_mhz: 915 }), row({ power_dbm_setting: 14 })]
    expect(chartRows(results, 900, 10).map((s) => s.idx)).toEqual([0])
    expect(chartRows(results, null, null).map((s) => s.idx)).toEqual([0, 1, 2])
  })
  it('hides the attenuator settings asked, keeping each row index', () => {
    const results = [row({ att_db: 0 }), row({ att_db: 4 }), row({ att_db: 8 }), row({})]
    expect(chartRows(results, null, null, new Set([0, 8])).map((s) => s.idx)).toEqual([1, 3])
    expect(chartRows(results, null, null).map((s) => s.idx)).toEqual([0, 1, 2, 3])
  })
})

describe('deembed', () => {
  // The cable-correction table: 320.82 ps between PA and tuner.
  it.each([
    [902, 18.4, -26.3, 93.1, 81.8],
    [915, 18.9, -27.9, 92.8, 82.1],
    [928, 19.5, -29.4, 92.9, 81.9],
  ])('%s MHz: %s%s j Ω at the VNA is %s + j%s Ω at the PA', (f, r, x, rPa, xPa) => {
    const z = deembed(r, x, f, 320.82)
    expect(z.r).toBeCloseTo(rPa, 0)
    expect(z.x).toBeCloseTo(xPa, 0)
  })
  it('leaves a zero delay and rows without a frequency alone', () => {
    const z = deembed(18.4, -26.3, 902, 0)
    expect(z.r).toBeCloseTo(18.4)
    expect(z.x).toBeCloseTo(-26.3)
    const rows = [row({ r_ohm: 18.4, x_ohm: -26.3, freq_mhz: undefined })]
    expect(deembedRows(rows, 320.82)[0].r_ohm).toBe(18.4)
    expect(deembedRows(rows, 0)).toBe(rows)
  })
})
