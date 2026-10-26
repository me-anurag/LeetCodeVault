import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import {
  createSolution, deleteLanguage, deleteQuestion as removeQuestion, deleteSolution, getQuestion, updateNotes, updateSolution,
} from '../api'
import CodeBlock from '../components/CodeBlock'
import { Button, Difficulty, ErrorBox, Loading, Tag, formatDate, inputClass } from '../components/ui'
import PhoneQuestion from '../phone/PhoneQuestion'
import { useUnsaved } from '../pwa'
import { useIsPhone } from '../theme'
import WarDone from '../war/WarDone'

// Statement images are hosted by LeetCode; open links in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function Section({ title, children, right }) {
  return (
    <section className={title ? 'mt-8' : ''}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {title && <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>}
        {right}
      </div>
      {children}
    </section>
  )
}

export default function QuestionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const [question, setQuestion] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('statement')
  const [lang, setLang] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const question = await getQuestion(id)
      setQuestion(question)
      setLang((cur) =>
        question.language_versions.some((v) => v.language === cur) ? cur : question.language_versions[0]?.language,
      )
    } catch (err) {
      setError(err)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const statementHtml = useMemo(
    () => (question ? DOMPurify.sanitize(question.description, { USE_PROFILES: { html: true } }) : ''),
    [question],
  )

  if (error && !question) {
    return (
      <div className="pt-6">
        <Link to="/library" className="text-sm text-zinc-500 hover:underline">← Library</Link>
        <ErrorBox error={error} onRetry={error.code === 'not_found' ? null : load} />
      </div>
    )
  }
  if (!question) return <Loading />

  const removeLanguage = async (v) => {
    if (!window.confirm(`Remove the saved ${v.language_name} starter code?`)) return
    try {
      await deleteLanguage(id, v.language)
      setLang(null)
      await load()
    } catch (err) {
      setError(err)
    }
  }

  const deleteQuestion = async () => {
    if (!window.confirm(`Delete "${question.title}" and all its saved code, notes and solutions? This cannot be undone.`))
      return
    try {
      await removeQuestion(id)
      navigate('/library', { replace: true })
    } catch (err) {
      setError(err)
    }
  }

  if (isPhone) {
    return (
      <PhoneQuestion question={question} statementHtml={statementHtml} error={error} reload={load}
        lang={lang} setLang={setLang} onRemoveLanguage={removeLanguage} onDelete={deleteQuestion}
        onNotesSaved={(notes) => setQuestion({ ...question, personal_notes: notes })} />
    )
  }

  const tabs = [
    ['statement', 'Statement'],
    ['examples', `Examples (${question.examples.length})`],
    ['constraints', `Constraints (${question.constraints.length})`],
  ]

  return (
    <article className="mx-auto max-w-3xl pt-5">
      <Link to="/library" className="text-sm text-zinc-500 hover:underline">← Library</Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        {question.frontend_id && <span className="mr-2 text-zinc-500">{question.frontend_id}.</span>}
        {question.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <Difficulty value={question.difficulty} />
        {question.topics.map((t) => (
          <Link key={t.slug} to={`/library?topic=${t.slug}`}><Tag>{t.name}</Tag></Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>Saved {formatDate(question.saved_at, true)}</span>
        <a href={question.leetcode_url} target="_blank" rel="noopener noreferrer"
          className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100">
          Open on LeetCode ↗
        </a>
        <Link to={`/print?ids=${question.id}`} className="font-medium text-orange-600 underline-offset-2 hover:underline">
          📄 Save as PDF
        </Link>
        <span className="break-all">{question.leetcode_url}</span>
      </div>

      <ErrorBox error={error} />

      <div className="mt-6 flex gap-4 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-2 ${tab === key ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-transparent text-zinc-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'statement' && (
        <div className="statement mt-2" dangerouslySetInnerHTML={{ __html: statementHtml }} />
      )}
      {tab === 'examples' && (
        <div className="mt-4 space-y-4">
          {question.examples.length === 0 && <p className="text-sm text-zinc-500">No examples were extracted. See the statement.</p>}
          {question.examples.map((ex, i) => (
            <div key={i}>
              <p className="mb-1 text-sm font-semibold">{ex.title}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-zinc-300 bg-zinc-50 px-4 py-3 text-[13px] leading-6 dark:border-zinc-700 dark:bg-zinc-900">{ex.text}</pre>
            </div>
          ))}
        </div>
      )}
      {tab === 'constraints' && (
        <ul className="mt-4 list-disc space-y-1 pl-6 font-mono text-[13px]">
          {question.constraints.length === 0 && <li className="list-none text-sm text-zinc-500">No constraints were extracted.</li>}
          {question.constraints.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}

      <Section title="Starter code">
        <StarterCode question={question} lang={lang} setLang={setLang} onRemove={removeLanguage} />
      </Section>

      <Notes question={question} onSaved={(notes) => setQuestion({ ...question, personal_notes: notes })} />
      <Solutions question={question} reload={load} />
      <WarDone key={question.id} question={question} />

      <div className="mt-12 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button variant="danger" onClick={deleteQuestion}>Delete question</Button>
      </div>
    </article>
  )
}

export function StarterCode({ question, lang, setLang, onRemove }) {
  const version = question.language_versions.find((v) => v.language === lang)
  if (question.language_versions.length === 0) {
    return <p className="text-sm text-zinc-500">No starter code saved. Save a language from the extension.</p>
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {question.language_versions.map((v) => (
          <Tag key={v.language} active={v.language === lang} onClick={() => setLang(v.language)}>
            {v.language_name}
          </Tag>
        ))}
      </div>
      {version && (
        <>
          <CodeBlock code={version.starter_code} language={version.language}
            actions={
              <button type="button" className="text-zinc-500 hover:text-rose-600" onClick={() => onRemove(version)}>
                Remove
              </button>
            } />
          <p className="mt-1 text-xs text-zinc-500">Saved {formatDate(version.saved_at, true)}</p>
        </>
      )}
    </>
  )
}

export function Notes({ question, onSaved, bare }) {
  const [notes, setNotes] = useState(question.personal_notes)
  const [state, setState] = useState({ status: 'idle' })
  const dirty = notes !== question.personal_notes
  useUnsaved(dirty)

  useEffect(() => setNotes(question.personal_notes), [question.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setState({ status: 'saving' })
    try {
      await updateNotes(question.id, notes)
      onSaved(notes)
      setState({ status: 'saved' })
    } catch (err) {
      setState({ status: 'error', error: err })
    }
  }

  return (
    <Section title={bare ? null : 'My notes'}
      right={<span className="text-xs text-zinc-500">{state.status === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>}>
      <textarea className={`${inputClass} min-h-28 font-mono text-[13px]`} value={notes}
        placeholder="Observations, patterns, edge cases…" onChange={(e) => setNotes(e.target.value)} />
      <ErrorBox error={state.error} onRetry={save} />
      <div className="mt-2">
        <Button variant="primary" disabled={!dirty || state.status === 'saving'} onClick={save}>
          {state.status === 'saving' ? 'Saving…' : 'Save notes'}
        </Button>
      </div>
    </Section>
  )
}

export function Solutions({ question, reload, bare }) {
  const [editing, setEditing] = useState(null) // null | 'new' | solution id
  const languages = question.language_versions

  return (
    <Section title={bare ? null : 'My solutions'}
      right={editing !== 'new' && <Button onClick={() => setEditing('new')}>Add solution</Button>}>
      {editing === 'new' && (
        <SolutionForm questionId={question.id} languages={languages}
          initial={{ language: languages[0]?.language || '', solution_code: '', notes: '' }}
          onDone={() => { setEditing(null); reload() }} onCancel={() => setEditing(null)} />
      )}
      {question.solutions.length === 0 && editing !== 'new' && (
        <p className="text-sm text-zinc-500">No solutions yet.</p>
      )}
      <div className="space-y-5">
        {question.solutions.map((s) =>
          editing === s.id ? (
            <SolutionForm key={s.id} questionId={question.id} languages={languages} initial={s}
              onDone={() => { setEditing(null); reload() }} onCancel={() => setEditing(null)} />
          ) : (
            <SolutionView key={s.id} questionId={question.id} solution={s} onEdit={() => setEditing(s.id)} reload={reload} />
          ),
        )}
      </div>
    </Section>
  )
}

function SolutionView({ questionId, solution, onEdit, reload }) {
  const [error, setError] = useState(null)
  const remove = async () => {
    if (!window.confirm('Delete this solution?')) return
    try {
      await deleteSolution(solution.id)
      reload()
    } catch (err) {
      setError(err)
    }
  }
  return (
    <div>
      {solution.solution_code && (
        <CodeBlock code={solution.solution_code} language={solution.language || 'text'}
          actions={<>
            <button type="button" className="text-zinc-500 hover:underline" onClick={onEdit}>Edit</button>
            <button type="button" className="text-zinc-500 hover:text-rose-600" onClick={remove}>Delete</button>
          </>} />
      )}
      {solution.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{solution.notes}</p>}
      <div className="mt-1 flex gap-3 text-xs text-zinc-500">
        <span>Updated {formatDate(solution.updated_at, true)}</span>
        {!solution.solution_code && <>
          <button type="button" className="hover:underline" onClick={onEdit}>Edit</button>
          <button type="button" className="hover:text-rose-600" onClick={remove}>Delete</button>
        </>}
      </div>
      <ErrorBox error={error} />
    </div>
  )
}

function SolutionForm({ questionId, languages, initial, onDone, onCancel }) {
  const [form, setForm] = useState({ language: initial.language, solution_code: initial.solution_code, notes: initial.notes })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  useUnsaved(['language', 'solution_code', 'notes'].some((k) => form[k] !== initial[k]))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (initial.id) await updateSolution(initial.id, form)
      else await createSolution(questionId, form)
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <select className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        value={form.language} onChange={set('language')}>
        <option value="">No language</option>
        {languages.map((l) => <option key={l.language} value={l.language}>{l.language_name}</option>)}
        {form.language && !languages.some((l) => l.language === form.language) && (
          <option value={form.language}>{form.language}</option>
        )}
      </select>
      <textarea className={`${inputClass} min-h-48 font-mono text-[13px]`} spellCheck={false}
        placeholder="Solution code" value={form.solution_code} onChange={set('solution_code')}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.target
            const { selectionStart: s, selectionEnd: end } = el
            const value = form.solution_code.slice(0, s) + '    ' + form.solution_code.slice(end)
            setForm({ ...form, solution_code: value })
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4 })
          }
        }} />
      <textarea className={`${inputClass} min-h-20 text-sm`} placeholder="Approach, complexity, observations"
        value={form.notes} onChange={set('notes')} />
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save solution'}</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}
