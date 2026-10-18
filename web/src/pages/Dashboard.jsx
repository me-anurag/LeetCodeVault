import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getStats, listQuestions } from '../api'
import { Button, Difficulty, ErrorBox, Loading, Tag, formatDate, inputClass } from '../components/ui'

const DIFFICULTIES = ['Easy', 'Medium', 'Hard']
const csv = (v) => (v ? v.split(',').filter(Boolean) : [])

// Refetch when the tab regains focus, so questions saved from the extension show up without a manual reload.
function useOnFocus(fn) {
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && fn()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fn])
}

export default function Dashboard() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const difficulty = csv(params.get('difficulty'))
  const topics = params.getAll('topic')
  const language = params.get('language') || ''
  const sort = params.get('sort') || 'newest'
  const page = Number(params.get('page') || 1)
  const filtersActive = q || difficulty.length || topics.length || language

  const [search, setSearch] = useState(q)
  const [list, setList] = useState(null)
  const [listError, setListError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(null)
  const [showAllTopics, setShowAllTopics] = useState(false)
  const abortRef = useRef(null)

  const update = useCallback(
    (changes, { resetPage = true } = {}) => {
      const next = new URLSearchParams(params)
      for (const [k, v] of Object.entries(changes)) {
        next.delete(k)
        if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
        else if (v) next.set(k, v)
      }
      if (resetPage) next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  // Debounced search box -> URL.
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => update({ q: search.trim() }), 250)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSearch(q), [q])

  const queryKey = JSON.stringify({ q, difficulty, topics, language, sort, page })

  const loadList = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setListError(null)
    try {
      setList(await listQuestions(JSON.parse(queryKey), controller.signal))
    } catch (err) {
      if (err.name !== 'AbortError') setListError(err)
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }, [queryKey])

  const loadStats = useCallback(async () => {
    setStatsError(null)
    try {
      setStats(await getStats())
    } catch (err) {
      setStatsError(err)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { loadStats() }, [loadStats])
  const refreshAll = useCallback(() => { loadList(); loadStats() }, [loadList, loadStats])
  useOnFocus(refreshAll)

  const toggle = (key, values, value) =>
    update({ [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] })

  const topicList = stats?.topics || []
  const visibleTopics = showAllTopics ? topicList : topicList.slice(0, 12)

  return (
    <div className="grid gap-8 pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <main className="min-w-0">
        {/* Counts */}
        <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="text-xl font-semibold tabular-nums">{stats ? stats.total : '–'}</span>{' '}
            <span className="text-zinc-500">saved</span>
          </span>
          {DIFFICULTIES.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5">
              <Difficulty value={d} />
              <span className="tabular-nums">{stats ? stats.difficulty[d] : '–'}</span>
            </span>
          ))}
        </div>

        <input
          type="search"
          className={`${inputClass} py-2 text-base`}
          placeholder="Search title, statement keywords, topic, or problem number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        {/* Filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {DIFFICULTIES.map((d) => (
            <Tag key={d} active={difficulty.includes(d)} onClick={() => toggle('difficulty', difficulty, d)}>
              {d}
            </Tag>
          ))}
          <select
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            value={language}
            onChange={(e) => update({ language: e.target.value })}
            aria-label="Language"
          >
            <option value="">Any language</option>
            {(stats?.languages || []).map((l) => (
              <option key={l.language} value={l.language}>
                {l.language_name} ({l.count})
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}
            aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
            <option value="difficulty">Difficulty</option>
            <option value="updated">Recently edited</option>
          </select>
          {topics.map((t) => (
            <Tag key={t} active onClick={() => toggle('topic', topics, t)} title="Remove topic filter">
              {topicList.find((x) => x.slug === t)?.name || t} ×
            </Tag>
          ))}
          {filtersActive ? (
            <button type="button" className="text-xs text-zinc-500 hover:underline"
              onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>
              Clear
            </button>
          ) : null}
        </div>

        <ErrorBox error={listError} onRetry={loadList} />

        {/* Results */}
        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800">
          {loading && !list ? (
            <Loading />
          ) : list && list.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              {filtersActive
                ? 'No questions match these filters.'
                : 'No saved questions yet. Open a LeetCode problem and click Save Question in the extension.'}
            </p>
          ) : (
            <ul className={loading ? 'opacity-60' : ''}>
              {list?.items.map((item) => (
                <QuestionRow key={item.id} item={item} topics={topics} onTopic={(t) => toggle('topic', topics, t)} />
              ))}
            </ul>
          )}
        </div>

        {list && list.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, { resetPage: false })}>
              Previous
            </Button>
            <span className="text-zinc-500">
              Page {list.page} of {list.pages} · {list.total} questions
            </span>
            <Button disabled={page >= list.pages}
              onClick={() => update({ page: String(page + 1) }, { resetPage: false })}>
              Next
            </Button>
          </div>
        )}
      </main>

      <aside className="space-y-7 text-sm">
        <ErrorBox error={statsError} onRetry={loadStats} />
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recently saved</h2>
          {stats?.recent?.length ? (
            <ul className="space-y-1.5">
              {stats.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link to={`/questions/${r.id}`} className="truncate hover:underline">{r.title}</Link>
                  <span className="shrink-0 text-xs text-zinc-500">{formatDate(r.saved_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-500">{stats ? 'Nothing yet.' : '…'}</p>
          )}
        </section>
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Topics</h2>
          {topicList.length ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {visibleTopics.map((t) => (
                  <Tag key={t.slug} active={topics.includes(t.slug)} onClick={() => toggle('topic', topics, t.slug)}>
                    {t.name} <span className="ml-1 opacity-60">{t.count}</span>
                  </Tag>
                ))}
              </div>
              {topicList.length > 12 && (
                <button type="button" className="mt-2 text-xs text-zinc-500 hover:underline"
                  onClick={() => setShowAllTopics(!showAllTopics)}>
                  {showAllTopics ? 'Show fewer' : `Show all ${topicList.length}`}
                </button>
              )}
            </>
          ) : (
            <p className="text-zinc-500">{stats ? 'No topics yet.' : '…'}</p>
          )}
        </section>
      </aside>
    </div>
  )
}

function QuestionRow({ item, topics, onTopic }) {
  return (
    <li className="border-b border-zinc-200 py-2.5 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/questions/${item.id}`} className="min-w-0 font-medium hover:underline">
          {item.frontend_id && <span className="mr-1.5 tabular-nums text-zinc-500">{item.frontend_id}.</span>}
          {item.title}
        </Link>
        <Difficulty value={item.difficulty} className="shrink-0 pt-0.5" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {item.topics.map((t) => (
          <Tag key={t.slug} active={topics.includes(t.slug)} onClick={() => onTopic(t.slug)}>
            {t.name}
          </Tag>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-xs text-zinc-500">
          <span className="font-mono">{item.languages.map((l) => l.language_name).join(', ')}</span>
          <span>·</span>
          <span>{formatDate(item.saved_at)}</span>
        </span>
      </div>
    </li>
  )
}
