import { ApiError, checkSaved as fetchSaved, clearSession, getConfig, getSession, health, login, logout } from './lib.js'

const X = globalThis.LeetVaultExtractor
const $ = (id) => document.getElementById(id)

const state = {
  cfg: null,
  question: null, // extracted question (with snippets)
  detected: null, // { slug, name, source }
  savedLanguages: undefined, // undefined = still checking, null = unknown (server unreachable)
  questionId: null,
  saving: false,
  extractBlocked: null, // reason save is impossible
}

// --- small helpers ----------------------------------------------------------------------------------------------

function show(view) {
  $('view-login').hidden = view !== 'login'
  $('view-main').hidden = view !== 'main'
  $('account').hidden = view !== 'main'
}

function message(el, text, tone) {
  el.textContent = text || ''
  el.className = `msg ${tone || ''}`
  el.hidden = !text
}

function setSync(tone, text) {
  $('sync').className = `sync ${tone}`
  $('sync-text').textContent = text
}

function sendToWorker(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (!res) return reject(new Error('No response from extension background.'))
      if (res.ok) resolve(res.data)
      else reject(new ApiError(res.error.status ?? -1, res.error.code, res.error.message, res.error.fields))
    })
  })
}

function describeFields(fields) {
  const entries = Object.entries(fields || {})
  return entries.length ? '\n' + entries.map(([k, v]) => `• ${k}: ${v}`).join('\n') : ''
}

// --- sync status + queue ----------------------------------------------------------------------------------------

async function refreshQueue() {
  const queue = await sendToWorker({ type: 'queue' }).catch(() => [])
  const box = $('queue')
  box.hidden = queue.length === 0
  const failed = queue.filter((q) => q.status === 'failed').length
  $('queue-text').textContent = failed
    ? `${queue.length} unsynced save${queue.length > 1 ? 's' : ''} (${failed} rejected)`
    : `${queue.length} save${queue.length > 1 ? 's' : ''} waiting to sync`
  const list = $('queue-list')
  list.replaceChildren(
    ...queue.map((item) => {
      const li = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = `${item.title} (${item.language_name})`
      if (item.lastError) {
        label.title = item.lastError
        if (item.status === 'failed') label.className = 'err'
      }
      const discardBtn = document.createElement('button')
      discardBtn.textContent = 'Discard'
      discardBtn.addEventListener('click', async () => {
        await sendToWorker({ type: 'discard', id: item.id })
        refreshQueue()
      })
      li.append(label, discardBtn)
      return li
    }),
  )
  return queue
}

async function refreshSync() {
  const queue = await refreshQueue()
  try {
    await health()
    const pending = queue.filter((q) => q.status !== 'failed').length
    if (pending) setSync('warn', `${pending} pending`)
    else setSync('ok', 'Synced')
    return true
  } catch (err) {
    setSync('err', err.status === 0 ? 'Offline' : 'Supabase error')
    return false
  }
}

// --- login ------------------------------------------------------------------------------------------------------

async function doLogin() {
  const email = $('login-email').value.trim()
  const password = $('login-password').value
  if (!email || !password) return message($('login-msg'), 'Enter your email and password.', 'err')
  $('login-btn').disabled = true
  message($('login-msg'), 'Logging in…')
  try {
    await login(email, password)
    await chrome.storage.local.set({ lastEmail: email })
    $('login-password').value = ''
    message($('login-msg'), '')
    await sendToWorker({ type: 'flush' }).catch(() => {})
    await startMain()
  } catch (err) {
    const text = err.code === 'invalid_credentials' ? 'Incorrect email or password.' : err.message || 'Login failed.'
    message($('login-msg'), text, 'err')
  } finally {
    $('login-btn').disabled = false
  }
}

async function showLogin(note) {
  state.cfg = await getConfig()
  show('login')
  $('not-configured').hidden = state.cfg.configured
  $('login-form').hidden = !state.cfg.configured
  const { lastEmail } = await chrome.storage.local.get('lastEmail')
  if (lastEmail && !$('login-email').value) $('login-email').value = lastEmail
  message($('login-msg'), note || '', note ? 'warn' : '')
  if (state.cfg.configured) refreshSync()
  else setSync('err', 'Not configured')
}

