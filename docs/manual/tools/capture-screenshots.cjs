/**
 * Regenerates the screenshots in docs/manual/img/ from the running app.
 *
 * Every shot is taken in the app's Light theme so the manual reads the same
 * on screen and on paper, whatever theme the operator has chosen.
 *
 * SAFETY: the rig is live. This script only navigates, switches tabs and opens
 * dialogs. It never presses Send / Run / Move / Go / Step / Zero / RF On /
 * Apply / Capture / Connect -- a button that would key the PA, move the
 * trombone or drive the RF switch must not appear in the ACTIONS below.
 *
 * Usage (backend on :8000 and `npm run dev` on :5173 already running):
 *
 *   npm i --no-save --prefix %TEMP%\pw playwright-core
 *   set NODE_PATH=%TEMP%\pw\node_modules
 *   node docs\manual\tools\capture-screenshots.cjs [baseUrl]
 *
 * playwright-core drives the installed Google Chrome (channel "chrome"), so no
 * browser download is needed and nothing is added to the repo's packages.
 */
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = path.join(__dirname, '..', 'img')
const WIDTH = 1440
const HEIGHT = 900

/** Buttons that are allowed to be clicked. Anything else is refused. */
const SAFE = new Set([
  'Automation', 'Manual', 'Settings', 'Instruments', 'Edit path loss per frequency',
  'Bands in use', 'View setup', 'Smith chart', 'Graph', 'LTE', 'OTHER', 'COMPONENTS', 'BLE',
])

/**
 * Example results, seeded into this headless profile's localStorage so the
 * results tables, graphs and the Smith chart have something to show. They are
 * synthetic -- the manual captions them as example data -- and they never
 * reach the backend or the operator's own browser.
 */
