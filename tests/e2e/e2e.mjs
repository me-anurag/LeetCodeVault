// End-to-end: real Chrome + unpacked extension + live LeetCode pages + Supabase + the built website.
// Defaults target local Supabase (`npm run db:start`) and `vite preview` of a build made against it:
//   cd web && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<key> npm run build && npx vite preview --port 4173
//   cd tests/e2e && npm test
import puppeteer from 'puppeteer'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(HERE, '../../extension')
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const WEB = process.env.WEB || 'http://localhost:4173'
const DEAD = 'http://127.0.0.1:5999' // nothing listens here: simulates an outage
const SHOTS = process.env.SHOTS || path.join(HERE, 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const EMAIL = `e2e-${Date.now()}@example.com`
const PASSWORD = 'e2e-password-123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let step = 0
const log = (...a) => console.log(`[${++step}]`, ...a)

async function leetcodeQuestion(slug) {
  const res = await fetch('https://leetcode.com/graphql/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: `https://leetcode.com/problems/${slug}/` },
    body: JSON.stringify({
      query: 'query q($s: String!) { question(titleSlug: $s) { title content difficulty topicTags { slug } codeSnippets { langSlug code } } }',
      variables: { s: slug },
    }),
  })
  return (await res.json()).data.question
}

async function supa(method, p, { token, body } = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(SUPABASE_URL + p, { method, headers, body: body && JSON.stringify(body) })
  return res.json()
}

const browser = await puppeteer.launch({
  headless: false,
  pipe: true,
  enableExtensions: [EXT],
  args: ['--window-size=1400,900'],
  defaultViewport: null,
})

const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'))
const worker = await swTarget.worker()
const extId = new URL(swTarget.url()).host
const setBackend = (url) =>
  worker.evaluate((o) => chrome.storage.local.set({ overrides: o }), { SUPABASE_URL: url, SUPABASE_ANON_KEY: SUPABASE_KEY, LIBRARY_URL: WEB })

async function openPopup(page) {
  await page.bringToFront()
  await worker.evaluate(() => chrome.action.openPopup())
  const target = await browser.waitForTarget((t) => t.url() === `chrome-extension://${extId}/popup.html`, { timeout: 10000 })
  const popup = await target.asPage()
  await popup.waitForFunction(
    () => !document.getElementById('view-login').hidden ||
      (!document.getElementById('view-main').hidden && document.getElementById('question-loading').hidden),
    { timeout: 30000 },
  )
  return popup
}

async function popupState(popup) {
  return popup.evaluate(() => ({
    login: !document.getElementById('view-login').hidden,
    notConfigured: !document.getElementById('not-configured').hidden,
    none: document.getElementById('question-none').hidden ? null : document.getElementById('question-none').textContent,
    title: document.getElementById('q-title').textContent,
    difficulty: document.getElementById('q-difficulty').textContent,
    topics: document.getElementById('q-topics').textContent,
    language: document.getElementById('q-language').value,
    langSource: document.getElementById('q-lang-source').textContent,
    status: document.getElementById('q-status').textContent,
    saveText: document.getElementById('save-btn').textContent,
    saveDisabled: document.getElementById('save-btn').disabled,
    msg: document.getElementById('main-msg').hidden ? '' : document.getElementById('main-msg').textContent,
    msgTone: document.getElementById('main-msg').className,
    loginMsg: document.getElementById('login-msg').hidden ? '' : document.getElementById('login-msg').textContent,
    sync: document.getElementById('sync-text').textContent,
    queueText: document.getElementById('queue').hidden ? '' : document.getElementById('queue-text').textContent,
  }))
}

async function waitForStatus(popup) {
  await popup.waitForFunction(() => !['…', 'Checking…'].includes(document.getElementById('q-status').textContent), { timeout: 15000 })
  return popupState(popup)
}

async function clickSave(popup) {
  await popup.click('#save-btn')
  await popup.waitForFunction(() => !document.getElementById('main-msg').hidden && document.getElementById('save-btn').textContent !== 'Saving…', { timeout: 20000 })
  return popupState(popup)
}

