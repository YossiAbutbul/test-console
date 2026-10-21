/**
 * Audit probes for the redesign (impeccable audit). Read-only:
 *  - fresh headless profile per page; example results seeded in localStorage;
 *  - /ble/status answered "connected" in the browser, every other /ble or
 *    /device call refused, so nothing reaches the DUT;
 *  - only the Automation tab and the Instruments dialog are ever clicked.
 *
 * Per page and theme it reports the impeccable detector's findings (injected
 * from the live server), interactive targets under 24 px, and anything that
 * overflows the viewport. Then it tabs through LoRa CW to check focus, and
 * times a 2000-row results table.
 *
 * node audit-probe.cjs <detectUrl> [baseUrl] [width] [height]
 */
const { chromium } = require('playwright-core')
const DETECT = process.argv[2]
const BASE = process.argv[3] || 'http://localhost:5174'
const W = +(process.argv[4] || 1920), H = +(process.argv[5] || 1080)

function cwRows(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    const f = [902.3, 915, 927.5][i % 3], p = 10 + (i % 6) * 2
    const meas = +(p - 0.2 - (i % 7) * 0.2).toFixed(2)
    rows.push({ freq_mhz: f, set_power_dbm: p, pa_mode: 2, measured_dbm: meas, measured_dbm_raw: meas - 20,
      current_a: 0.09 + p * 0.002, voltage_v: 3.6, margin_db: 1, verdict: Math.abs(meas - p) <= 1 ? 'pass' : 'fail',
      ok: true, status: 0, error: null })
  }
  return { tab: 'automation', automation: { settleMs: 400, results: rows, rows: [{ freq: '915', power: '10', paMode: 2, marginDb: '1' }] } }
}
function loadPull() {
  const results = []
  for (let i = 0; i < 24; i++) {
    const th = (2 * Math.PI * i) / 24
    results.push({ pos_pulses: 800 * i, pos_mm: 2 * i, freq_mhz: 915, power_dbm_setting: 14,
      power_dbm: +(12.4 + 1.4 * Math.cos(th - 0.9)).toFixed(2), power_dbm_raw: -8, current_a: 0.118,
      r_ohm: 40 + 10 * Math.cos(th), x_ohm: 20 * Math.sin(th), s11_db: -6.9, error: null })
  }
  return { freqSpec: '915', powerSpec: '14', paMode: 2, settleMs: 400, deltaXmm: 2, zeroPulses: 0, endPulses: 18400, results }
}

const PAGES = [
  { id: 'power', name: 'LoRa CW manual' },
  { id: 'power', name: 'LoRa CW automation', seed: { 'power-page-snapshot-v1': cwRows(18) } },
  { id: 'lte-cw', name: 'LTE CW' },
  { id: 'power-sweep', name: 'Mode Sweep' },
  { id: 'load-pull', name: 'Load Pull', seed: { 'load-pull-page-snapshot-v1': loadPull() } },
  { id: 'dc-analyzer', name: 'DC Analyzer' },
  { id: 'spectrum', name: 'Spectrum' },
]

