/**
 * Before/after captures for the redesign. Adapted from
 * docs/manual/tools/capture-screenshots.cjs, with the same safety rules:
 * fresh headless profile per shot, example data seeded via init script,
 * only tabs and dialogs clicked (SAFE list), DUT gate lifted by CSS only.
 *
 * node capture.cjs <outDir> [baseUrl] [width] [height] [onlyShot...]
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const OUT = process.argv[2]
const BASE = process.argv[3] || 'http://localhost:5173'
const WIDTH = +(process.argv[4] || 1440)
const HEIGHT = +(process.argv[5] || 900)
const ONLY = process.argv.slice(6)
const THEMES = ['mid', 'dark', 'light']

const SAFE = new Set([
  'Automation', 'Manual', 'Instruments', 'Graph', 'Smith chart', 'Config', 'Close panel',
])

function exampleCwResults() {
  const rows = []
  for (const f of [902.3, 915, 927.5]) {
    for (const p of [10, 12, 14, 16, 18, 20]) {
      const short = 0.15 + (p - 10) * 0.09 + (f - 902.3) * 0.02
      const meas = +(p - short).toFixed(2)
      rows.push({
        freq_mhz: f, set_power_dbm: p, pa_mode: 2, measured_dbm: meas,
        measured_dbm_raw: +(meas - 20.5).toFixed(2), current_a: +(0.045 + 0.0045 * p + (f - 902.3) * 0.0002).toFixed(4),
        voltage_v: 3.6, margin_db: 1, verdict: Math.abs(meas - p) <= 1 ? 'pass' : 'fail',
        ok: true, status: 0, error: null,
      })
    }
  }
  return { tab: 'automation', automation: { settleMs: 400, results: rows,
    rows: [{ freq: '902.3,915,927.5', power: '10-20:2', paMode: 2, marginDb: '1' }] } }
}

function exampleLoadPull() {
  const results = []
  const n = 24
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n
    const gr = 0.45 * Math.cos(th), gi = 0.45 * Math.sin(th)
    const den = (1 - gr) ** 2 + gi ** 2
    const r = (50 * (1 - gr * gr - gi * gi)) / den, x = (50 * 2 * gi) / den
    const pout = 14 - 1.6 + 1.4 * Math.cos(th - 0.9)
    const pulses = 400 * i * 2
    results.push({
      pos_pulses: pulses, pos_mm: pulses / 400, freq_mhz: 915, power_dbm_setting: 14,
      power_dbm: +pout.toFixed(2), power_dbm_raw: +(pout - 20.5).toFixed(2),
      current_a: +(0.118 - 0.012 * Math.cos(th - 0.9)).toFixed(4),
      r_ohm: +r.toFixed(2), x_ohm: +x.toFixed(2), s11_db: +(20 * Math.log10(0.45)).toFixed(2), error: null,
    })
  }
  return { freqSpec: '915', powerSpec: '14', paMode: 2, settleMs: 400, deltaXmm: 2,
    zeroPulses: 0, endPulses: 400 * 2 * (n - 1), results }
}

const SHOTS = [
  { file: 'lora-cw-manual', page: 'power', full: true },
  { file: 'lora-cw-automation-results', page: 'power', seed: { 'power-page-snapshot-v1': exampleCwResults }, clicks: ['Automation'], full: true },
  { file: 'lora-cw-graph', page: 'power', seed: { 'power-page-snapshot-v1': exampleCwResults }, clicks: ['Automation', 'Graph'], modal: true },
  { file: 'lora-cw-gated', page: 'power', gated: true },
  { file: 'mode-sweep', page: 'power-sweep', full: true },
  { file: 'load-pull', page: 'load-pull', seed: { 'load-pull-page-snapshot-v1': exampleLoadPull }, full: true },
  { file: 'load-pull-smith', page: 'load-pull', seed: { 'load-pull-page-snapshot-v1': exampleLoadPull }, clicks: ['Smith chart'], modal: true },
  { file: 'lte-cw-manual', page: 'lte-cw', full: true },
  { file: 'lte-cw-automation', page: 'lte-cw', clicks: ['Automation'], full: true },
  { file: 'instruments-panel', page: 'power', clicks: ['Instruments'] },
  { file: 'dc-analyzer', page: 'dc-analyzer', full: true },
  // DUT shown as connected: /ble/status is answered in the browser, every
  // other /ble or /device request is refused, so nothing reaches the DUT.
  { file: 'lora-cw-manual-connected', page: 'power', connected: true },
  { file: 'lora-cw-automation-connected', page: 'power', seed: { 'power-page-snapshot-v1': exampleCwResults }, clicks: ['Automation'], connected: true },
  { file: 'mode-sweep-connected', page: 'power-sweep', connected: true },
  { file: 'load-pull-connected', page: 'load-pull', seed: { 'load-pull-page-snapshot-v1': exampleLoadPull }, connected: true },
  { file: 'lte-cw-automation-connected', page: 'lte-cw', clicks: ['Automation'], connected: true },
  // Signal generator shown keyed, to put an RF ON pill in the top bar. Its
  // state is answered in the browser; every other generator route is refused.
  { file: 'live-rf', page: 'signal-generator', connected: true, mock: exampleRfOn },
]

function exampleRfOn() {
  const off = { connected: false, idn: null, address: null, channel: null }
  return {
    '/instruments/status': {
      power_sensor: off, dc_analyzer: off, network_analyzer: off, spectrum: off,
      signal_generator: { connected: true, idn: 'Rohde&Schwarz,SML03', address: 'COM5', channel: 9600 },
    },
    '/instruments/signal-generator/state': {
      connected: true, idn: 'Rohde&Schwarz,SML03', port: 'COM5', freq_hz: 915e6, level_dbm: -10, rf_on: true, error: null,
    },
  }
}

async function clickSafe(page, name) {
  if (!SAFE.has(name)) throw new Error(`refusing to click "${name}" -- not in SAFE`)
  const exact = new RegExp(`^\\s*${name}\\s*$`, 'i')
  const loc = page.locator(`[aria-label="${name}"]`)
    .or(page.getByRole('tab', { name, exact: true }))
    .or(page.getByRole('button', { name, exact: true }))
    .or(page.locator('button, [role=button], li, div, span').filter({ hasText: exact }))
    .filter({ visible: true })
  await loc.last().click({ timeout: 4000, force: true })
  await page.waitForTimeout(700)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  for (const theme of THEMES) {
    const dir = path.join(OUT, theme)
    fs.mkdirSync(dir, { recursive: true })
    for (const s of SHOTS) {
      if (ONLY.length && !ONLY.includes(s.file)) continue
      const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
      const seed = Object.fromEntries(Object.entries(s.seed || {}).map(([k, fn]) => [k, JSON.stringify(fn())]))
      await ctx.addInitScript(({ id, seed, theme }) => {
        localStorage.setItem('app-theme-pref', JSON.stringify(theme))
        localStorage.setItem('active-page-v1', JSON.stringify(id))
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
      }, { id: s.page, seed, theme })
      const page = await ctx.newPage()
      if (s.connected) {
        await page.route(/\/(ble|device)(\/|$)/, (route) => {
          const req = route.request()
          const path = new URL(req.url()).pathname
          if (req.method() === 'GET' && path === '/ble/status') {
            return route.fulfill({ json: { connected: true, address: 'D4:A1:B2:C3:E4:F5', name: 'Sonata2IL', transport_ready: true } })
          }
          return route.abort()
        })
      }
      if (s.mock) {
        const answers = s.mock()
        await page.route('**/instruments/**', (route) => {
          const path = new URL(route.request().url()).pathname
          if (answers[path] && route.request().method() === 'GET') return route.fulfill({ json: answers[path] })
          if (path.startsWith('/instruments/signal-generator')) return route.abort()
          return route.continue()
        })
      }
      try {
        await page.goto(BASE)
        await page.waitForLoadState('networkidle').catch(() => {})
        if (!s.gated && !s.connected) {
          await page.addStyleTag({ content: '[aria-disabled="true"]{opacity:1!important;pointer-events:auto!important}' })
        }
        await page.waitForTimeout(1200)
        for (const c of s.clicks || []) await clickSafe(page, c)
        // Viewport shot: what is above the fold at this size.
        await page.screenshot({ path: path.join(dir, `${s.file}.png`) })
        if (s.full) {
          // Whole scroll content of the main scroller, for review of below-the-fold.
          const extra = await page.evaluate(() => {
            let max = 0
            for (const el of document.querySelectorAll('*')) {
              const oy = getComputedStyle(el).overflowY
              if ((oy === 'auto' || oy === 'scroll') && el.clientHeight > 200 && el.offsetParent !== null) {
                max = Math.max(max, el.scrollHeight - el.clientHeight)
              }
            }
            return max
          })
          if (extra > 0) {
            await page.setViewportSize({ width: WIDTH, height: Math.min(HEIGHT + extra + 8, 3000) })
            await page.waitForTimeout(400)
            await page.screenshot({ path: path.join(dir, `${s.file}--full.png`) })
          }
        }
        console.log('ok  ', theme, s.file)
      } catch (e) {
        console.log('FAIL', theme, s.file, '-', e.message.split('\n')[0])
      }
      await ctx.close()
    }
  }
  await browser.close()
})()
