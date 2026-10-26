import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getWar, getWarSettings } from '../api'
import { useAuth } from '../auth'
import { ErrorBox, Loading, useOnFocus } from '../components/ui'
import { MenuItem, Sheet, TopBar, useSheet } from '../phone/Sheet'
import { useIsPhone } from '../theme'
import StreakCalendar from '../war/StreakCalendar'
import { formatDay, formatLeft, formatTime, useNow } from '../war/time'
import { topicName } from '../war/topics'

const DOT = { Easy: 'bg-emerald-500', Medium: 'bg-amber-500', Hard: 'bg-rose-500' }

// Home screen: today's 15 questions (or a past day's, at /war/:date), progress and time left.
export default function War() {
  const { date } = useParams()
  const isPhone = useIsPhone()
  const sheet = useSheet()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const now = useNow()
  const [war, setWar] = useState(null)
  const [focus, setFocus] = useState(null) // chosen topic slugs, [] = any
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [w, settings] = await Promise.all([getWar(date), getWarSettings()])
      setWar(w)
      setFocus(settings.topics)
    } catch (err) {
      setError(err)
    }
  }, [date])
  const focusText = focus?.length ? focus.map(topicName).join(', ') : 'Any topic'

  useEffect(() => { load() }, [load])
  useOnFocus(load)

  // While today's questions are still being fetched, check again every minute.
  const preparing = war && war.date === war.today && war.items.length < 15 && now < Date.parse(war.deadline)
  useEffect(() => {
    if (!preparing) return
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [preparing, load])

  const content = !war ? (
    error ? <ErrorBox error={error} onRetry={load} /> : <Loading />
  ) : (
    <WarBody war={war} now={now} error={error} onRetry={load} focusText={focus ? focusText : null} />
  )

  if (!isPhone) return <div className="reader mx-auto max-w-2xl pt-6 pb-16">{content}</div>

  return (
    <div className="reader mx-auto max-w-xl px-5 pb-[max(4rem,env(safe-area-inset-bottom))]">
      <TopBar onMenu={() => sheet.show('menu')} />
      {content}

      {sheet.open === 'menu' && (
        <Sheet title="Menu" onClose={sheet.close}>
          {date && <MenuItem onClick={() => navigate('/', { replace: true })}>Today's war</MenuItem>}
          <MenuItem hint={war ? `${war.streak.current} day${war.streak.current === 1 ? '' : 's'}` : ''}
            onClick={() => sheet.show('streak')}>Streak calendar</MenuItem>
          <MenuItem onClick={() => navigate('/history', { replace: true })}>History · all questions given</MenuItem>
          <MenuItem hint={focus ? focusText : ''} onClick={() => navigate('/topics', { replace: true })}>Topic focus</MenuItem>
          <MenuItem onClick={() => navigate('/library', { replace: true })}>Library</MenuItem>
          <MenuItem tone="muted" hint={user?.email} onClick={logout}>Log out</MenuItem>
        </Sheet>
      )}
      {sheet.open === 'streak' && (
        <Sheet title="Streak" onClose={sheet.close}>
          <StreakCalendar onPick={(d) => navigate(d === war?.today ? '/' : `/war/${d}`, { replace: true })} />
        </Sheet>
      )}
    </div>
  )
}

function WarBody({ war, now, error, onRetry, focusText }) {
  const isToday = war.date === war.today
  const deadline = Date.parse(war.deadline)
  const ended = now >= deadline
  const total = war.items.length
  const onTime = war.items.filter((i) => i.done_at && Date.parse(i.done_at) <= deadline).length
  const done = war.items.filter((i) => i.done_at).length
  const won = total > 0 && onTime === total

  let status
  if (!total) {
    status = isToday && !ended
      ? 'Your 15 questions are being picked. They usually arrive right after 3:00 am. This page refreshes on its own.'
      : 'No war on this day.'
  } else if (won) {
    status = 'Won. Every question done before the deadline.'
  } else if (!ended) {
    status = `${formatLeft(deadline - now)} left · ends ${formatTime(deadline)}`
  } else {
    status = `Ended at ${formatTime(deadline)} · ${onTime} of ${total} on time`
  }

  return (
    <>
      <div className={`mt-4 rounded-3xl bg-linear-to-br p-5 ${won
        ? 'from-emerald-100 via-teal-50 to-sky-100'
        : 'from-amber-100 via-orange-100 to-pink-100'}`}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-orange-700/80">
          {formatDay(war.date, { weekday: 'long' })}
        </p>
        <h1 className="mt-1 text-[28px] font-bold tracking-tight">
          {won ? 'Victory! 🎉' : isToday ? "Today's war ⚔️" : 'War'}
        </h1>
        <p className={`mt-1 text-[15px] ${won ? 'text-emerald-800' : 'text-ink-soft'}`}>{status}</p>
        {isToday && ended && (
          <p className="mt-1 text-[15px] text-ink-soft">Next war at {formatTime(war.next_start)}.</p>
        )}
        {isToday && focusText && (
          <Link to="/topics" className="mt-2 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/70 px-2.5 py-1 text-[13px] font-medium text-violet-700">
            🎯 Focus: {focusText} ›
          </Link>
        )}

        {total > 0 && (
          <>
            <div className="mt-4 flex items-baseline justify-between text-sm">
              <span>
                <span className="text-[24px] font-bold tabular-nums">{done}</span>
                <span className="text-ink-soft"> / {total} done</span>
              </span>
              <span className="rounded-full bg-white/70 px-2.5 py-1 font-medium text-orange-700">
                🔥 {war.streak.current} day{war.streak.current === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/70">
              <div className={`h-full rounded-full bg-linear-to-r transition-all duration-500 ${won
                ? 'from-emerald-400 to-teal-500'
                : 'from-orange-400 via-pink-500 to-violet-500'}`}
                style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </>
        )}
      </div>
      <ErrorBox error={error} onRetry={onRetry} />

      {total > 0 && (
        <ul className="mt-6 border-t border-line">
          {war.items.map((item, i) => (
            <WarRow key={item.id} item={item} n={i + 1} deadline={deadline} />
          ))}
        </ul>
      )}
    </>
  )
}

function WarRow({ item, n, deadline }) {
  const late = item.done_at && Date.parse(item.done_at) > deadline
  const mark = !item.done_at ? (
    <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-line" aria-label="Not done" />
  ) : (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${late ? 'bg-amber-500' : 'bg-emerald-600'}`}
      aria-label={late ? 'Done late' : 'Done'}>✓</span>
  )
  const body = (
    <>
      {mark}
      <span className={`min-w-0 flex-1 text-[16px] leading-snug ${item.done_at ? 'text-muted line-through decoration-line' : ''}`}>
        <span className="mr-1.5 text-sm tabular-nums text-muted">{n}.</span>
        {item.title}
      </span>
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.difficulty]}`} title={item.difficulty} />
    </>
  )
  const className = 'flex items-center gap-3 border-b border-line py-3.5 active:opacity-60'
  return (
    <li>
      {item.question_id ? (
        <Link to={`/questions/${item.question_id}`} className={className}>{body}</Link>
      ) : (
        // The question was deleted from the library: fall back to LeetCode.
        <a href={`https://leetcode.com/problems/${item.slug}/`} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>
      )}
    </li>
  )
}
