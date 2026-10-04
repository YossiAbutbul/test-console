/**
 * Records lora-cw-demo.webm: connect a unit, a manual 14 dBm CW send, a 7-point
 * automation run, and its graph.
 *
 * SAFETY: unlike capture-screenshots.cjs this drives the live rig -- it
 * connects the BLE unit and presses Send and Run, which key the PA. The unit
 * must be disconnected first so the connect step can be filmed.
 *
 * Usage (backend on :8000 and `npm run dev` on :5173 already running):
 *
 *   npm i --no-save --prefix %TEMP%\pw playwright-core
 *   npx --prefix %TEMP%\pw playwright-core install ffmpeg
 *   set NODE_PATH=%TEMP%\pw\node_modules
 *   node docs\manual\video\record-lora-cw.cjs
 *
 * The recording lands in docs/manual/video/out/ under a random name.
 */
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = 'http://localhost:5173'
const OUT = path.join(__dirname, 'out')
const W = 1440, H = 900
const MAC = 'D5:A9:27:5B:76:AF'
const FREQS = '902.3,906,910,914,918,922,927.5'

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, colorScheme: 'light',
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })
  await ctx.addInitScript(() => {
    localStorage.setItem('app-theme-pref', JSON.stringify('light'))
    localStorage.setItem('active-page-v1', JSON.stringify('power'))
    // Visible cursor + click ripple + caption bar, so the recording shows what is pressed.
    window.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style')
      st.textContent = `
        #__cur{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;
          background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><path d='M3 2 L3 18 L7.5 13.5 L10.5 20 L13 19 L10 12.5 L16 12.5 Z' fill='black' stroke='white' stroke-width='1.4'/></svg>") no-repeat}
        .__rip{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
          border:3px solid #f59e0b;pointer-events:none;animation:__r .6s ease-out forwards}
        @keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
        #__cap{position:fixed;z-index:2147483645;left:50%;bottom:28px;transform:translateX(-50%);pointer-events:none;
          background:rgba(17,24,39,.88);color:#fff;font:600 19px system-ui,Segoe UI,sans-serif;padding:10px 22px;
          border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:opacity .3s;opacity:0}`
      document.head.appendChild(st)
      const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c)
      const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap)
      document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
      document.addEventListener('mousedown', (e) => {
        const r = document.createElement('div'); r.className = '__rip'
        r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
        document.body.appendChild(r); setTimeout(() => r.remove(), 700)
      }, true)
    })
  })
  const page = await ctx.newPage()
  global.__page = page; global.__ctx = ctx
  const pause = (ms) => page.waitForTimeout(ms)
  const caption = (t) => page.evaluate((t) => {
    const el = document.getElementById('__cap'); if (!el) return
    el.textContent = t; el.style.opacity = t ? '1' : '0'
  }, t)
  let mx = W / 2, my = H / 2
  async function moveTo(loc) {
    const b = await loc.boundingBox()
    if (!b) throw new Error('no box')
    const x = b.x + b.width / 2, y = b.y + b.height / 2
    await page.mouse.move(x, y, { steps: 14 }); mx = x; my = y
  }
  async function click(loc) { await loc.scrollIntoViewIfNeeded(); await moveTo(loc); await pause(150); await loc.click(); await pause(300) }
  async function type(loc, text) { await click(loc); await loc.press('Control+a'); await loc.pressSequentially(text, { delay: 30 }); await pause(200) }
  const btn = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()

  await page.goto(BASE)
  await page.waitForLoadState('networkidle').catch(() => {})
  // Hide the log panel so the page gets the full width.
  await page.getByRole('button', { name: 'Close panel' }).first().click()
  await page.mouse.move(mx, my)
  await pause(600)

  // 1. Connect the unit
  await caption('LoRa CW — connect to the CAT-M 2 unit D5A9275B76AF')
  await pause(1200)
  const typeSel = page.getByRole('combobox').filter({ visible: true }).filter({ hasText: /All|CAT-M|Sonata|Interpreter/ }).first()
  await click(typeSel)
  await click(page.getByRole('option', { name: 'CAT-M 2', exact: true }))
  await caption('Scan for nearby units')
  await click(btn('Scan'))
  const macInput = page.getByPlaceholder('Pick from scan or type MAC').filter({ visible: true }).first()
  const opt = page.getByRole('option').filter({ hasText: MAC }).first()
  await opt.waitFor({ timeout: 15000 })
  await pause(500)
  await caption('Pick the unit by its MAC address')
  await type(macInput, '76AF')
  await pause(300)
  await click(opt)
  await caption('Connect')
  await click(btn('Connect'))
  await btn('Disconnect').waitFor({ timeout: 30000 })
  await caption('Connected')
  await pause(1200)

  await caption('Path loss between the unit and the power sensor: 10.2 dB')
  await type(page.getByRole('spinbutton').filter({ visible: true }).first(), '10.2')
  await page.keyboard.press('Tab')
  await pause(1000)

  // 2. Manual CW at 14 dBm
  await caption('Manual tab — CW at 902.3 MHz, 14 dBm, PA Auto')
  const power = page.getByRole('spinbutton').filter({ visible: true }).nth(3)
  await moveTo(power)
  await pause(1300)
  await caption('Send — the unit transmits; power and current are measured')
  await click(btn('Send'))
  await pause(4000)
  await caption('Measured output power and current consumption')
  await pause(2500)
  await caption('Stop — turn the transmitter off')
  await click(btn('Stop'))
  await pause(1200)

  // 3. Automation
  await caption('Automation tab — sweep frequency at a fixed 14 dBm')
  await click(page.getByRole('tab', { name: 'Automation', exact: true }).filter({ visible: true }).first())
  await pause(600)
  const trash = page.locator('button:has(svg[data-testid="DeleteIcon"])').filter({ visible: true })
  await caption('Keep one row: a list of frequencies, all at 14 dBm')
  await click(trash.last()); await click(trash.last())
  await type(page.getByPlaceholder('915 or 900-930').filter({ visible: true }).first(), FREQS)
  await type(page.getByPlaceholder('14 or 10-20').filter({ visible: true }).first(), '14')
  await pause(600)
  await caption('Run — 7 points, each: TX on → settle → measure → TX off')
  await click(btn('Run'))
  const rows = page.locator('table tbody tr').filter({ visible: true })
  const done = page.getByRole('dialog').filter({ hasText: /complete|finished|failed|stopped/i })
  await done.waitFor({ timeout: 180000 })
  await caption('Run finished')
  await pause(1500)
  await click(btn('Done'))
  await caption('Results — measured power, current and pass/fail per point')
  await moveTo(rows.last())
  await pause(2500)

  // 4. Graph
  await caption('Graph — measured power vs frequency')
  await click(btn('Graph'))
  await pause(3000)
  const curTab = page.getByRole('tab', { name: /Current vs/ }).filter({ visible: true }).first()
  await caption('Current consumption vs frequency')
  await click(curTab)
  await pause(2800)
  await click(page.getByRole('tab', { name: /Measured vs/ }).filter({ visible: true }).first())
  await caption('')
  await pause(1000)

  await page.screenshot({ path: path.join(OUT, 'final.png') })
  const v = page.video()
  await ctx.close()
  console.log('video:', await v.path())
  await browser.close()
})().catch(async (e) => {
  console.error('FAIL', e.message.split('\n')[0])
  try { await global.__page?.screenshot({ path: path.join(OUT, 'fail.png') }); await global.__ctx?.close() } catch {}
  process.exit(1)
})