async function gotoProblem(page, slug) {
  await page.goto(`https://leetcode.com/problems/${slug}/description/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-track-load="description_content"]', { timeout: 45000 })
}

// Switch the language in LeetCode's own editor, the way a user would.
async function switchLeetCodeLanguage(page, from, to) {
  const clicked = await page.evaluate((from) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === from)
    if (!btn) return false
    btn.click()
    return true
  }, from)
  assert.ok(clicked, `LeetCode language button "${from}" not found`)
  await sleep(800)
  const picked = await page.evaluate((to) => {
    const els = [...document.querySelectorAll('div, li, span, button')].filter(
      (el) => el.textContent.trim() === to && el.offsetParent !== null && el.children.length <= 2,
    )
    const el = els[els.length - 1]
    if (!el) return false
    el.click()
    return true
  }, to)
  if (!picked) await page.screenshot({ path: path.join(SHOTS, 'lang-dropdown.png') })
  assert.ok(picked, `language option "${to}" not found in LeetCode dropdown`)
  await page.waitForFunction(
    (to) => [...document.querySelectorAll('button')].some((b) => b.textContent.replace(/\s+/g, ' ').trim() === to),
    { timeout: 10000 },
    to,
  )
}

const listTitles = (p) => p.evaluate(() => [...document.querySelectorAll('main ul li > div > a')].map((a) => a.textContent))

try {
  const page = await browser.newPage()

  // --- unconfigured extension explains what to do -------------------------------------------------------------------
  await page.goto('https://leetcode.com/problemset/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  let popup = await openPopup(page)
  let s = await popupState(popup)
  assert.ok(s.login && s.notConfigured && s.sync === 'Not configured')
  log('Unconfigured extension shows setup instructions')
  await popup.close()
  await setBackend(SUPABASE_URL)

  // --- create the account on the website ----------------------------------------------------------------------------
  const site = await browser.newPage()
  await site.goto(`${WEB}/login`, { waitUntil: 'networkidle0' })
  await site.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Register/.test(b.textContent)).click())
  await site.type('input[type=email]', EMAIL)
  await site.type('input[type=password]', PASSWORD)
  await site.click('button[type=submit]')
  await site.waitForFunction(() => location.pathname === '/' && /saved/.test(document.body.innerText), { timeout: 15000 })
  log('Registered on the website (Supabase Auth)')
  await site.close()

  // --- log in from the popup ----------------------------------------------------------------------------------------
  popup = await openPopup(page)
  await popup.type('#login-email', EMAIL)
  await popup.type('#login-password', 'wrong-password')
  await popup.click('#login-btn')
  await popup.waitForFunction(() => /Incorrect email or password/.test(document.getElementById('login-msg').textContent), { timeout: 10000 })
  await popup.evaluate(() => { document.getElementById('login-password').value = '' })
  await popup.type('#login-password', PASSWORD)
  await popup.click('#login-btn')
  await popup.waitForFunction(() => !document.getElementById('view-main').hidden && document.getElementById('question-loading').hidden, { timeout: 20000 })
  s = await popupState(popup)
  assert.match(s.none, /Open a LeetCode problem page/)
  log('Popup login: wrong password rejected, then logged in; non-problem page message shown')
  await popup.close()

  // --- Easy: Two Sum, default editor language -----------------------------------------------------------------------
  await gotoProblem(page, 'two-sum')
  await sleep(3000)
  popup = await openPopup(page)
  s = await waitForStatus(popup)
  await popup.screenshot({ path: path.join(SHOTS, 'popup-two-sum.png') })
  assert.equal(s.title, '1. Two Sum')
  assert.equal(s.difficulty, 'Easy')
  assert.match(s.topics, /Array · Hash Table/)
  assert.equal(s.status, 'Not saved')
  assert.equal(s.sync, 'Synced')
  const firstLang = s.language
  assert.ok(firstLang, 'a language was detected')
  log(`Two Sum detected: lang=${s.language} (${s.langSource}) status="${s.status}" sync=${s.sync}`)
  s = await clickSave(popup)
  assert.match(s.msgTone, /ok/, s.msg)
  assert.match(s.status, /^Saved/)
  assert.equal(s.saveText, 'Already saved')
  log('Saved:', s.msg, '| status:', s.status)
  await popup.close()

  // --- change language in LeetCode's editor, save a second version ------------------------------------------------
  const nameOf = { cpp: 'C++', java: 'Java', python3: 'Python3' }
  const target = firstLang === 'python3' ? 'Java' : 'Python3'
  await switchLeetCodeLanguage(page, nameOf[firstLang] || firstLang, target)
  popup = await openPopup(page)
  s = await waitForStatus(popup)
  assert.equal(s.language, target === 'Java' ? 'java' : 'python3', 'popup follows the editor language')
  assert.match(s.status, /^Not saved in/)
  s = await clickSave(popup)
  assert.match(s.msg, /^Added .* starter code/)
  log(`Switched LeetCode editor to ${target}:`, s.msg)
  await popup.close()

  popup = await openPopup(page)
  s = await waitForStatus(popup)
  assert.equal(s.saveText, 'Already saved')
  log('Reopened popup -> duplicate prevented:', s.status)
  await popup.close()

  // --- Medium + Hard --------------------------------------------------------------------------------------------------
  for (const [slug, diff] of [['lru-cache', 'Medium'], ['median-of-two-sorted-arrays', 'Hard']]) {
    await gotoProblem(page, slug)
    await sleep(2500)
    popup = await openPopup(page)
    s = await waitForStatus(popup)
    assert.equal(s.difficulty, diff)
    s = await clickSave(popup)
    assert.match(s.msgTone, /ok/, s.msg)
    log(`${slug}: ${s.msg}`)
    await popup.close()
  }

  // --- outage -> queued -> automatic retry ---------------------------------------------------------------------------
  await gotoProblem(page, 'add-two-numbers')
  await sleep(2500)
  await setBackend(DEAD)
  popup = await openPopup(page)
  s = await waitForStatus(popup)
  assert.equal(s.status, 'Unknown (server unreachable)')
  assert.equal(s.sync, 'Offline')
  s = await clickSave(popup)
  assert.match(s.msg, /saved locally and will sync automatically/)
  assert.match(s.queueText, /1 save waiting to sync/)
  const badge = await worker.evaluate(() => chrome.action.getBadgeText({}))
  assert.equal(badge, '1')
  log('Offline save queued:', s.queueText, '| badge:', badge)
  await popup.close()
  await setBackend(SUPABASE_URL)
  const t0 = Date.now()
  let queue
  do {
    await sleep(5000)
    queue = await worker.evaluate(() => chrome.storage.local.get('pendingSaves').then((r) => r.pendingSaves || []))
  } while (queue.length && Date.now() - t0 < 100000)
  assert.equal(queue.length, 0, 'queue flushed by retry alarm')
  log(`Queue auto-synced by background retry after ${Math.round((Date.now() - t0) / 1000)}s`)

  // --- manual Retry button ------------------------------------------------------------------------------------------
  await gotoProblem(page, 'longest-palindromic-substring')
  await sleep(2500)
  await setBackend(DEAD)
  popup = await openPopup(page)
  await waitForStatus(popup)
  s = await clickSave(popup)
  assert.match(s.queueText, /waiting to sync/)
  await setBackend(SUPABASE_URL)
  await popup.click('#retry-btn')
  await popup.waitForFunction(() => /Synced 1 pending save/.test(document.getElementById('main-msg').textContent), { timeout: 20000 })
  s = await waitForStatus(popup)
  assert.match(s.status, /^Saved/)
  log('Retry now synced the pending save; status:', s.status)
  await popup.close()

  // --- expired access token is refreshed transparently ---------------------------------------------------------------
  await worker.evaluate(() => chrome.storage.local.get('session').then(({ session }) =>
    chrome.storage.local.set({ session: { ...session, access_token: 'expired.invalid.token', expires_at: 0 } })))
  popup = await openPopup(page)
  s = await waitForStatus(popup)
  assert.match(s.status, /^Saved/)
  log('Expired access token refreshed automatically; status:', s.status)
  await popup.close()

  // --- stored data matches LeetCode exactly --------------------------------------------------------------------------
  const { access_token: token } = await supa('POST', '/auth/v1/token?grant_type=password', { body: { email: EMAIL, password: PASSWORD } })
  const list = await supa('POST', '/rest/v1/rpc/list_questions', { token, body: { p_per_page: 100 } })
  assert.equal(list.total, 5)
  for (const item of list.items) {
    const [q] = await supa('GET', `/rest/v1/questions?id=eq.${item.id}&select=*,question_language_versions(*)`, { token })
    const lc = await leetcodeQuestion(q.slug)
    assert.equal(q.description, lc.content, `${q.slug} statement identical to LeetCode`)
    assert.equal(q.difficulty, lc.difficulty)
    assert.deepEqual([...q.topic_slugs].sort(), lc.topicTags.map((t) => t.slug).sort())
    for (const v of q.question_language_versions) {
      assert.equal(v.starter_code, lc.codeSnippets.find((c) => c.langSlug === v.language).code, `${q.slug}/${v.language}`)
    }
    assert.ok(q.examples.length >= 1 && q.constraints.length >= 1)
  }
  const twoSum = list.items.find((i) => i.slug === 'two-sum')
  assert.equal(twoSum.languages.length, 2)
  log('All 5 rows in Supabase match LeetCode:', list.items.map((i) => `${i.slug}[${i.languages.map((l) => l.language).join(',')}]`).join(' '))

  // --- "another device": fresh browser context, phone viewport -------------------------------------------------------
  const ctx = await browser.createBrowserContext()
  const phone = await ctx.newPage()
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await phone.goto(`${WEB}/`, { waitUntil: 'networkidle0' })
  assert.equal(new URL(phone.url()).pathname, '/login')
  await phone.type('input[type=email]', EMAIL)
  await phone.type('input[type=password]', PASSWORD)
  await phone.click('button[type=submit]')
  await phone.waitForSelector('ul li a[href^="/questions/"]', { timeout: 15000 })
  await sleep(500)
  await phone.screenshot({ path: path.join(SHOTS, 'web-dashboard-mobile.png'), fullPage: true })
  const counts = await phone.evaluate(() => document.querySelector('main').innerText.slice(0, 80))
  assert.match(counts, /5\s+saved/)
  log('Other device (phone) logged in:', counts.replace(/\s+/g, ' '))

  await phone.type('input[type=search]', 'sorted arrays')
  await phone.waitForFunction(() => document.querySelectorAll('main ul li').length === 1, { timeout: 10000 })
  await phone.click('main ul li a')
  await phone.waitForSelector('.statement', { timeout: 10000 })
  const detail = await phone.evaluate(() => ({
    title: document.querySelector('h1').textContent,
    statement: document.querySelector('.statement').innerText.slice(0, 60),
    code: document.querySelector('pre code').innerText,
    copy: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Copy code'),
  }))
  const lcMedian = await leetcodeQuestion('median-of-two-sorted-arrays')
  assert.ok(lcMedian.codeSnippets.some((c) => c.code.trimEnd() === detail.code.trimEnd()), 'displayed code is LeetCode template')
  assert.ok(detail.copy)
  await phone.screenshot({ path: path.join(SHOTS, 'web-detail-mobile.png'), fullPage: true })
  log('Search + detail on phone:', detail.title, '|', detail.statement.replace(/\s+/g, ' '), '| code matches | Copy present')

  // Filters on desktop width
  const desk = await ctx.newPage()
  await desk.setViewport({ width: 1280, height: 900 })
  await desk.goto(`${WEB}/?difficulty=Medium&topic=hash-table`, { waitUntil: 'networkidle0' })
  await desk.waitForSelector('main ul li', { timeout: 10000 })
  const filtered = await listTitles(desk)
  assert.deepEqual(filtered, ['146.LRU Cache'])
  await desk.goto(`${WEB}/`, { waitUntil: 'networkidle0' })
  await desk.waitForSelector('main ul li', { timeout: 10000 })
  await desk.screenshot({ path: path.join(SHOTS, 'web-dashboard-desktop.png') })
  log('Filter Medium + Hash Table ->', filtered)

  // Notes + solution + delete
  await desk.goto(`${WEB}/questions/${twoSum.id}`, { waitUntil: 'networkidle0' })
  await desk.waitForSelector('textarea')
  await desk.type('textarea', 'Hash map of value -> index. One pass.')
  await desk.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save notes').click())
  await desk.waitForFunction(() => [...document.querySelectorAll('span')].some((s) => s.textContent === 'Saved'))
  await desk.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add solution').click())
  await desk.waitForSelector('textarea[placeholder="Solution code"]')
  await desk.type('textarea[placeholder="Solution code"]', 'seen = {}')
  await desk.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save solution').click())
  await desk.waitForFunction(() => [...document.querySelectorAll('pre code')].some((c) => c.textContent.includes('seen = {}')))
  await desk.reload({ waitUntil: 'networkidle0' })
  await desk.waitForSelector('textarea')
  assert.equal(await desk.evaluate(() => document.querySelector('textarea').value), 'Hash map of value -> index. One pass.')
  await desk.screenshot({ path: path.join(SHOTS, 'web-detail-desktop.png'), fullPage: true })
  log('Notes and solution saved and persisted after reload')

  let dialogs = 0
  desk.on('dialog', (d) => { dialogs++; d.accept() })
  await desk.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete question').click())
  await desk.waitForFunction(() => location.pathname === '/', { timeout: 10000 })
  assert.equal(dialogs, 1)
  const after = await supa('POST', '/rest/v1/rpc/list_questions', { token, body: {} })
  assert.equal(after.total, 4)
  log('Delete asked for confirmation; total now', after.total)

  await gotoProblem(page, 'two-sum')
  popup = await openPopup(page)
  s = await waitForStatus(popup)
  assert.equal(s.status, 'Not saved')
  log('Extension reflects the deletion made on the website:', s.status)
  await popup.close()

  console.log('\nE2E PASSED')
} catch (err) {
  console.error('\nE2E FAILED:', err)
  process.exitCode = 1
} finally {
  await browser.close()
}
