import { useEffect, useState } from 'react'

// Wars follow India time: a war day starts at 3:00 am and ends at 10:30 pm (see the daily_wars migration).
const TZ = 'Asia/Kolkata'

// 'YYYY-MM-DD' of the current war day (before 3:00 am it is still the previous day, like the server).
export const warToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() - 3 * 3600e3))

// 'YYYY-MM-DD' -> "Mon, 26 Oct" (the date itself, no timezone shifting).
export const formatDay = (iso, options = {}) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...options,
  })

export const formatTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function formatLeft(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(minutes / 60)
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

// Current time, refreshed every `intervalMs`, for countdowns.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
