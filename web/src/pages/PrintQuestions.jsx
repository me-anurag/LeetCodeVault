import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { getQuestionsByIds } from '../api'
import { ErrorBox, Loading } from '../components/ui'
import { splitStatement } from '../phone/statement'

// Printable document of one or more questions; the browser's print dialog saves it as a PDF.
// URL: /print?ids=12,15,18&title=War%20of%20Mon%2026%20Oct
export default function PrintQuestions() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const idsParam = params.get('ids') || ''
  const ids = useMemo(() => idsParam.split(',').map(Number).filter(Boolean), [idsParam])
  const title = params.get('title')
  const [questions, setQuestions] = useState(null)
  const [error, setError] = useState(null)
  const printed = useRef(false)

  useEffect(() => {
    getQuestionsByIds(ids).then(setQuestions).catch(setError)
  }, [ids])

  // The page title becomes the PDF's file name.
  useEffect(() => {
    if (!questions?.length) return
    const previous = document.title
    document.title = fileName(questions, title)
    return () => { document.title = previous }
  }, [questions, title])

  // Wait for statement images, then open the print dialog once.
  useEffect(() => {
    if (!questions?.length || printed.current) return
    printed.current = true
    const images = [...document.querySelectorAll('.doc img')].map((img) =>
      img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }))
    Promise.race([Promise.all(images), new Promise((r) => setTimeout(r, 8000))]).then(() => window.print())
  }, [questions])

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="h-12 text-[15px] text-ink-soft">‹ Back</button>
        <span className="hidden truncate text-sm text-muted sm:inline">In the print window, choose “Save as PDF”.</span>
        <button type="button" disabled={!questions?.length} onClick={() => window.print()}
          className="btn-sun my-2 rounded-xl px-4 py-2 text-[15px] font-semibold disabled:opacity-40">
          Save as PDF
        </button>
      </div>

      <div className="doc mx-auto max-w-[800px] px-6 py-8">
        {error ? <ErrorBox error={error} /> : !questions ? <Loading label="Preparing document…" /> : (
          <>
            {(title || questions.length > 1) && (
              <header className="doc-cover">
                <p className="doc-brand">DailyWars</p>
                <h1>{title || `${questions.length} questions`}</h1>
                <p className="doc-meta">
                  {questions.length} question{questions.length === 1 ? '' : 's'} · saved {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <ol className="doc-toc">
                  {questions.map((q) => (
                    <li key={q.id}>{q.frontend_id ? `${q.frontend_id}. ` : ''}{q.title} <span>· {q.difficulty}</span></li>
                  ))}
                </ol>
              </header>
            )}
            {questions.map((q) => <QuestionDoc key={q.id} q={q} />)}
          </>
        )}
      </div>
    </div>
  )
}

function fileName(questions, title) {
  const base = title || (questions.length === 1
    ? `${questions[0].frontend_id ? `${questions[0].frontend_id}. ` : ''}${questions[0].title}`
    : `${questions.length} questions`)
  return `DailyWars - ${base}`.replace(/[\\/:*?"<>|]/g, '-')
}

const Html = ({ html, className }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />

function QuestionDoc({ q }) {
  const parts = useMemo(
    () => splitStatement(DOMPurify.sanitize(q.description, { USE_PROFILES: { html: true } })),
    [q.description],
  )
  return (
    <article className="doc-question">
      <h2>{q.frontend_id ? `${q.frontend_id}. ` : ''}{q.title}</h2>
      <p className="doc-meta">
        <span className={`doc-diff ${q.difficulty}`}>{q.difficulty}</span>
        {q.topics.length > 0 && <> · {q.topics.map((t) => t.name).join(', ')}</>}
        <br />
        <span className="doc-link">{q.leetcode_url}</span>
      </p>

      {parts.intro && <Html className="statement" html={parts.intro} />}

      {parts.examples.map((ex, i) => (
        <section key={i} className="doc-example">
          <h3>{ex.title}</h3>
          {ex.raw ? <Html className="statement" html={ex.raw} /> : (
            <>
              {ex.figure && <Html className="statement" html={ex.figure} />}
              {ex.input && <Field label="Input" html={ex.input} />}
              {ex.output && <Field label="Output" html={ex.output} kind="output" />}
              {ex.explanation && (
                <div className="doc-field">
                  <span>Explanation</span>
                  <Html className={ex.pre ? 'doc-mono explanation' : 'statement'} html={ex.explanation} />
                </div>
              )}
            </>
          )}
        </section>
      ))}

      {parts.constraints && (
        <section>
          <h3>Constraints</h3>
          <Html className="statement" html={parts.constraints} />
        </section>
      )}
      {parts.extra && (
        <section>
          <h3>{parts.extraTitle}</h3>
          <Html className="statement" html={parts.extra} />
        </section>
      )}

      {q.language_versions.map((v) => (
        <section key={v.language} className="doc-code">
          <h3>Starter code · {v.language_name}</h3>
          <pre>{v.starter_code}</pre>
        </section>
      ))}
    </article>
  )
}

function Field({ label, html, kind = '' }) {
  return (
    <div className="doc-field">
      <span>{label}</span>
      <Html className={`doc-mono ${kind}`} html={html} />
    </div>
  )
}
