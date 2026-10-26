import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWarSettings, setWarTopics } from '../api'
import { useAuth } from '../auth'
import { ErrorBox, Loading } from '../components/ui'
import { MenuItem, Sheet, TopBar, useSheet } from '../phone/Sheet'
import { useIsPhone } from '../theme'
import { TOPICS, topicName } from '../war/topics'

// Choose which topics the daily wars draw from (or any topic). Applies from the next war.
export default function TopicFocus() {
  const isPhone = useIsPhone()
  const navigate = useNavigate()
  const sheet = useSheet()
  const { user, logout } = useAuth()
  const [saved, setSaved] = useState(null) // topics currently stored
  const [picked, setPicked] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    getWarSettings()
      .then((s) => { setSaved(s.topics); setPicked(s.topics) })
      .catch(setError)
  }, [])

  const toggle = (slug) => {
    setNotice(null)
    setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]))
  }
  const dirty = saved && [...picked].sort().join() !== [...saved].sort().join()

  const save = async (topics) => {
    setBusy(true)
    setError(null)
    try {
      const res = await setWarTopics(topics)
      setSaved(res.topics)
      setPicked(res.topics)
      setNotice(res.topics.length
        ? `Saved. From your next war, questions come only from ${res.topics.map(topicName).join(', ')}.`
        : 'Saved. From your next war, questions come from any topic.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`reader mx-auto ${isPhone ? 'max-w-xl px-5' : 'max-w-2xl pt-2'} pb-[max(6rem,env(safe-area-inset-bottom))]`}>
      {isPhone && <TopBar onMenu={() => sheet.show('menu')} />}
      {sheet.open === 'menu' && (
        <Sheet title="Menu" onClose={sheet.close}>
          <MenuItem onClick={() => navigate('/', { replace: true })}>Today's war</MenuItem>
          <MenuItem onClick={() => navigate('/history', { replace: true })}>History</MenuItem>
          <MenuItem onClick={() => navigate('/library', { replace: true })}>Library</MenuItem>
          <MenuItem tone="muted" hint={user?.email} onClick={logout}>Log out</MenuItem>
        </Sheet>
      )}

      <div className="mt-4 rounded-3xl bg-linear-to-br from-sky-100 via-violet-50 to-pink-100 p-5">
        <h1 className="text-[28px] font-bold tracking-tight">Topic focus 🎯</h1>
        <p className="mt-1 text-[15px] text-ink-soft">
          Pick the topics your wars should come from. You still get 5 Easy, 7 Medium and 3 Hard, and never a repeat.
        </p>
        <p className="mt-2 text-[14px] font-medium text-violet-800">
          Now: {saved == null ? '…' : saved.length ? saved.map(topicName).join(', ') : 'Any topic (random)'}
        </p>
      </div>

      <ErrorBox error={error} />
      {notice && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-[14px] text-emerald-800">{notice}</p>}

      {saved == null && !error ? (
        <Loading />
      ) : (
        <>
          <button type="button" onClick={() => setPicked([])}
            className={`mt-5 w-full rounded-2xl border px-4 py-3 text-left text-[15px] font-medium ${picked.length === 0
              ? 'border-orange-400 bg-orange-50 text-orange-800'
              : 'border-line bg-white/70 text-ink-soft'}`}>
            🎲 Any topic (random)
          </button>

          <h2 className="mt-6 mb-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-violet-600">Or only these topics</h2>
          <div className="flex flex-wrap gap-2">
            {TOPICS.map(([slug, name]) => {
              const on = picked.includes(slug)
              return (
                <button key={slug} type="button" onClick={() => toggle(slug)} aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on
                    ? 'border-violet-500 bg-violet-500 text-white'
                    : 'border-line bg-white/70 text-ink-soft'}`}>
                  {on ? '✓ ' : ''}{name}
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            A question needs only one of the chosen topics. Today's war stays as it is; the change starts with the next
            war at 3:00 am. If a topic runs out of new questions of some difficulty, the rest of that day is filled from
            any topic.
          </p>
        </>
      )}

      {saved != null && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-paper/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" disabled={!dirty || busy} onClick={() => save(picked)}
            className="btn-sun mx-auto block w-full max-w-xl rounded-xl py-3 text-[16px] font-semibold disabled:opacity-40 disabled:shadow-none">
            {busy ? 'Saving…' : dirty ? (picked.length ? `Save · ${picked.length} topic${picked.length === 1 ? '' : 's'}` : 'Save · any topic') : 'Saved'}
          </button>
        </div>
      )}
    </div>
  )
}
