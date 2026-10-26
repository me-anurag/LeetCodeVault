import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getWar, setWarDone } from '../api'
import { ErrorBox } from '../components/ui'
import { celebrate, randomCheer } from './confetti'
import { formatDay, formatTime, warToday } from './time'

// The button at the end of a war question. Only shown for questions that came from a daily war.
export default function WarDone({ question }) {
  const item = question.war_items?.[0]
  const [doneAt, setDoneAt] = useState(item?.done_at ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [cheer, setCheer] = useState(null) // shown right after pressing the button
  if (!item) return null

  const deadline = Date.parse(item.war.deadline)
  const late = doneAt && Date.parse(doneAt) > deadline
  const warDate = item.war.war_date
  const isToday = warDate === warToday()

  const toggle = async (done) => {
    setBusy(true)
    setError(null)
    try {
      const res = await setWarDone(item.id, done)
      setDoneAt(res.done_at)
      if (!done) return setCheer(null)
      celebrate()
      setCheer(randomCheer())
      // Was that the last one? Then the whole war is won: bigger party.
      const war = await getWar(warDate).catch(() => null)
      if (war && war.items.length && war.items.every((i) => i.done_at && Date.parse(i.done_at) <= Date.parse(war.deadline))) {
        setTimeout(() => celebrate({ big: true }), 600)
        setCheer(`War won! 🏆 All ${war.items.length} done.`)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`mt-12 rounded-2xl border p-4 text-center ${doneAt
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-orange-200 bg-linear-to-br from-amber-50 to-pink-50'}`}>
      {doneAt ? (
        <>
          {cheer && <p className="cheer mb-1 text-[20px] font-bold text-emerald-800">{cheer}</p>}
          <p className={`text-[16px] font-semibold ${late ? 'text-amber-700' : 'text-emerald-700'}`}>
            {late ? '✓' : '🎉'} Done{late ? ' late' : ''} · {formatTime(doneAt)}{isToday ? '' : `, ${new Date(doneAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
          </p>
          <button type="button" disabled={busy} onClick={() => toggle(false)}
            className="mt-2 text-sm text-muted underline underline-offset-2">Undo</button>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Press only after you understood it and wrote the code yourself.
          </p>
          <button type="button" disabled={busy} onClick={() => toggle(true)}
            className="btn-sun mt-3 w-full rounded-xl py-3 text-[16px] font-semibold disabled:opacity-50">
            {busy ? 'Saving…' : 'I solved it'}
          </button>
        </>
      )}
      <ErrorBox error={error} />
      <Link to={isToday ? '/' : `/war/${warDate}`} className="mt-3 block text-sm text-ink-soft">
        ← {isToday ? "Today's war" : `War of ${formatDay(warDate)}`}
      </Link>
    </section>
  )
}
