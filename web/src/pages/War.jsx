import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getWar, getWarSettings } from '../api'
import { useAuth } from '../auth'
import { ErrorBox, Loading, useOnFocus } from '../components/ui'
import { MenuItem, Sheet, TopBar, useSheet } from '../phone/Sheet'
import { useIsPhone } from '../theme'
import StreakCalendar from '../war/StreakCalendar'
import { animalParade, celebrate } from '../war/confetti'
import { formatDay, useNow } from '../war/time'
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
  const won = total > 0 && onTime === total

  // A won war gets one big celebration per day (per browser tab session).
  useEffect(() => {
    if (!won || !isToday) return
    const key = `celebrated-${war.date}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* storage unavailable: celebrate anyway */ }
    celebrate({ big: true })
    animalParade()
  }, [won, isToday, war.date])

  const pdfIds = war.items.filter((i) => i.question_id).map((i) => i.question_id)
  const pdfTitle = `War · ${formatDay(war.date, { weekday: 'long', year: 'numeric' })}`

  return (
    <>
      <div className={`war-hero ${won ? 'won' : ''} relative mt-4 overflow-hidden rounded-3xl px-6 pt-7 pb-12`}>
        <Bubbles />
        <span className="flyer" aria-hidden><span>🦋</span></span>
        <span className="walker" aria-hidden><span>{walkerFor(war.date)}</span></span>
        <h1 className="relative text-[30px] font-bold tracking-tight">
          {isToday ? "Today's war" : `War · ${formatDay(war.date)}`} <span className="sway" aria-hidden>{won ? '🏆' : '⚔️'}</span>
        </h1>
        {isToday && focusText && (
          <Link to="/topics" className="relative mt-3 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/75 px-3 py-1.5 text-[14px] font-medium text-violet-700 shadow-sm">
            🎯 Focus: {focusText} ›
          </Link>
        )}
      </div>
      <ErrorBox error={error} onRetry={onRetry} />

      {!total && (
        <div className="mt-8 text-center">
          {isToday && !ended && (
            <span className="sleepy" aria-hidden>🐈<span className="z">z</span><span className="z">z</span><span className="z">z</span></span>
          )}
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            {isToday && !ended
              ? 'Your questions are on their way ☕ They arrive right after 3:00 am.'
              : 'No war on this day.'}
          </p>
        </div>
      )}

      {total > 0 && (
        <ul className="mt-6 border-t border-line">
          {war.items.map((item, i) => (
            <WarRow key={item.id} item={item} n={i + 1} deadline={deadline} />
          ))}
        </ul>
      )}

      {pdfIds.length > 0 && (
        <Link to={`/print?ids=${pdfIds.join(',')}&title=${encodeURIComponent(pdfTitle)}`}
          className="mt-10 flex items-center justify-center gap-2 rounded-2xl border border-line bg-white/60 py-3 text-[15px] font-medium text-ink-soft active:opacity-70">
          📄 Save this war as PDF
        </Link>
      )}
    </>
  )
}

// The animal strolling across the war card: a different one each day, the same all day.
const WALKERS = ['🐈', '🐕', '🦊', '🐼', '🐧', '🦔', '🐢', '🐇', '🐿️', '🦆', '🐑', '🦙', '🐘', '🦒']
function walkerFor(date) {
  let h = 0
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return WALKERS[h % WALKERS.length]
}

// Soft light bubbles drifting inside the war card.
const BUBBLES = [
  { size: 90, left: '-6%', top: '-30%', dur: 11, dx: '24px', dy: '18px' },
  { size: 54, left: '72%', top: '8%', dur: 9, dx: '-18px', dy: '22px' },
  { size: 34, left: '48%', top: '62%', dur: 7, dx: '16px', dy: '-14px' },
  { size: 120, left: '82%', top: '55%', dur: 13, dx: '-26px', dy: '-16px' },
  { size: 22, left: '30%', top: '12%', dur: 8, dx: '12px', dy: '16px' },
]

function Bubbles() {
  return BUBBLES.map((b, i) => (
    <span key={i} className="bubble" aria-hidden style={{
      width: b.size, height: b.size, left: b.left, top: b.top,
      animationDuration: `${b.dur}s`, animationDelay: `${-i * 1.7}s`, '--dx': b.dx, '--dy': b.dy,
    }} />
  ))
}

function WarRow({ item, n, deadline }) {
  const late = item.done_at && Date.parse(item.done_at) > deadline
  const mark = !item.done_at ? (
    <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-line" aria-label="Not done" />
  ) : (
    <span className={`pop flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${late ? 'bg-amber-500' : 'bg-emerald-600'}`}
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