async function open(b, theme, p) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } })
  await ctx.addInitScript(({ id, seed, theme }) => {
    localStorage.setItem('app-theme-pref', JSON.stringify(theme))
    localStorage.setItem('active-page-v1', JSON.stringify(id))
    for (const [k, v] of Object.entries(seed || {})) localStorage.setItem(k, JSON.stringify(v))
  }, { id: p.id, seed: p.seed, theme })
  const page = await ctx.newPage()
  await page.route(/\/(ble|device)(\/|$)/, (route) => {
    const r = route.request(); const path = new URL(r.url()).pathname
    if (r.method() === 'GET' && path === '/ble/status') {
      return route.fulfill({ json: { connected: true, address: 'D4:A1:B2:C3:E4:F5', name: 'Sonata2IL', transport_ready: true } })
    }
    return route.abort()
  })
  return { ctx, page }
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  for (const theme of ['mid', 'dark', 'light']) {
    for (const p of PAGES) {
      const { ctx, page } = await open(b, theme, p)
      const logs = []
      let capture = false
      // The detector logs a summary line, then one "%c<rule>%c <detail>" line
      // per finding.
      page.on('console', (m) => { const t = m.text(); if (t.includes('impeccable') || (capture && t.startsWith('%c'))) logs.push(t) })
      await page.goto(BASE); await page.waitForTimeout(2500)
      const probe = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && el.offsetParent !== null }
        const small = []
        for (const el of document.querySelectorAll('button, [role=button], a[href], input, [role=tab], [role=checkbox], select, [tabindex="0"]')) {
          if (!vis(el)) continue
          if (el.closest('[aria-hidden="true"]')) continue
          const r = el.getBoundingClientRect()
          if ((r.width < 24 || r.height < 24) && !(el.tagName === 'INPUT' && el.type === 'checkbox')) {
            small.push(`${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('type') || '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        }
        const over = []
        for (const el of document.querySelectorAll('main *')) {
          if (!vis(el)) continue
          const r = el.getBoundingClientRect()
          if (r.right > window.innerWidth + 1) over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 20)} right=${Math.round(r.right)}`)
        }
        return { small: [...new Set(small)], over: over.slice(0, 6), overCount: over.length,
          docScroll: document.documentElement.scrollWidth > window.innerWidth }
      })
      capture = true
      await page.addScriptTag({ url: DETECT }).catch((e) => logs.push('inject failed ' + e.message))
      await page.waitForTimeout(3000)
      console.log(`### ${theme} · ${p.name}`)
      console.log(`  targets<24px: ${probe.small.length} ${probe.small.slice(0, 8).join(' | ')}`)
      console.log(`  overflow: ${probe.overCount}${probe.docScroll ? ' (page scrolls sideways)' : ''} ${probe.over.join(' | ')}`)
      for (const l of logs) console.log('  ' + l.replace(/%c/g, '').replace(/color:[^;]*;?|font-weight:[^;]*;?|font-family:[^;]*;?/g, '').replace(/\s+/g, ' ').slice(0, 260))
      await ctx.close()
    }
  }

  // Keyboard: tab through LoRa CW manual, check every stop shows focus.
  {
    const { ctx, page } = await open(b, 'mid', PAGES[0])
    await page.goto(BASE); await page.waitForTimeout(2500)
    const stops = []
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab')
      stops.push(await page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return 'body'
        const cs = getComputedStyle(el)
        const shown = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
          || getComputedStyle(el.closest('.MuiInputBase-root') || el).boxShadow !== 'none'
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 22)
        return `${shown ? '' : '[NO FOCUS RING] '}${name}`
      }))
    }
    console.log('### keyboard tab order, LoRa CW manual (mid)')
    console.log('  ' + stops.join(' → '))
    console.log('  stops without a visible ring: ' + stops.filter((s) => s.startsWith('[NO')).length)
    await ctx.close()
  }

  // Performance: a 2000-row LoRa CW results table.
  {
    const { ctx, page } = await open(b, 'mid', { id: 'power', seed: { 'power-page-snapshot-v1': cwRows(2000) } })
    const t0 = Date.now()
    await page.goto(BASE)
    await page.locator('table tbody tr').nth(1999).waitFor({ state: 'attached', timeout: 30000 })
    const load = Date.now() - t0
    const scroll = await page.evaluate(async () => {
      const box = [...document.querySelectorAll('div')].find((d) => d.querySelector('table') && getComputedStyle(d).overflowY === 'scroll' && d.offsetParent)
      if (!box) return 'no scroller'
      const frames = []; let last = performance.now()
      await new Promise((res) => {
        let n = 0
        const step = () => { box.scrollTop += 120; const now = performance.now(); frames.push(now - last); last = now; if (++n < 120) requestAnimationFrame(step); else res() }
        requestAnimationFrame(step)
      })
      frames.sort((a, b) => a - b)
      return `median ${frames[60].toFixed(1)} ms/frame, p95 ${frames[114].toFixed(1)} ms`
    })
    console.log(`### 2000-row results table: loaded + rendered in ${load} ms; scroll ${scroll}`)
    await ctx.close()
  }
  await b.close()
})()
