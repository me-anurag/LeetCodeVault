import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { DifficultyPill, ErrorBox, Tag, formatDate } from '../components/ui'
import { Notes, Solutions, StarterCode } from '../pages/QuestionDetail'
import { MenuItem, Sheet, TopBar, useSheet } from './Sheet'
import { splitStatement } from './statement'
import WarDone from '../war/WarDone'

// Phone reader: only the question on screen (number, statement, example input/output, constraints).
// Explanations and follow-ups collapse; everything else lives in the menu.
export default function PhoneQuestion({
  question: q, statementHtml, error, reload, lang, setLang, onRemoveLanguage, onDelete, onNotesSaved,
}) {
  const sheet = useSheet()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const parts = useMemo(() => splitStatement(statementHtml), [statementHtml])

  return (
    <div className="reader mx-auto max-w-xl px-5 pb-[max(4rem,env(safe-area-inset-bottom))]">
      <TopBar onMenu={() => sheet.show('menu')} />

      <article className="pt-5">
        <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-orange-600">
          Question{q.frontend_id ? ` ${q.frontend_id}` : ''}
          <DifficultyPill value={q.difficulty} />
        </p>
        <h1 className="mt-1.5 text-[24px] font-semibold leading-snug tracking-tight">{q.title}</h1>
        <ErrorBox error={error} />

        {parts.intro && <Html className="statement mt-5" html={parts.intro} />}
        {parts.examples.map((ex, i) => <Example key={i} example={ex} />)}
        {parts.constraints && (
          <Block title="Constraints" tone="text-orange-600">
            <Html className="statement" html={parts.constraints} />
          </Block>
        )}
        {parts.extra && (
          <div className="mt-8">
            <Collapse title={parts.extraTitle}>
              <Html className="statement" html={parts.extra} />
            </Collapse>
          </div>
        )}
        <WarDone key={q.id} question={q} />
      </article>

      {sheet.open === 'menu' && (
        <Sheet title="Menu" onClose={sheet.close}>
          <div className="mb-4">
            <p className="text-[15px] font-medium">{q.frontend_id ? `${q.frontend_id}. ` : ''}{q.title}</p>
            {q.topics.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.topics.map((t) => (
                  <Link key={t.slug} to={`/library?topic=${t.slug}`} replace><Tag>{t.name}</Tag></Link>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted">Saved {formatDate(q.saved_at, true)}</p>
          </div>
          <MenuItem onClick={() => navigate('/', { replace: true })}>Today's war</MenuItem>
          <MenuItem onClick={() => navigate('/library', { replace: true })}>Library</MenuItem>
          <MenuItem hint={q.language_versions.map((v) => v.language_name).join(', ')} onClick={() => sheet.show('code')}>
            Starter code
          </MenuItem>
          <MenuItem hint={q.personal_notes.trim() ? 'Written' : ''} onClick={() => sheet.show('notes')}>My notes</MenuItem>
          <MenuItem hint={q.solutions.length || ''} onClick={() => sheet.show('solutions')}>My solutions</MenuItem>
          <MenuItem href={q.leetcode_url} hint="↗">Open on LeetCode</MenuItem>
          <MenuItem tone="danger" onClick={onDelete}>Delete question</MenuItem>
          <MenuItem tone="muted" hint={user?.email} onClick={logout}>Log out</MenuItem>
        </Sheet>
      )}
      {sheet.open === 'code' && (
        <Sheet title="Starter code" onClose={sheet.close}>
          <StarterCode question={q} lang={lang} setLang={setLang} onRemove={onRemoveLanguage} />
        </Sheet>
      )}
      {sheet.open === 'notes' && (
        <Sheet title="My notes" onClose={sheet.close}>
          <Notes question={q} onSaved={onNotesSaved} bare />
        </Sheet>
      )}
      {sheet.open === 'solutions' && (
        <Sheet title="My solutions" onClose={sheet.close}>
          <Solutions question={q} reload={reload} bare />
        </Sheet>
      )}
    </div>
  )
}

// Content comes from the statement already sanitized by DOMPurify (see QuestionDetail).
const Html = ({ html, className }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />

function Block({ title, tone = 'text-violet-600', children }) {
  return (
    <section className="mt-8">
      <h2 className={`mb-2.5 text-[13px] font-bold uppercase tracking-[0.08em] ${tone}`}>{title}</h2>
      {children}
    </section>
  )
}

function Collapse({ title, children }) {
  return (
    <details className="rounded-xl border border-violet-200 bg-violet-50/60">
      <summary className="flex items-center gap-2 px-3.5 py-2.5 text-[15px] font-medium text-violet-700">
        <span className="chevron" aria-hidden>›</span>
        {title}
      </summary>
      <div className="px-3.5 pb-3">{children}</div>
    </details>
  )
}

function Field({ label, html, kind }) {
  if (!html) return null
  const color = kind === 'input' ? 'text-sky-700' : 'text-emerald-700'
  return (
    <div className="mb-2.5">
      <p className={`mb-1 text-[13px] font-medium ${color}`}>{label}</p>
      <Html className={`io ${kind} whitespace-pre-wrap`} html={html} />
    </div>
  )
}

function Example({ example }) {
  if (example.raw) {
    return (
      <Block title={example.title}>
        <Html className="statement" html={example.raw} />
      </Block>
    )
  }
  return (
    <Block title={example.title}>
      {example.figure && <Html className="statement mb-3" html={example.figure} />}
      <Field label="Input" html={example.input} kind="input" />
      <Field label="Output" html={example.output} kind="output" />
      {example.explanation && (
        <div className="mt-3">
          <Collapse title="Explanation">
            <Html className={example.pre ? 'io whitespace-pre-wrap' : 'statement'} html={example.explanation} />
          </Collapse>
        </div>
      )}
    </Block>
  )
}