// --- extraction -------------------------------------------------------------------------------------------------

async function extractFromTab(tab) {
  const ask = () => chrome.tabs.sendMessage(tab.id, { type: 'LEETVAULT_EXTRACT' })
  try {
    return await ask()
  } catch {
    // Tab was open before the extension was installed/reloaded: inject the content scripts now.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extractor.js', 'content.js'] })
    return ask()
  }
}

function renderQuestion() {
  const q = state.question
  $('question-loading').hidden = true
  $('question').hidden = false
  $('q-title').textContent = q.frontend_id ? `${q.frontend_id}. ${q.title}` : q.title
  const diff = $('q-difficulty')
  diff.textContent = q.difficulty || 'Unknown'
  diff.className = `badge ${q.difficulty}`
  $('q-topics').textContent = q.topics.map((t) => t.name).join(' · ') || 'No topics'

  const select = $('q-language')
  const current = select.value || state.detected?.slug || ''
  const options = []
  if (!current) {
    const o = new Option('Choose language…', '')
    options.push(o)
  }
  for (const s of q.snippets) {
    const saved = state.savedLanguages?.includes(s.langSlug)
    options.push(new Option(`${saved ? '✓ ' : ''}${s.lang}`, s.langSlug))
  }
  select.replaceChildren(...options)
  select.value = current
  select.disabled = q.snippets.length === 0

  const sourceText = {
    editor: 'Detected from the code editor.',
    preference: 'From your LeetCode language preference. Change it here if needed.',
  }
  $('q-lang-source').textContent =
    q.snippets.length === 0
      ? ''
      : select.value && select.value === state.detected?.slug
        ? sourceText[state.detected.source]
        : select.value
          ? 'Selected manually.'
          : 'Could not detect the editor language. Choose one.'
  renderStatus()
}

function renderStatus() {
  const lang = $('q-language').value
  const langName = state.question?.snippets.find((s) => s.langSlug === lang)?.lang
  const status = $('q-status')
  const btn = $('save-btn')
  status.className = ''
  let alreadySaved = false
  if (state.savedLanguages === undefined) {
    status.textContent = 'Checking…'
  } else if (state.savedLanguages === null) {
    status.textContent = 'Unknown (server unreachable)'
  } else if (lang && state.savedLanguages.includes(lang)) {
    alreadySaved = true
    status.textContent = `Saved (${langName})`
    status.className = 'saved'
  } else if (state.savedLanguages.length) {
    const others = state.question.snippets.filter((s) => state.savedLanguages.includes(s.langSlug)).map((s) => s.lang)
    status.textContent = `Not saved${langName ? ` in ${langName}` : ''} · saved in ${others.join(', ')}`
  } else {
    status.textContent = 'Not saved'
  }
  btn.disabled = state.saving || !!state.extractBlocked || !lang || alreadySaved
  btn.textContent = state.saving ? 'Saving…' : alreadySaved ? 'Already saved' : 'Save Question'
}

async function checkSaved() {
  try {
    const res = await fetchSaved(state.question.slug)
    state.savedLanguages = res.languages
    state.questionId = res.questionId
  } catch (err) {
    if (err.status === 401) {
      await clearSession()
      return showLogin('Your session expired. Please log in again.')
    }
    state.savedLanguages = null
  }
  renderQuestion()
}

