import { useEffect, useState } from 'react'
import { getStreak, getWarDays } from '../api'
import { ErrorBox } from '../components/ui'
import { warToday } from './time'

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}` // m is 0-based
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Month view of past wars: won days filled green, partial days amber, missed days red. Tapping a day opens it.
export default function StreakCalendar({ onPick }) {
  const today = warToday()
  const [month, setMonth] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [days, setDays] = useState({})
  const [streak, setStreak] = useState(null)
  const [error, setError] = useState(null)

  const daysInMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate()
  const firstWeekday = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7 // Monday first

  useEffect(() => {
    let live = true
    setError(null)
    Promise.all([getWarDays(iso(month.y, month.m, 1), iso(month.y, month.m, daysInMonth)), getStreak()])
      .then(([rows, s]) => {
        if (!live) return
        setDays(Object.fromEntries(rows.map((r) => [r.war_date, r])))
        setStreak(s)
      })
      .catch((err) => live && setError(err))
    return () => { live = false }
  }, [month.y, month.m, daysInMonth])

  const shift = (delta) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + delta) / 12), m: (m + delta + 12) % 12 }))
  const title = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' })
  const isCurrentMonth = today.startsWith(`${month.y}-${pad(month.m + 1)}`)

  return (
    <div className="text-ink">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={streak?.current} label="Current streak" />
        <Stat value={streak?.best} label="Best streak" />
        <Stat value={streak?.won} label="Wars won" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft active:bg-paper-2">‹</button>
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" disabled={isCurrentMonth}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft active:bg-paper-2 disabled:opacity-25">›</button>
      </div>

      <ErrorBox error={error} />

      <div className="mt-2 grid grid-cols-7 gap-y-1.5 text-center">
        {WEEKDAYS.map((d, i) => <div key={i} className="pb-1 text-xs text-muted">{d}</div>)}
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`blank${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = iso(month.y, month.m, i + 1)
          return <Day key={date} n={i + 1} day={days[date]} isToday={date === today} future={date > today}
            onPick={() => onPick(date)} />
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        <Legend className="bg-emerald-500" label="Won" />
        <Legend className="bg-amber-200" label="Partly done" />
        <Legend className="bg-rose-200" label="Missed" />
        <Legend className="ring-[1.5px] ring-ink" label="Today" />
      </div>
    </div>
  )
}

function Stat({ value, label }) {
  return (
    <div className="rounded-xl bg-paper-2 px-2 py-3">
      <div className="text-[22px] font-semibold tabular-nums">{value ?? '–'}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

function Day({ n, day, isToday, future, onPick }) {
  let tone = future ? 'text-muted/50' : 'text-muted'
  if (day && day.total > 0) {
    if (day.won) tone = 'bg-emerald-500 font-semibold text-white'
    else if (!day.ended) tone = 'text-ink font-medium'
    else if (day.done > 0) tone = 'bg-amber-200 text-amber-900'
    else tone = 'bg-rose-200 text-rose-900'
  }
  const ring = isToday ? 'ring-[1.5px] ring-ink' : ''
  const clickable = day && day.total > 0
  return (
    <div className="flex flex-col items-center">
      <button type="button" disabled={!clickable} onClick={onPick}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums ${tone} ${ring}`}>
        {n}
      </button>
      <span className="mt-0.5 h-3.5 text-[10px] leading-none tabular-nums text-muted">
        {clickable ? `${day.on_time}/${day.total}` : ''}
      </span>
    </div>
  )
}

function Legend({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-full ${className}`} />
      {label}
    </span>
  )
}
