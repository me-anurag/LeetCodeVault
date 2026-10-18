// Tests the extension's extractor against real LeetCode GraphQL responses (see fetch_fixtures.py).
// Run: npm test   (from tests/extension)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const X = require('../../extension/extractor.js')

const { DOMParser } = new JSDOM('').window
const FIXTURES = path.join(__dirname, 'fixtures')
const load = (slug) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.json`), 'utf8')).data.question
const ORIGIN = 'https://leetcode.com'
const parse = (slug) => X.fromGraphql(load(slug), { origin: ORIGIN, DOMParserImpl: DOMParser })

const WITH_CONTENT = fs
  .readdirSync(FIXTURES)
  .map((f) => f.replace(/\.json$/, ''))
  .filter((slug) => load(slug).content)

test('fixtures cover all difficulties', () => {
  const diffs = new Set(WITH_CONTENT.map((s) => load(s).difficulty))
  assert.deepEqual([...diffs].sort(), ['Easy', 'Hard', 'Medium'])
})

for (const slug of WITH_CONTENT) {
  test(`${slug}: captures original data verbatim`, () => {
    const raw = load(slug)
    const q = parse(slug)
    assert.equal(q.title, raw.title)
    assert.equal(q.slug, raw.titleSlug)
    assert.equal(q.frontend_id, raw.questionFrontendId)
    assert.equal(q.difficulty, raw.difficulty)
    assert.equal(q.leetcode_url, `https://leetcode.com/problems/${slug}/`)
    assert.equal(q.description, raw.content, 'statement HTML must be stored unmodified')
    assert.deepEqual(q.topics, raw.topicTags.map((t) => ({ name: t.name, slug: t.slug })))
    assert.deepEqual(X.missingFields(q), [])

    // Every language's starter code is the exact LeetCode template.
    for (const s of raw.codeSnippets) {
      const payload = X.buildSavePayload(q, s.langSlug, '2026-01-01T00:00:00.000Z')
      assert.equal(payload.starter_code, s.code)
      assert.equal(payload.language, s.langSlug)
      assert.equal(payload.language_name, s.lang)
    }

    const exampleCount = (raw.content.match(/Example\s*\d+\s*:/g) || []).length
    assert.equal(q.examples.length, exampleCount, 'one parsed example per "Example N:" label')
    for (const ex of q.examples) {
      assert.match(ex.title, /^Example \d+$/)
      assert.match(ex.text, /Input/)
      assert.match(ex.text, /Output/)
    }
    if (raw.content.includes('Constraints')) assert.ok(q.constraints.length > 0, 'constraints parsed')
    assert.ok(!/<[a-z]/i.test(q.description_text), 'plain text has no tags')
  })
}