async function save() {
  const lang = $('q-language').value
  let payload
  try {
    payload = X.buildSavePayload(state.question, lang)
  } catch (err) {
    return message($('main-msg'), err.message, 'err')
  }
  state.saving = true
  renderStatus()
  message($('main-msg'), '')
  try {
    const res = await sendToWorker({ type: 'save', payload })
    if (res.status === 'queued') {
      message($('main-msg'), `Supabase unreachable — saved locally and will sync automatically.\n${res.error?.message || ''}`, 'warn')
    } else {
      state.savedLanguages = res.languages
      state.questionId = res.questionId
      const text = {
        created: `Saved “${payload.title}” with ${payload.language_name} starter code.`,
        language_added: `Added ${payload.language_name} starter code to “${payload.title}”.`,
        already_saved: `${payload.language_name} version was already saved.`,
      }
      message($('main-msg'), text[res.status] || 'Saved.', 'ok')
    }
  } catch (err) {
    if (err.status === 401) {
      await clearSession()
      return showLogin('Your session expired. Log in and click Save again.')
    }
    message($('main-msg'), `Save failed: ${err.message}${describeFields(err.fields)}`, 'err')
  } finally {
    state.saving = false
    renderQuestion()
    refreshSync()
  }
}

async function startMain() {
  state.cfg = await getConfig()
  const session = await getSession()
  if (!state.cfg.configured || !session) return showLogin()
  show('main')
  $('account-email').textContent = session.email || ''
  $('question-loading').hidden = false
  $('question').hidden = true
  $('question-none').hidden = true
  message($('main-msg'), '')
  refreshSync()

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.url || !X.slugFromPath(new URL(tab.url).pathname) || new URL(tab.url).hostname !== 'leetcode.com') {
    $('question-loading').hidden = true
    $('question-none').hidden = false
    $('question-none').textContent = 'Open a LeetCode problem page (leetcode.com/problems/…) to save it.'
    return
  }

  let result
  try {
    result = await extractFromTab(tab)
  } catch (err) {
    result = { ok: false, error: { message: `Could not read the page: ${err.message}. Reload the LeetCode tab and try again.` } }
  }
  if (!result || !result.ok) {
    $('question-loading').hidden = true
    $('question-none').hidden = false
    $('question-none').textContent = result?.error?.message || 'Could not read this problem.'
    return
  }

  state.question = result.question
  state.detected = result.language
  if (result.missing.length) {
    state.extractBlocked = `Could not capture: ${result.missing.join(', ')}.`
    const note = result.missing.includes('starter code')
      ? ' Starter code must come from LeetCode’s original template, so saving is disabled rather than storing incomplete code. Reload the page and try again.'
      : ' Reload the page and try again.'
    message($('main-msg'), state.extractBlocked + note + (result.warning ? `\n${result.warning}` : ''), 'err')
  } else if (result.warning) {
    message($('main-msg'), result.warning, 'warn')
  }
  renderQuestion()
  await checkSaved()
}

// --- wiring -----------------------------------------------------------------------------------------------------

$('login-form').addEventListener('submit', (e) => { e.preventDefault(); doLogin() })
$('register-link').addEventListener('click', async (e) => {
  e.preventDefault()
  chrome.tabs.create({ url: `${(await getConfig()).libraryUrl}/login` })
})
$('save-btn').addEventListener('click', save)
$('q-language').addEventListener('change', () => { message($('main-msg'), ''); renderQuestion() })
$('retry-btn').addEventListener('click', async () => {
  $('retry-btn').disabled = true
  try {
    const res = await sendToWorker({ type: 'flush' })
    if (res.authRequired) return showLogin('Log in to sync your pending saves.')
    message(
      $('main-msg'),
      res.offline ? 'Still offline. Will keep retrying every minute.' : `Synced ${res.sent} pending save${res.sent === 1 ? '' : 's'}.`,
      res.offline ? 'warn' : 'ok',
    )
    if (state.question) {
      state.savedLanguages = undefined
      renderStatus()
      await checkSaved()
    }
  } finally {
    $('retry-btn').disabled = false
    refreshSync()
  }
})
$('logout-link').addEventListener('click', async (e) => {
  e.preventDefault()
  await logout()
  showLogin()
})
$('library-link').addEventListener('click', async (e) => {
  e.preventDefault()
  const base = (await getConfig()).libraryUrl
  chrome.tabs.create({ url: state.questionId ? `${base}/questions/${state.questionId}` : `${base}/` })
})

startMain()