function exampleCwResults() {
  const rows = []
  for (const f of [902.3, 915, 927.5]) {
    for (const p of [10, 12, 14, 16, 18, 20]) {
      const short = 0.15 + (p - 10) * 0.04 + (f - 902.3) * 0.01
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
  { file: 'shell-overview', page: 'power' },
  { file: 'sidebar-expanded', page: 'power', clicks: ['LTE', 'OTHER', 'COMPONENTS'], clip: 'nav' },
  { file: 'instruments-modal', page: 'power', clicks: ['Instruments'], modal: true },
  { file: 'settings', page: 'power', clicks: ['Settings'], modal: true },
  { file: 'path-loss-table', page: 'power', clicks: ['Edit path loss per frequency'], modal: true },

  { file: 'lora-cw-manual', page: 'power' },
  { file: 'lora-cw-automation', page: 'power', clicks: ['Automation'] },
  { file: 'lora-cw-results', page: 'power', seed: { 'power-page-snapshot-v1': exampleCwResults }, clicks: ['Automation'] },
  { file: 'lora-cw-graph', page: 'power', seed: { 'power-page-snapshot-v1': exampleCwResults }, clicks: ['Automation', 'Graph'], modal: true },
  { file: 'dut-page-dimmed', page: 'power', gated: true },
  { file: 'lora-modulated-manual', page: 'modulated' },
  { file: 'lora-modulated-automation', page: 'modulated', clicks: ['Automation'] },
  { file: 'lora-debug', page: 'cw-debug' },
  { file: 'mode-sweep', page: 'power-sweep' },

  { file: 'lte-cw-manual', page: 'lte-cw' },
  { file: 'lte-cw-automation', page: 'lte-cw', clicks: ['Automation'] },
  { file: 'lte-bands', page: 'lte-cw', clicks: ['Bands in use'], modal: true },
  { file: 'lte-modulated-manual', page: 'lte-modulated' },
  { file: 'lte-modulated-automation', page: 'lte-modulated', clicks: ['Automation'] },

  { file: 'load-pull', page: 'load-pull' },
  { file: 'load-pull-setup', page: 'load-pull', clicks: ['View setup'], modal: true },
  { file: 'load-pull-results', page: 'load-pull', seed: { 'load-pull-page-snapshot-v1': exampleLoadPull } },
  { file: 'load-pull-smith', page: 'load-pull', seed: { 'load-pull-page-snapshot-v1': exampleLoadPull }, clicks: ['Smith chart'], modal: true },

  { file: 'trombone', page: 'trombone' },
  { file: 'switch', page: 'switch' },
  { file: 'network-analyzer', page: 'network-analyzer' },
  { file: 'power-meter', page: 'power-meter' },
  { file: 'signal-generator', page: 'signal-generator' },
]

async function clickSafe(page, name) {
  if (!SAFE.has(name)) throw new Error(`refusing to click "${name}" -- not in SAFE`)
  // Every page stays mounted and is hidden with display:none, so a plain text
  // locator finds the hidden copies first. Only a visible match will do.
  const exact = new RegExp(`^\s*${name}\s*$`, 'i')
  const loc = page.locator(`[aria-label="${name}"]`)
    .or(page.getByRole('tab', { name, exact: true }))
    .or(page.getByRole('button', { name, exact: true }))
    .or(page.locator('button, [role=button], li, div, span').filter({ hasText: exact }))
    .filter({ visible: true })
  // force: Playwright treats anything under an aria-disabled ancestor (the
  // DUT gate) as disabled, even with the gate lifted above.
  await loc.last().click({ timeout: 4000, force: true })
  await page.waitForTimeout(700)
}

/** Grow the viewport until the tallest scroll container shows everything. */
async function fitHeight(page) {
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
    await page.setViewportSize({ width: WIDTH, height: Math.min(HEIGHT + extra + 8, 2600) })
    await page.waitForTimeout(400)
  }
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const only = process.argv.slice(3)
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.file)) continue
    // A fresh context per shot: storage is seeded by an init script, before the
    // app's own code runs. Writing it from the page and reloading does not
    // work -- each page store flushes its in-memory snapshot on beforeunload,
    // which overwrites the seed.
    const ctx = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1.5, colorScheme: 'light',
    })
    const seed = Object.fromEntries(Object.entries(s.seed || {}).map(([k, fn]) => [k, JSON.stringify(fn())]))
    await ctx.addInitScript(({ id, seed }) => {
      localStorage.setItem('app-theme-pref', JSON.stringify('light'))
      localStorage.setItem('active-page-v1', JSON.stringify(id))
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
    }, { id: s.page, seed })
    const page = await ctx.newPage()
    try {
      await page.goto(BASE)
      await page.waitForLoadState('networkidle').catch(() => {})
      // DUT pages are dimmed and click-blocked until a BLE unit is connected.
      // Connecting one is a real-world action, so instead the dimming is
      // lifted in this headless copy to show the page as the operator sees it
      // once connected. Only tabs and dialogs are clicked (see SAFE).
      if (!s.gated) {
        await page.addStyleTag({ content: '[aria-disabled="true"]{opacity:1!important;pointer-events:auto!important}' })
      }
      await page.waitForTimeout(1200)
      for (const c of s.clicks || []) await clickSafe(page, c)
      const file = path.join(OUT, `${s.file}.png`)
      if (s.clip === 'nav') {
        await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 330, height: HEIGHT } })
      } else if (s.modal) {
        const dlg = page.locator('[role=dialog] .MuiPaper-root, [role=presentation] .MuiPaper-root, [role=tooltip] .MuiPaper-root')
          .filter({ visible: true })
        if (await dlg.count()) await dlg.last().screenshot({ path: file })
        else await page.screenshot({ path: file })
      } else {
        await fitHeight(page)
        await page.screenshot({ path: file })
      }
      console.log('ok  ', s.file)
    } catch (e) {
      console.log('FAIL', s.file, '-', e.message.split('\n')[0])
    }
    await ctx.close()
  }
  await browser.close()
})()
