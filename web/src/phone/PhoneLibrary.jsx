import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { ErrorBox, Loading } from '../components/ui'
import { MenuItem, Sheet, TopBar, useSheet } from './Sheet'

const DIFFICULTIES = ['Easy', 'Medium', 'Hard']
const DOT = { Easy: 'bg-emerald-500', Medium: 'bg-amber-500', Hard: 'bg-rose-500' }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const fieldClass = 'w-full rounded-lg border border-line bg-white/60 px-3.5 py-2.5 text-ink outline-none focus:border-muted'

// Phone library: just the list of questions. Search, filters, sort, stats and account live in the menu.
export default function PhoneLibrary({
  q, search, setSearch, difficulty, topics, language, sort, page, filtersActive,
  list, listError, loading, loadList, stats, statsError, loadStats, update, toggle, clear,
}) {
  const sheet = useSheet()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const topicList = stats?.topics || []
  const languageName = stats?.languages.find((l) => l.language === language)?.language_name || language
  const summary = [
    q && `“${q}”`,
    ...difficulty,
    language && languageName,
    ...topics.map((t) => topicList.find((x) => x.slug === t)?.name || t),
  ].filter(Boolean).join(' · ')

  const goToPage = (n) => {
    update({ page: n > 1 ? String(n) : '' }, { resetPage: false })
    window.scrollTo(0, 0)
  }

  return (
    <div className="reader mx-auto max-w-xl px-5 pb-[max(4rem,env(safe-area-inset-bottom))]">
      <TopBar onMenu={() => sheet.show('menu')} />

      <div className="flex items-baseline justify-between pt-5 pb-3">
        <h1 className="text-[24px] font-semibold tracking-tight">Library</h1>
        {list && <span className="text-sm text-muted">{plural(list.total, 'question')}</span>}
      </div>

      {filtersActive ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-paper-2 px-3.5 py-2 text-sm">
          <button type="button" className="min-w-0 flex-1 truncate text-left text-ink-soft" onClick={() => sheet.show('menu')}>
            {summary}
          </button>
          <button type="button" className="shrink-0 font-medium" onClick={clear}>Clear</button>
        </div>
      ) : null}

      <ErrorBox error={listError} onRetry={loadList} />

      {loading && !list ? (
        <Loading />
      ) : list && list.items.length === 0 ? (
        <p className="py-12 text-center text-[15px] leading-relaxed text-muted">
          {filtersActive
            ? 'No questions match.'
            : 'No saved questions yet. Open a LeetCode problem on your computer and save it with the extension.'}
        </p>
      ) : (
        <ul className={`border-t border-line ${loading ? 'opacity-60' : ''}`}>
          {list?.items.map((item) => (
            <li key={item.id}>
              <Link to={`/questions/${item.id}`} className="flex items-center gap-3 border-b border-line py-3.5 active:opacity-60">
                <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted">{item.frontend_id}</span>
                <span className="min-w-0 flex-1 text-[16px] leading-snug">{item.title}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.difficulty]}`} title={item.difficulty} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list && list.pages > 1 && (
        <div className="mt-5 flex items-center justify-between text-[15px]">
          <button type="button" className="py-2 text-ink-soft disabled:opacity-30" disabled={page <= 1}
            onClick={() => goToPage(page - 1)}>‹ Previous</button>
          <span className="text-sm text-muted">{list.page} / {list.pages}</span>
          <button type="button" className="py-2 text-ink-soft disabled:opacity-30" disabled={page >= list.pages}
            onClick={() => goToPage(page + 1)}>Next ›</button>
        </div>
      )}

      {sheet.open === 'menu' && (
        <Sheet title="Search & filter" onClose={sheet.close}
          footer={
            <button type="button" onClick={sheet.close}
              className="btn-sun w-full rounded-xl py-3 text-[16px] font-semibold">
              {loading || !list ? 'Searching…' : `Show ${plural(list.total, 'question')}`}
            </button>
          }>
          <input type="search" className={fieldClass} placeholder="Title, words, topic or number"
            value={search} onChange={(e) => setSearch(e.target.value)} />

          <Group title="Difficulty">
            {DIFFICULTIES.map((d) => (
              <Chip key={d} active={difficulty.includes(d)} onClick={() => toggle('difficulty', difficulty, d)}>
                {d}{stats ? <span className="ml-1.5 opacity-60">{stats.difficulty[d]}</span> : null}
              </Chip>
            ))}
          </Group>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <label className="text-[13px] text-muted">
              Language
              <select className={`${fieldClass} mt-1.5`} value={language} onChange={(e) => update({ language: e.target.value })}>
                <option value="">Any</option>
                {(stats?.languages || []).map((l) => (
                  <option key={l.language} value={l.language}>{l.language_name} ({l.count})</option>
                ))}
              </select>
            </label>
            <label className="text-[13px] text-muted">
              Sort
              <select className={`${fieldClass} mt-1.5`} value={sort}
                onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title A–Z</option>
                <option value="difficulty">Difficulty</option>
                <option value="updated">Recently edited</option>
              </select>
            </label>
          </div>

          {topicList.length > 0 && (
            <Group title="Topics">
              {topicList.map((t) => (
                <Chip key={t.slug} active={topics.includes(t.slug)} onClick={() => toggle('topic', topics, t.slug)}>
                  {t.name}<span className="ml-1.5 opacity-60">{t.count}</span>
                </Chip>
              ))}
            </Group>
          )}

          <ErrorBox error={statsError} onRetry={loadStats} />
          {filtersActive ? (
            <button type="button" className="mt-6 text-sm font-medium text-ink-soft" onClick={clear}>Clear all filters</button>
          ) : null}

          <div className="mt-8 border-t border-line">
            <MenuItem onClick={() => navigate('/', { replace: true })}>Today's war</MenuItem>
            <MenuItem tone="muted" hint={user?.email} onClick={logout}>Log out</MenuItem>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function Group({ title, children }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[13px] text-muted">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

function Chip({ active, onClick, children }) {
  const tone = active ? 'border-orange-500 bg-orange-500 text-white' : 'border-line bg-white/60 text-ink-soft'
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm ${tone}`}>
      {children}
    </button>
  )
}
