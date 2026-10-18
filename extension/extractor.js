/*
 * LeetVault extractor. Loaded as a content script on leetcode.com and by the Node test suite.
 *
 * Primary source: LeetCode's own GraphQL endpoint (the same request the problem page makes), fetched
 * same-origin with the user's session. It returns the original statement HTML, tags, and the untouched
 * starter template for every language. The rendered DOM is only used to detect the selected editor
 * language and as a fallback for the statement when GraphQL is unreachable.
 */
;(function (root) {
  'use strict'

  const QUERY = `query leetvaultQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug difficulty isPaidOnly content
    topicTags { name slug }
    codeSnippets { lang langSlug code }
  }
}`

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'PRE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'BLOCKQUOTE', 'SECTION',
  ])

  class ExtractionError extends Error {
    constructor(code, message, details) {
      super(message)
      this.code = code
      this.details = details || {}
    }
  }

  function slugFromPath(pathname) {
    const m = /^\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname || '')
    return m ? m[1] : null
  }

  function readCookie(doc, name) {
    const m = (doc && doc.cookie ? doc.cookie : '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
    return m ? decodeURIComponent(m[1]) : ''
  }

  async function fetchQuestion(slug, { fetchImpl, origin, doc } = {}) {
    const f = fetchImpl || root.fetch.bind(root)
    const headers = { 'Content-Type': 'application/json' }
    const csrf = readCookie(doc, 'csrftoken')
    if (csrf) headers['x-csrftoken'] = csrf
    let res
    try {
      res = await f((origin || '') + '/graphql/', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ operationName: 'leetvaultQuestion', query: QUERY, variables: { titleSlug: slug } }),
      })
    } catch (err) {
      throw new ExtractionError('graphql_network', 'Could not reach LeetCode to read the problem data.')
    }
    if (!res.ok) throw new ExtractionError('graphql_http', `LeetCode returned HTTP ${res.status} for the problem data.`)
    const data = await res.json()
    const q = data && data.data && data.data.question
    if (!q) throw new ExtractionError('not_found', 'LeetCode did not return this problem.')
    return q
  }

  // --- HTML -> text ---------------------------------------------------------------------------------------------

  function nodeToText(node) {
    let out = ''
    const walk = (n, inPre) => {
      if (n.nodeType === 3) {
        out += inPre ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ')
        return
      }
      if (n.nodeType !== 1) return
      const tag = n.tagName
      if (tag === 'BR') return void (out += '\n')
      if (tag === 'IMG') {
        const src = n.getAttribute('src')
        return void (out += src ? `\n[image: ${src}]\n` : '')
      }
      if (tag === 'SCRIPT' || tag === 'STYLE') return
      const block = BLOCK_TAGS.has(tag)
      if (block) out += '\n'
      if (tag === 'LI') out += '- '
      if (tag === 'SUP') out += '^'
      if (tag === 'SUB') out += '_'
      const pre = inPre || tag === 'PRE'
      for (const child of n.childNodes) walk(child, pre)
      if (block) out += '\n'
    }
    walk(node, false)
    return out
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, '').replace(/^ (?=\S)/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function parseHtml(html, DOMParserImpl) {
    const P = DOMParserImpl || root.DOMParser
    return new P().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body
  }

  const isExampleLabel = (el) => /^example\s*\d*\s*:?$/i.test(el.textContent.replace(/\u00a0/g, ' ').trim())
  const isConstraintsLabel = (el) => /^constraints\s*:?$/i.test(el.textContent.replace(/\u00a0/g, ' ').trim())

  // The block-level element that "owns" a label like <p><strong>Example 1:</strong></p>.
  function labelAnchor(strong, body) {
    let el = strong
    while (el.parentElement && el.parentElement !== body && el.parentElement.textContent.trim() === strong.textContent.trim()) {
      el = el.parentElement
    }
    return el
  }

  function isBlank(el) {
    return el.tagName !== 'IMG' && !el.textContent.replace(/\u00a0/g, ' ').trim() && !el.querySelector('img')
  }

  function parseContent(html, DOMParserImpl) {
    const body = parseHtml(html, DOMParserImpl)
    const labels = Array.from(body.querySelectorAll('strong, b'))
    const exampleAnchors = labels.filter(isExampleLabel).map((s) => labelAnchor(s, body))
    const constraintsAnchor = labels.filter(isConstraintsLabel).map((s) => labelAnchor(s, body))[0] || null
    const stops = new Set([...exampleAnchors, constraintsAnchor].filter(Boolean))

    const examples = exampleAnchors.map((anchor, i) => {
      const parts = []
      for (let el = anchor.nextElementSibling; el && !stops.has(el); el = el.nextElementSibling) {
        if (isBlank(el)) {
          if (parts.length) break
          continue
        }
        if (el.querySelector && Array.from(el.querySelectorAll('strong, b')).some(isConstraintsLabel)) break
        if (/^(follow[- ]?up|note)\b/i.test(el.textContent.trim())) break
        parts.push(nodeToText(el))
      }
      const title = anchor.textContent.replace(/\u00a0/g, ' ').trim().replace(/:$/, '') || `Example ${i + 1}`
      return { title, text: parts.join('\n').replace(/\n{2,}/g, '\n').trim() }
    }).filter((e) => e.text)

    const constraints = []
    if (constraintsAnchor) {
      for (let el = constraintsAnchor.nextElementSibling; el; el = el.nextElementSibling) {
        if (el.tagName === 'UL' || el.tagName === 'OL') {
          for (const li of el.children) if (li.tagName === 'LI') constraints.push(nodeToText(li).replace(/^- /, ''))
          break
        }
        if (!isBlank(el)) break
      }
    }

    return { examples, constraints, text: nodeToText(body) }
  }

  // --- language detection ---------------------------------------------------------------------------------------

  function ownText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim()
  }

  // The editor's language picker is a button whose label equals one of LeetCode's language names
  // ("Python3", "C++", ...). If exactly one language name is shown, that is the selected language.
  function languageFromDom(doc, snippets) {
    const byName = new Map(snippets.map((s) => [s.lang, s]))
    const found = new Set()
    for (const el of doc.querySelectorAll('button, [role="button"], [aria-haspopup]')) {
      const text = ownText(el)
      if (byName.has(text)) found.add(text)
    }
    return found.size === 1 ? byName.get([...found][0]) : null
  }

  function languageFromStorage(storage, snippets) {
    if (!storage) return null
    let raw = null
    try {
      raw = storage.getItem('global_lang')
    } catch (_) {
      return null
    }
    if (!raw) return null
    try {
      raw = JSON.parse(raw)
    } catch (_) {
      /* stored unquoted */
    }
    return snippets.find((s) => s.langSlug === raw) || null
  }

  function detectLanguage(snippets, { doc, storage } = {}) {
    const fromDom = doc ? languageFromDom(doc, snippets) : null
    if (fromDom) return { slug: fromDom.langSlug, name: fromDom.lang, source: 'editor' }
    const fromStorage = languageFromStorage(storage, snippets)
    if (fromStorage) return { slug: fromStorage.langSlug, name: fromStorage.lang, source: 'preference' }
    return null
  }

  // --- assembling the payload -----------------------------------------------------------------------------------

  function canonicalUrl(origin, slug) {
    return `${origin.replace(/\/$/, '')}/problems/${slug}/`
  }

  function fromGraphql(q, { origin, DOMParserImpl }) {
    if (!q.content) {
      throw new ExtractionError(
        q.isPaidOnly ? 'premium' : 'no_content',
        q.isPaidOnly
          ? 'This is a premium problem and its statement is not available to your LeetCode account.'
          : 'LeetCode returned no statement for this problem.',
      )
    }
    const parsed = parseContent(q.content, DOMParserImpl)
    return {
      source: 'graphql',
      title: q.title,
      slug: q.titleSlug,
      frontend_id: q.questionFrontendId || null,
      leetcode_url: canonicalUrl(origin, q.titleSlug),
      description: q.content,
      description_text: parsed.text,
      difficulty: q.difficulty,
      topics: (q.topicTags || []).map((t) => ({ name: t.name, slug: t.slug })),
      examples: parsed.examples,
      constraints: parsed.constraints,
      snippets: (q.codeSnippets || []).map((s) => ({ lang: s.lang, langSlug: s.langSlug, code: s.code })),
    }
  }

  // Fallback when GraphQL is unavailable: read the rendered page. Starter code is NOT taken from the editor,
  // because the visible editor may contain the user's own edits rather than LeetCode's original template.
  function fromDom(doc, slug, origin, DOMParserImpl) {
    const descEl =
      doc.querySelector('[data-track-load="description_content"]') ||
      doc.querySelector('[class*="question-content"]') ||
      doc.querySelector('meta[name="description"]')
    const titleLink = doc.querySelector(`a[href^="/problems/${slug}"]`)
    let title = titleLink ? ownText(titleLink) : (doc.title || '').replace(/\s*-\s*LeetCode.*$/i, '')
    let frontendId = null
    const m = /^(\d+)\.\s+(.*)$/.exec(title)
    if (m) [, frontendId, title] = m
    const diffEl = doc.querySelector('[class*="text-difficulty-"]')
    const difficulty = diffEl ? ownText(diffEl) : ''
    const topics = Array.from(doc.querySelectorAll('a[href^="/tag/"]')).map((a) => ({
      name: ownText(a),
      slug: (a.getAttribute('href').split('/')[2] || '').trim(),
    }))
    const html = descEl ? (descEl.tagName === 'META' ? '' : descEl.innerHTML) : ''
    const parsed = html ? parseContent(html, DOMParserImpl) : { examples: [], constraints: [], text: '' }
    return {
      source: 'dom',
      title,
      slug,
      frontend_id: frontendId,
      leetcode_url: canonicalUrl(origin, slug),
      description: html,
      description_text: parsed.text,
      difficulty,
      topics: topics.filter((t) => t.name && t.slug),
      examples: parsed.examples,
      constraints: parsed.constraints,
      snippets: [],
    }
  }

  function missingFields(q) {
    const missing = []
    if (!q.title) missing.push('title')
    if (!q.description || !q.description_text) missing.push('description')
    if (!['Easy', 'Medium', 'Hard'].includes(q.difficulty)) missing.push('difficulty')
    if (!q.snippets.length) missing.push('starter code')
    return missing
  }

  // Build the POST /api/questions body for one language. Throws if that language has no template.
  function buildSavePayload(q, langSlug, savedAt) {
    const snippet = q.snippets.find((s) => s.langSlug === langSlug)
    if (!snippet || !snippet.code || !snippet.code.trim()) {
      throw new ExtractionError('no_starter_code', `No starter code is available for ${langSlug}.`)
    }
    return {
      title: q.title,
      slug: q.slug,
      frontend_id: q.frontend_id,
      leetcode_url: q.leetcode_url,
      description: q.description,
      description_text: q.description_text,
      difficulty: q.difficulty,
      topics: q.topics,
      examples: q.examples,
      constraints: q.constraints,
      language: snippet.langSlug,
      language_name: snippet.lang,
      starter_code: snippet.code,
      saved_at: savedAt || new Date().toISOString(),
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Full extraction on a live problem page.
  async function extractFromPage({ win = root, waitMs = 4000 } = {}) {
    const doc = win.document
    const origin = win.location.origin
    const slug = slugFromPath(win.location.pathname)
    if (!slug) throw new ExtractionError('not_problem', 'This is not a LeetCode problem page.')

    let question
    let graphqlError = null
    try {
      const raw = await fetchQuestion(slug, { origin, doc, fetchImpl: win.fetch.bind(win) })
      question = fromGraphql(raw, { origin, DOMParserImpl: win.DOMParser })
    } catch (err) {
      if (err.code === 'premium' || err.code === 'no_content') throw err
      graphqlError = err
      // Wait for the SPA to render the statement before reading it.
      const deadline = Date.now() + waitMs
      while (Date.now() < deadline && !doc.querySelector('[data-track-load="description_content"]')) await sleep(250)
      question = fromDom(doc, slug, origin, win.DOMParser)
    }

    // The editor's language picker renders after the statement; give it a moment.
    let language = null
    const deadline = Date.now() + Math.min(waitMs, 2500)
    for (;;) {
      language = detectLanguage(question.snippets, { doc, storage: win.localStorage })
      if ((language && language.source === 'editor') || Date.now() >= deadline || !question.snippets.length) break
      await sleep(250)
    }

    return {
      question,
      language,
      missing: missingFields(question),
      warning: graphqlError
        ? `${graphqlError.message} Read the statement from the page instead; starter code is unavailable.`
        : null,
    }
  }

  const api = {
    QUERY,
    ExtractionError,
    slugFromPath,
    fetchQuestion,
    nodeToText,
    parseContent,
    detectLanguage,
    fromGraphql,
    fromDom,
    missingFields,
    buildSavePayload,
    extractFromPage,
  }
  root.LeetVaultExtractor = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
