import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getWarHistory } from '../api'
import { useAuth } from '../auth'
import { DifficultyPill, ErrorBox, Loading, useOnFocus } from '../components/ui'
import { MenuItem, Sheet, TopBar, useSheet } from '../phone/Sheet'
import { useIsPhone } from '../theme'
import { formatDay } from '../war/time'

const PAGE = 100
const SORTS = [
  ['newest', 'Newest given'],
  ['oldest', 'Oldest given'],
  ['number_asc', 'Number ↑'],
  ['number_desc', 'Number ↓'],
  ['difficulty', 'Difficulty'],
  ['title', 'Title A–Z'],
]
const DIFF_CHIP = {
  Easy: 'border-emerald-500 bg-emerald-500 text-white',
  Medium: 'border-amber-500 bg-amber-500 text-white',
  Hard: 'border-rose-500 bg-rose-500 text-white',
}

// Every question the daily wars have given, filterable by difficulty and topic (Array, String, ...).
export default function History() {
  const isPhone = useIsPhone()
  const sheet = useSheet()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [params, setParams] = useSearchParams()
  const sort = params.get('sort') || 'newest'
  const difficulty = params.getAll('difficulty')
  const topics = params.getAll('topic')
  const [limit, setLimit] = useState(PAGE)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [allTopics, setAllTopics] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState([]) // question ids, in tap order

  const key = JSON.stringify({ sort, difficulty, topics, limit })
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getWarHistory(JSON.parse(key)))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [key])
  useEffect(() => { load() }, [load])
  useOnFocus(load)

  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      next.delete(k)
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
      else if (v) next.set(k, v)
    }
    setLimit(PAGE)
    setParams(next, { replace: true })
  }
  const toggle = (k, list, v) => update({ [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] })
  const filtered = difficulty.length > 0 || topics.length > 0

  const selectable = (data?.items || []).filter((i) => i.question_id).map((i) => i.question_id)
  const toggleSelected = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.includes(id))
  // Keep the list's order (as sorted/filtered on screen) in the document.
  const savePdf = () => {
    const ids = selectable.filter((id) => selected.includes(id))
    navigate(`/print?ids=${ids.join(',')}&title=${encodeURIComponent(`${ids.length} question${ids.length === 1 ? '' : 's'}`)}`)
  }

  const topicList = data?.topics || []
  const shownTopics = allTopics ? topicList : topicList.slice(0, 10)

  const body = (
    <>
      <div className="mt-4 rounded-3xl bg-linear-to-br from-violet-100 via-fuchsia-50 to-sky-100 p-5">
        <h1 className="text-[28px] font-bold tracking-tight">History 📜</h1>
        <p className="mt-1 text-[15px] text-ink-soft">
          {data ? `${data.total} question${data.total === 1 ? '' : 's'} · ${data.solved} solved` : 'Every question your wars have given you.'}
        </p>
        <p className="mt-1 text-[13px] text-muted">A question is never given twice.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}
          aria-label="Sort"
          className="rounded-full border border-line bg-white/70 px-3 py-1.5 text-sm text-ink outline-none focus:border-orange-400">
          {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {['Easy', 'Medium', 'Hard'].map((d) => (
          <Chip key={d} active={difficulty.includes(d)} activeClass={DIFF_CHIP[d]} onClick={() => toggle('difficulty', difficulty, d)}>
            {d}
          </Chip>
        ))}
        {filtered && (
          <button type="button" className="text-sm font-medium text-orange-600" onClick={() => update({ difficulty: [], topic: [] })}>
            Clear
          </button>
        )}
        <button type="button" onClick={() => { setSelecting(!selecting); setSelected([]) }}
          className={`ml-auto rounded-full border px-3 py-1.5 text-sm font-medium ${selecting
            ? 'border-orange-500 bg-orange-500 text-white'
            : 'border-orange-200 bg-orange-50 text-orange-700'}`}>
          {selecting ? 'Cancel' : '📄 Select for PDF'}
        </button>
      </div>

      {topicList.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {shownTopics.map((t) => (
            <Chip key={t.slug} small active={topics.includes(t.slug)} activeClass="border-violet-500 bg-violet-500 text-white"
              onClick={() => toggle('topic', topics, t.slug)}>
              {t.name}<span className="ml-1 opacity-60">{t.count}</span>
            </Chip>
          ))}
          {topicList.length > 10 && (
            <button type="button" className="px-1 text-xs font-medium text-violet-700" onClick={() => setAllTopics(!allTopics)}>
              {allTopics ? 'Fewer' : `All ${topicList.length} topics`}
            </button>
          )}
        </div>
      )}

      <ErrorBox error={error} onRetry={load} />

      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <p className="py-12 text-center text-[15px] text-muted">
          {filtered ? 'No questions match these filters.' : 'No wars yet. Your first 15 questions arrive at 3:00 am.'}
        </p>
      ) : (
        <ul className={`mt-4 border-t border-line ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((item) => (
            <Row key={item.id} item={item} selecting={selecting}
              checked={selected.includes(item.question_id)} onToggle={() => toggleSelected(item.question_id)} />
          ))}
        </ul>
      )}

      {data && data.items.length < data.total && (
        <button type="button" onClick={() => setLimit(limit + PAGE)}
          className="mt-5 w-full rounded-xl border border-line bg-white/60 py-2.5 text-[15px] font-medium text-ink-soft">
          Show more ({data.total - data.items.length} left)
        </button>
      )}

      {selecting && <div className="h-24" aria-hidden />}
      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <button type="button" onClick={() => setSelected(allSelected ? [] : selectable)}
              className="shrink-0 rounded-xl border border-line bg-white/70 px-3 py-3 text-[14px] font-medium text-ink-soft">
              {allSelected ? 'None' : `Select all (${selectable.length})`}
            </button>
            <button type="button" disabled={!selected.length} onClick={savePdf}
              className="btn-sun flex-1 rounded-xl py-3 text-[16px] font-semibold disabled:opacity-40 disabled:shadow-none">
              {selected.length ? `Save ${selected.length} as PDF` : 'Tap questions to select'}
            </button>
          </div>
        </div>
      )}
    </>
  )

  if (!isPhone) return <div className="reader mx-auto max-w-2xl pt-2 pb-16">{body}</div>

  return (
    <div className="reader mx-auto max-w-xl px-5 pb-[max(4rem,env(safe-area-inset-bottom))]">
      <TopBar onMenu={() => sheet.show('menu')} />
      {body}
      {sheet.open === 'menu' && (
        <Sheet title="Menu" onClose={sheet.close}>
          <MenuItem onClick={() => navigate('/', { replace: true })}>Today's war</MenuItem>
          <MenuItem onClick={() => navigate('/library', { replace: true })}>Library</MenuItem>
          <MenuItem tone="muted" hint={user?.email} onClick={logout}>Log out</MenuItem>
        </Sheet>
      )}
    </div>
  )
}

function Row({ item, selecting, checked, onToggle }) {
  const mark = selecting ? (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-[12px] text-white ${checked
      ? 'border-orange-500 bg-orange-500' : 'border-line bg-white'} ${item.question_id ? '' : 'opacity-30'}`}
      aria-hidden>{checked ? '✓' : ''}</span>
  ) : !item.done_at ? (
    <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-line" aria-label="Not solved" />
  ) : (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${item.on_time ? 'bg-emerald-500' : 'bg-amber-500'}`}
      aria-label={item.on_time ? 'Solved' : 'Solved late'}>✓</span>
  )
  const content = (
    <>
      {mark}
      <div className="min-w-0 flex-1">
        <div className="text-[16px] leading-snug">
          {item.frontend_id && <span className="mr-1.5 text-sm tabular-nums text-muted">{item.frontend_id}.</span>}
          {item.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <DifficultyPill value={item.difficulty} />
          {item.topics.slice(0, 3).map((t) => <span key={t.slug} className="text-violet-700">{t.name}</span>)}
          <span>· {formatDay(item.war_date)}</span>
        </div>
      </div>
    </>
  )
  const className = 'flex items-start gap-3 border-b border-line py-3 active:opacity-60 [&>span:first-child]:mt-0.5'
  if (selecting) {
    return (
      <li>
        <button type="button" disabled={!item.question_id} onClick={onToggle} aria-pressed={checked}
          className={`${className} w-full text-left disabled:cursor-not-allowed`}>{content}</button>
      </li>
    )
  }
  return (
    <li>
      {item.question_id ? (
        <Link to={`/questions/${item.question_id}`} className={className}>{content}</Link>
      ) : (
        <a href={`https://leetcode.com/problems/${item.slug}/`} target="_blank" rel="noopener noreferrer" className={className}>{content}</a>
      )}
    </li>
  )
}

function Chip({ active, activeClass, onClick, small, children }) {
  const size = small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  const tone = active ? activeClass : 'border-line bg-white/70 text-ink-soft'
  return (
    <button type="button" onClick={onClick} className={`rounded-full border font-medium ${size} ${tone}`}>
      {children}
    </button>
  )
}
