// Layout-shift check: same page, DUT disconnected -> connected (mocked
// /ble/status only; every other /ble or /device call refused). Reports any
// tracked element whose box moved or changed size.
const { chromium } = require('playwright-core')
const BASE = process.argv[2] || 'http://localhost:5174'
const TRACK = {
  'page title': 'h1',
  'Run/Send key': 'main button:has-text("Run"), main button:has-text("Send"), main button:has-text("Needs")',
  'check rail': '[aria-label^="DUT:"]',
  'tabs': '[role="tablist"]',
  'results/transmit panel': 'main .MuiTable-root, main [role="tablist"] ~ * >> nth=0',
  'DUT Connect key': 'header button:has-text("Connect"), header button:has-text("Disconnect"), body > div button:has-text("Disconnect"), body > div button:has-text("Connect")',
  'MAC field': 'input[placeholder^="MAC"]',
  'DC supply key': 'button[aria-pressed]',
  'Instruments lamp': 'button[aria-label^="Instruments:"]',
  'sidebar footer': 'text=DC supply',
}
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  for (const tab of ['manual', 'automation']) {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
    await ctx.addInitScript((tab) => {
      localStorage.setItem('active-page-v1', JSON.stringify('power'))
      localStorage.setItem('power-page-snapshot-v1', JSON.stringify({ tab }))
    }, tab)
    const page = await ctx.newPage()
    let connected = false
    await page.route(/\/(ble|device)(\/|$)/, (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname
      if (req.method() === 'GET' && path === '/ble/status') {
        return route.fulfill({ json: connected
          ? { connected: true, address: 'D4:A1:B2:C3:E4:F5', name: 'Sonata2IL', transport_ready: true }
          : { connected: false, address: null, name: null, transport_ready: false } })
      }
      return route.abort()
    })
    await page.goto(BASE); await page.waitForTimeout(2500)
    const boxes = async () => {
      const out = {}
      for (const [k, sel] of Object.entries(TRACK)) {
        const l = page.locator(sel).filter({ visible: true }).first()
        out[k] = (await l.count()) ? await l.boundingBox() : null
      }
      return out
    }
    const before = await boxes()
    connected = true
    await page.waitForTimeout(11500)   // ble status polls every 10 s
    const after = await boxes()
    console.log(`--- LoRa CW ${tab}: DUT disconnected -> connected`)
    for (const k of Object.keys(TRACK)) {
      const a = before[k], c = after[k]
      if (!a || !c) { console.log(`  ${k}: not found (${!!a}/${!!c})`); continue }
      const d = ['x', 'y', 'width', 'height'].map((f) => Math.round(c[f] - a[f]))
      console.log(`  ${k}: ${d.every((v) => v === 0) ? 'no change' : `dx ${d[0]} dy ${d[1]} dw ${d[2]} dh ${d[3]}`}`)
    }
    await ctx.close()
  }
  await b.close()
})()
