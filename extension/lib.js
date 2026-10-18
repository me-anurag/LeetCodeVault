// Shared by the popup and the service worker. Talks to Supabase over plain HTTP (Auth + PostgREST).
// chrome.storage.local holds only the login session and saves that have not reached Supabase yet;
// the library itself lives in Supabase.
import * as defaults from './config.js'

const QUEUE_KEY = 'pendingSaves'
const SESSION_KEY = 'session'

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields || {}
  }
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500
  }
}

// `overrides` in storage lets tests (or you) point the extension elsewhere without editing config.js.
export async function getConfig() {
  const { overrides = {} } = await chrome.storage.local.get('overrides')
  const cfg = {
    url: (overrides.SUPABASE_URL || defaults.SUPABASE_URL).replace(/\/+$/, ''),
    key: overrides.SUPABASE_ANON_KEY || defaults.SUPABASE_ANON_KEY,
    libraryUrl: (overrides.LIBRARY_URL || defaults.LIBRARY_URL).replace(/\/+$/, ''),
  }
  cfg.configured = !/YOUR-/.test(cfg.url + cfg.key)
  return cfg
}

export async function getSession() {
  return (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || null
}

async function storeSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user?.email,
  }
  await chrome.storage.local.set({ [SESSION_KEY]: session })
  return session
}

export const clearSession = () => chrome.storage.local.remove(SESSION_KEY)

async function http(cfg, path, { method = 'GET', body, token, prefer, timeoutMs = 15000 } = {}) {
  const headers = { apikey: cfg.key }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    throw new ApiError(0, 'network_error', err.name === 'AbortError' ? 'Supabase did not respond in time.' : 'Cannot reach Supabase.')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    let fields
    try {
      fields = data && data.details ? JSON.parse(data.details) : undefined
    } catch {
      fields = undefined
    }
    const message = (data && (data.message || data.msg || data.error_description || data.error)) || `Request failed (${res.status}).`
    throw new ApiError(res.status, (data && (data.error_code || data.code)) || 'http_error', message, fields)
  }
  return data
}

// --- auth -------------------------------------------------------------------------------------------------------------

export async function login(email, password) {
  const cfg = await getConfig()
  const data = await http(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
  return storeSession(data)
}

export async function logout() {
  const cfg = await getConfig()
  const session = await getSession()
  await clearSession()
  if (session) http(cfg, '/auth/v1/logout', { method: 'POST', token: session.access_token }).catch(() => {})
}

let refreshing = null

async function accessToken(cfg, { forceRefresh = false } = {}) {
  const session = await getSession()
  if (!session) throw new ApiError(401, 'not_logged_in', 'Please log in.')
  if (!forceRefresh && session.expires_at - 60 > Date.now() / 1000) return session.access_token
  refreshing ??= (async () => {
    try {
      const data = await http(cfg, '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token },
      })
      return (await storeSession({ ...data, user: data.user || { email: session.email } })).access_token
    } catch (err) {
      if (err.status >= 400 && err.status < 500) {
        await clearSession()
        throw new ApiError(401, 'session_expired', 'Your session expired. Please log in again.')
      }
      throw err
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

// Authenticated request; refreshes the session once if Supabase says the token expired.
async function authed(path, options = {}) {
  const cfg = await getConfig()
  try {
    return await http(cfg, path, { ...options, token: await accessToken(cfg) })
  } catch (err) {
    if (err.status !== 401 || err.code === 'not_logged_in' || err.code === 'session_expired') throw err
    return http(cfg, path, { ...options, token: await accessToken(cfg, { forceRefresh: true }) })
  }
}

export async function health() {
  const cfg = await getConfig()
  return http(cfg, '/auth/v1/health', { timeoutMs: 8000 })
}

export async function checkSaved(slug) {
  const rows = await authed(`/rest/v1/questions?slug=eq.${encodeURIComponent(slug)}&select=id,question_language_versions(language)`)
  const row = rows[0]
  return { questionId: row ? row.id : null, languages: row ? row.question_language_versions.map((v) => v.language) : [] }
}

const rpcSave = (payload) => authed('/rest/v1/rpc/save_question', { method: 'POST', body: { p: payload } })

// --- pending-save queue -----------------------------------------------------------------------------------------------

export async function getQueue() {
  return (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || []
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue })
  await updateBadge(queue)
}

export async function updateBadge(queue) {
  queue ??= await getQueue()
  const n = queue.length
  await chrome.action.setBadgeText({ text: n ? String(n) : '' })
  if (n) await chrome.action.setBadgeBackgroundColor({ color: queue.some((q) => q.status === 'failed') ? '#b91c1c' : '#52525b' })
}

const keyOf = (p) => `${p.slug}|${p.language}`

export async function enqueue(payload, error) {
  const queue = (await getQueue()).filter((item) => item.key !== keyOf(payload))
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key: keyOf(payload),
    title: payload.title,
    language_name: payload.language_name,
    payload,
    attempts: 0,
    status: 'pending',
    lastError: error ? error.message : null,
    queuedAt: new Date().toISOString(),
  })
  await setQueue(queue)
}

export async function discard(id) {
  await setQueue((await getQueue()).filter((item) => item.id !== id))
}

// Save one question. Network/5xx failures go to the queue for automatic retry.
export async function saveQuestion(payload) {
  try {
    const data = await rpcSave(payload)
    await setQueue((await getQueue()).filter((item) => item.key !== keyOf(payload)))
    return { status: data.status, questionId: data.question_id, languages: data.languages }
  } catch (err) {
    if (err instanceof ApiError && err.retryable) {
      await enqueue(payload, err)
      return { status: 'queued', error: { message: err.message } }
    }
    throw err
  }
}

let flushing = null

// Retry every queued save. Stops early when Supabase is unreachable or the login expired.
export function flushQueue() {
  flushing ??= (async () => {
    const result = { sent: 0, failed: 0, remaining: 0, authRequired: false, offline: false }
    if (!(await getSession())) {
      result.authRequired = true
      result.remaining = (await getQueue()).length
      return result
    }
    for (const item of await getQueue()) {
      if (item.status === 'failed') continue
      try {
        await rpcSave(item.payload)
        await setQueue((await getQueue()).filter((q) => q.id !== item.id))
        result.sent++
      } catch (err) {
        const queue = await getQueue()
        const current = queue.find((q) => q.id === item.id)
        if (current) {
          current.attempts++
          current.lastError = err.message
          // Rejected by validation: retrying won't help. Keep it visible so the user can discard it.
          if (!(err instanceof ApiError) || (!err.retryable && err.status !== 401)) {
            current.status = 'failed'
            result.failed++
          }
          await setQueue(queue)
        }
        if (err.status === 401) {
          result.authRequired = true
          break
        }
        if (err.status === 0) {
          result.offline = true
          break
        }
      }
    }
    result.remaining = (await getQueue()).length
    return result
  })().finally(() => {
    flushing = null
  })
  return flushing
}