test('two-sum: exact examples and constraints, superscripts preserved', () => {
  const q = parse('two-sum')
  assert.deepEqual(q.constraints, [
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    '-10^9 <= target <= 10^9',
    'Only one valid answer exists.',
  ])
  assert.equal(
    q.examples[0].text,
    'Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]\nExplanation: Because nums[0] + nums[1] == 9, we return [0, 1].',
  )
  assert.equal(q.examples[2].text, 'Input: nums = [3,3], target = 6\nOutput: [0,1]')
  assert.match(q.description_text, /Follow-up/)
  const py = X.buildSavePayload(q, 'python3')
  assert.equal(py.starter_code, 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        ')
})

test('add-two-numbers: example images are kept with the example', () => {
  const q = parse('add-two-numbers')
  assert.match(q.examples[0].text, /^\[image: https:\/\/assets\.leetcode\.com\/uploads\/.+addtwonumber1\.jpg\]\nInput: l1 = \[2,4,3\]/)
  assert.equal(q.constraints.length, 3)
})

test('newer example-block markup is parsed', () => {
  const q = parse('maximum-difference-between-even-and-odd-frequency-i')
  assert.equal(q.examples.length, 2)
  assert.match(q.examples[0].text, /^Input: s = "aaaaabbc"\nOutput: 3\nExplanation:\n- The character 'a' has an odd frequency/)
  assert.deepEqual(q.constraints[0], '3 <= s.length <= 100')
  assert.match(q.description_text, /freq\(a_1\) - freq\(a_2\)/) // subscripts
})

test('design problem keeps class starter code', () => {
  const q = parse('lru-cache')
  const java = X.buildSavePayload(q, 'java')
  assert.match(java.starter_code, /class LRUCache \{/)
  assert.match(java.starter_code, /public int get\(int key\)/)
})

test('database problem exposes SQL dialects', () => {
  const q = parse('combine-two-tables')
  assert.deepEqual(q.snippets.map((s) => s.langSlug).sort(), load('combine-two-tables').codeSnippets.map((s) => s.langSlug).sort())
  assert.ok(q.snippets.some((s) => s.langSlug === 'mysql'))
})

test('premium problem without access is reported, not faked', () => {
  assert.throws(() => parse('meeting-rooms'), (err) => err.code === 'premium' && /premium/i.test(err.message))
})

test('unknown language has no starter code -> explicit error', () => {
  assert.throws(() => X.buildSavePayload(parse('two-sum'), 'cobol'), (err) => err.code === 'no_starter_code')
})

test('slugFromPath handles LeetCode URL variants', () => {
  assert.equal(X.slugFromPath('/problems/two-sum/'), 'two-sum')
  assert.equal(X.slugFromPath('/problems/two-sum/description/'), 'two-sum')
  assert.equal(X.slugFromPath('/problems/two-sum/submissions/123/'), 'two-sum')
  assert.equal(X.slugFromPath('/problems/two-sum'), 'two-sum')
  assert.equal(X.slugFromPath('/problemset/'), null)
  assert.equal(X.slugFromPath('/contest/weekly-contest-1/'), null)
})

// --- language detection -------------------------------------------------------------------------------------------

function storage(values) {
  return { getItem: (k) => (k in values ? values[k] : null) }
}

test('language: editor picker button wins', () => {
  const { document } = new JSDOM('<div id="editor"><button>Python3<svg></svg></button></div>').window
  const lang = X.detectLanguage(parse('two-sum').snippets, { doc: document, storage: storage({ global_lang: '"java"' }) })
  assert.deepEqual(lang, { slug: 'python3', name: 'Python3', source: 'editor' })
})

test('language: C++ name with symbols matched exactly', () => {
  const { document } = new JSDOM('<button> C++ </button><button>Run</button><button>Submit</button>').window
  assert.equal(X.detectLanguage(parse('two-sum').snippets, { doc: document }).slug, 'cpp')
})

test('language: open dropdown (many names) is ambiguous -> stored preference', () => {
  const names = parse('two-sum').snippets.map((s) => `<div role="button">${s.lang}</div>`).join('')
  const { document } = new JSDOM(`<button>Java</button>${names}`).window
  const lang = X.detectLanguage(parse('two-sum').snippets, { doc: document, storage: storage({ global_lang: '"golang"' }) })
  assert.deepEqual(lang, { slug: 'golang', name: 'Go', source: 'preference' })
})

test('language: unquoted stored value and missing data', () => {
  const { document } = new JSDOM('<p>nothing</p>').window
  const snippets = parse('two-sum').snippets
  assert.equal(X.detectLanguage(snippets, { doc: document, storage: storage({ global_lang: 'rust' }) }).slug, 'rust')
  assert.equal(X.detectLanguage(snippets, { doc: document, storage: storage({}) }), null)
  assert.equal(X.detectLanguage(snippets, { doc: document, storage: storage({ global_lang: '"brainfuck"' }) }), null)
})

// --- page-level flow ----------------------------------------------------------------------------------------------

function page(url, html = '') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url })
  dom.window.document.cookie = 'csrftoken=abc123'
  return dom.window
}

test('extractFromPage: GraphQL path, csrf header, detected language', async () => {
  const win = page('https://leetcode.com/problems/two-sum/description/', '<button>Java</button>')
  const calls = []
  win.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ data: { question: load('two-sum') } }) }
  }
  const res = await X.extractFromPage({ win, waitMs: 0 })
  assert.equal(calls[0].url, 'https://leetcode.com/graphql/')
  assert.equal(calls[0].init.headers['x-csrftoken'], 'abc123')
  assert.deepEqual(JSON.parse(calls[0].init.body).variables, { titleSlug: 'two-sum' })
  assert.equal(res.question.title, 'Two Sum')
  assert.deepEqual(res.language, { slug: 'java', name: 'Java', source: 'editor' })
  assert.deepEqual(res.missing, [])
  assert.equal(res.warning, null)
})

test('extractFromPage: GraphQL down -> DOM statement, starter code flagged missing', async () => {
  const raw = load('two-sum')
  const win = page(
    'https://leetcode.com/problems/two-sum/',
    `<a href="/problems/two-sum/">1. Two Sum</a><div class="text-difficulty-easy">Easy</div>
     <a href="/tag/array/">Array</a><a href="/tag/hash-table/">Hash Table</a>
     <div data-track-load="description_content">${raw.content}</div>`,
  )
  win.fetch = async () => { throw new TypeError('Failed to fetch') }
  const res = await X.extractFromPage({ win, waitMs: 0 })
  assert.equal(res.question.source, 'dom')
  assert.equal(res.question.title, 'Two Sum')
  assert.equal(res.question.frontend_id, '1')
  assert.equal(res.question.difficulty, 'Easy')
  assert.deepEqual(res.question.topics.map((t) => t.slug), ['array', 'hash-table'])
  assert.equal(res.question.examples.length, 3)
  assert.deepEqual(res.missing, ['starter code'])
  assert.match(res.warning, /starter code is unavailable/)
})

test('extractFromPage: non-problem page', async () => {
  const win = page('https://leetcode.com/problemset/')
  await assert.rejects(X.extractFromPage({ win, waitMs: 0 }), (err) => err.code === 'not_problem')
})
