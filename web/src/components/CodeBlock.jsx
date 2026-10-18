import { useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import dart from 'highlight.js/lib/languages/dart'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import kotlin from 'highlight.js/lib/languages/kotlin'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import scheme from 'highlight.js/lib/languages/scheme'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'

Object.entries({
  c, cpp, csharp, dart, elixir, erlang, go, java, javascript, kotlin, php, python, ruby, rust, scala, scheme, sql,
  bash, swift, typescript,
}).forEach(([name, lang]) => hljs.registerLanguage(name, lang))

// LeetCode langSlug -> highlight.js language
const HLJS_LANG = {
  python: 'python', python3: 'python', java: 'java', cpp: 'cpp', c: 'c', csharp: 'csharp',
  javascript: 'javascript', typescript: 'typescript', php: 'php', swift: 'swift', kotlin: 'kotlin', dart: 'dart',
  golang: 'go', ruby: 'ruby', scala: 'scala', rust: 'rust', racket: 'scheme', erlang: 'erlang', elixir: 'elixir',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql', pythondata: 'python', bash: 'bash',
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for non-secure contexts (e.g. LAN IP over http on a phone).
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export default function CodeBlock({ code, language, actions }) {
  const [copied, setCopied] = useState(null)
  const html = useMemo(() => {
    const lang = HLJS_LANG[language]
    try {
      return lang ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : null
    } catch {
      return null
    }
  }, [code, language])

  const onCopy = async () => {
    setCopied((await copyText(code)) ? 'Copied' : 'Copy failed')
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-mono text-zinc-500">{language}</span>
        <div className="flex items-center gap-3">
          {actions}
          <button type="button" onClick={onCopy} className="font-medium hover:underline">
            {copied || 'Copy code'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-6">
        {html ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
      </pre>
    </div>
  )
}
