// Service worker: performs saves (so they finish even if the popup closes) and retries queued saves.
import { discard, flushQueue, getQueue, saveQuestion, updateBadge } from './lib.js'

const RETRY_ALARM = 'leetvault-retry'

async function scheduleRetry() {
  const pending = (await getQueue()).some((item) => item.status !== 'failed')
  if (pending) await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })
  else await chrome.alarms.clear(RETRY_ALARM)
}

async function flushAndReschedule() {
  const result = await flushQueue()
  await scheduleRetry()
  return result
}

chrome.runtime.onInstalled.addListener(() => { updateBadge(); flushAndReschedule() })
chrome.runtime.onStartup.addListener(() => { updateBadge(); flushAndReschedule() })
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === RETRY_ALARM) flushAndReschedule() })
self.addEventListener('online', () => flushAndReschedule())

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false
  const handlers = {
    save: async () => {
      const result = await saveQuestion(message.payload)
      await scheduleRetry()
      return result
    },
    flush: flushAndReschedule,
    queue: getQueue,
    discard: async () => {
      await discard(message.id)
      await scheduleRetry()
      return getQueue()
    },
  }
  const handler = handlers[message && message.type]
  if (!handler) return false
  handler()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({ ok: false, error: { status: err.status, code: err.code, message: err.message, fields: err.fields } }),
    )
  return true
})
