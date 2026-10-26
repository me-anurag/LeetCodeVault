// Database/API tests against a Supabase instance (local by default: `npm run db:start`).
// Exercises the same HTTP endpoints the extension and website use: Auth, PostgREST tables, RPC functions.
// Run: npm run test:db        Override target with SUPABASE_URL / SUPABASE_KEY.
import test from 'node:test'
import assert from 'node:assert/strict'

const URL_ = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const PASSWORD = 'correct-horse-battery'

async function call(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (prefer) headers.Prefer = prefer
  const res = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}

async function newUser() {
  const email = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await call('POST', '/auth/v1/signup', { body: { email, password: PASSWORD } })
  assert.equal(res.status, 200, JSON.stringify(res.data))
  return { email, token: res.data.access_token, id: res.data.user.id }
}

const rpc = (user, fn, args) => call('POST', `/rest/v1/rpc/${fn}`, { token: user && user.token, body: args })
const save = (user, payload) => rpc(user, 'save_question', { p: payload })
const list = async (user, args = {}) => {
  const res = await rpc(user, 'list_questions', args)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  return res.data
}
const titles = async (user, args) => (await list(user, args)).items.map((i) => i.title).sort()
const detail = async (user, id) =>
  (await call('GET', `/rest/v1/questions?id=eq.${id}&select=*,question_language_versions(*),personal_solutions(*)`, { token: user.token })).data[0]

function twoSum(over = {}) {
  return {
    title: 'Two Sum',
    slug: 'two-sum',
    frontend_id: '1',
    leetcode_url: 'https://leetcode.com/problems/two-sum/description/?envType=study',
    description: '<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>, return indices.</p>',
    description_text: 'Given an array of integers nums and an integer target, return indices.',
    difficulty: 'Easy',
    topics: [{ name: 'Array', slug: 'array' }, { name: 'Hash Table', slug: 'hash-table' }],
    examples: [{ title: 'Example 1', text: 'Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]' }],
    constraints: ['2 <= nums.length <= 10^4'],
    language: 'python3',
    language_name: 'Python3',
    starter_code: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        ',
    ...over,
  }
}
const median = (over = {}) => twoSum({
  title: 'Median of Two Sorted Arrays', slug: 'median-of-two-sorted-arrays', frontend_id: '4',
  leetcode_url: 'https://leetcode.com/problems/median-of-two-sorted-arrays/',
  description: '<p>Given two sorted arrays <code>nums1</code> and <code>nums2</code>, return the median.</p>',
  description_text: 'Given two sorted arrays nums1 and nums2, return the median.',
  difficulty: 'Hard', topics: [{ name: 'Array', slug: 'array' }, { name: 'Binary Search', slug: 'binary-search' }],
  language: 'cpp', language_name: 'C++', starter_code: 'class Solution {\npublic:\n};', ...over,
})
const palindrome = () => twoSum({
  title: 'Longest Palindromic Substring', slug: 'longest-palindromic-substring', frontend_id: '5',
  leetcode_url: 'https://leetcode.com/problems/longest-palindromic-substring/',
  description: '<p>Given a string <code>s</code>, return the longest palindromic substring.</p>',
  description_text: 'Given a string s, return the longest palindromic substring.',
  difficulty: 'Medium', topics: [{ name: 'String', slug: 'string' }, { name: 'Dynamic Programming', slug: 'dynamic-programming' }],
  language: 'java', language_name: 'Java', starter_code: 'class Solution {\n}',
})

// --- auth & access control ------------------------------------------------------------------------------------------

test('anonymous callers cannot read or write anything', async () => {
  assert.notEqual((await save(null, twoSum())).status, 200)
  assert.notEqual((await rpc(null, 'list_questions', {})).status, 200)
  assert.notEqual((await rpc(null, 'get_stats', {})).status, 200)
  const res = await call('GET', '/rest/v1/questions?select=id')
  assert.ok(res.status === 401 || (res.status === 200 && res.data.length === 0))
})

test('password login returns a session; bad password rejected', async () => {
  const u = await newUser()
  const ok = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: u.email, password: PASSWORD } })
  assert.equal(ok.status, 200)
  assert.ok(ok.data.access_token && ok.data.refresh_token)
  const refreshed = await call('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: ok.data.refresh_token } })
  assert.equal(refreshed.status, 200)
  const bad = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: u.email, password: 'nope-nope' } })
  assert.equal(bad.status, 400)
})

test('users only see their own data', async () => {
  const a = await newUser()
  const b = await newUser()
  const { data } = await save(a, twoSum())
  assert.equal((await call('GET', `/rest/v1/questions?id=eq.${data.question_id}`, { token: b.token })).data.length, 0)
  const del = await call('DELETE', `/rest/v1/questions?id=eq.${data.question_id}`, { token: b.token, prefer: 'return=representation' })
  assert.deepEqual(del.data, [])
  assert.equal((await list(b)).total, 0)
  assert.equal((await save(b, twoSum())).data.status, 'created') // same problem, independent copy
  assert.equal((await list(a)).total, 1)
  // b cannot attach a solution to a's question
  const sol = await call('POST', '/rest/v1/personal_solutions', { token: b.token, body: { question_id: data.question_id, solution_code: 'x' } })
  assert.notEqual(sol.status, 201)
})

// --- saving ----------------------------------------------------------------------------------------------------------

test('save stores the question verbatim and canonicalises the URL', async () => {
  const u = await newUser()
  const res = await save(u, twoSum())
  assert.equal(res.status, 200, JSON.stringify(res.data))
  assert.deepEqual(res.data, { status: 'created', question_id: res.data.question_id, language: 'python3', languages: ['python3'] })
  const q = await detail(u, res.data.question_id)
  assert.equal(q.leetcode_url, 'https://leetcode.com/problems/two-sum/')
  assert.equal(q.description, twoSum().description)
  assert.deepEqual(q.topic_slugs, ['array', 'hash-table'])
  assert.deepEqual(q.constraints, ['2 <= nums.length <= 10^4'])
  assert.equal(q.question_language_versions[0].starter_code, twoSum().starter_code)
})

test('same language again is idempotent and never overwrites', async () => {
  const u = await newUser()
  await save(u, twoSum())
  const res = await save(u, twoSum({ starter_code: 'different' }))
  assert.equal(res.data.status, 'already_saved')
  const q = await detail(u, res.data.question_id)
  assert.equal(q.question_language_versions.length, 1)
  assert.equal(q.question_language_versions[0].starter_code, twoSum().starter_code)
})

test('second language is added; original statement kept', async () => {
  const u = await newUser()
  await save(u, twoSum())
  const res = await save(u, twoSum({ language: 'java', language_name: 'Java', starter_code: 'class Solution {}', description: '<p>changed</p>' }))
  assert.equal(res.data.status, 'language_added')
  assert.deepEqual(res.data.languages, ['python3', 'java'])
  const q = await detail(u, res.data.question_id)
  assert.equal(q.description, twoSum().description)
})

test('validation errors name the bad fields', async () => {
  const u = await newUser()
  const res = await save(u, twoSum({ title: '', starter_code: '  ', difficulty: 'Impossible', leetcode_url: 'https://evil.com/problems/x/' }))
  assert.equal(res.status, 400)
  assert.equal(res.data.code, '22023')
  const fields = JSON.parse(res.data.details)
  for (const f of ['title', 'starter_code', 'difficulty', 'leetcode_url']) assert.ok(f in fields, f)
  const slug = await save(u, twoSum({ slug: 'three-sum' }))
  assert.ok('slug' in JSON.parse(slug.data.details))
  const topics = await save(u, twoSum({ topics: [{ name: 'Bad', slug: 'Bad Slug' }] }))
  assert.ok('topics' in JSON.parse(topics.data.details))
})

test('client saved_at is used for queued saves; implausible values ignored', async () => {
  const u = await newUser()
  const clicked = new Date(Date.now() - 3 * 3600e3)
  const { data } = await save(u, twoSum({ saved_at: clicked.toISOString() }))
  const q = await detail(u, data.question_id)
  assert.equal(new Date(q.saved_at).getTime(), clicked.getTime())
  assert.equal(new Date(q.question_language_versions[0].saved_at).getTime(), clicked.getTime())
  const m = await save(u, median({ saved_at: new Date(Date.now() + 2 * 86400e3).toISOString() }))
  assert.ok(new Date((await detail(u, m.data.question_id)).saved_at) <= new Date())
  assert.equal((await save(u, twoSum({ language: 'go', saved_at: 'yesterday' }))).status, 200)
})

test('check query used by the extension', async () => {
  const u = await newUser()
  const check = () => call('GET', '/rest/v1/questions?slug=eq.two-sum&select=id,question_language_versions(language)', { token: u.token })
  assert.deepEqual((await check()).data, [])
  const { data } = await save(u, twoSum())
  assert.deepEqual((await check()).data, [{ id: data.question_id, question_language_versions: [{ language: 'python3' }] }])
})

// --- listing ---------------------------------------------------------------------------------------------------------

test('search and filters', async () => {
  const u = await newUser()
  for (const p of [twoSum(), median(), palindrome()]) assert.equal((await save(u, p)).status, 200)
  assert.deepEqual(await titles(u, { p_q: 'median' }), ['Median of Two Sorted Arrays'])
  assert.deepEqual(await titles(u, { p_q: 'palindromic' }), ['Longest Palindromic Substring'])
  assert.deepEqual(await titles(u, { p_q: 'hash' }), ['Two Sum']) // topic
  assert.deepEqual(await titles(u, { p_q: 'sorted arrays' }), ['Median of Two Sorted Arrays'])
  assert.deepEqual(await titles(u, { p_q: '5' }), ['Longest Palindromic Substring'])
  assert.deepEqual(await titles(u, { p_q: '100%' }), [])
  assert.deepEqual(await titles(u, { p_difficulties: ['Easy', 'Hard'] }), ['Median of Two Sorted Arrays', 'Two Sum'])
  assert.deepEqual(await titles(u, { p_topics: ['array'] }), ['Median of Two Sorted Arrays', 'Two Sum'])
  assert.deepEqual(await titles(u, { p_topics: ['array', 'binary-search'] }), ['Median of Two Sorted Arrays'])
  assert.deepEqual(await titles(u, { p_languages: ['java'] }), ['Longest Palindromic Substring'])
  assert.deepEqual(await titles(u, { p_languages: ['cpp', 'java'] }), ['Longest Palindromic Substring', 'Median of Two Sorted Arrays'])
  assert.deepEqual(await titles(u, { p_q: 'two', p_topics: ['array'], p_difficulties: ['Easy'], p_languages: ['python3'] }), ['Two Sum'])
  assert.equal((await rpc(u, 'list_questions', { p_difficulties: ['Nope'] })).status, 400)
  assert.equal((await rpc(u, 'list_questions', { p_sort: 'nope' })).status, 400)
})

test('pagination, sorting, summaries', async () => {
  const u = await newUser()
  for (const p of [twoSum(), median(), palindrome()]) await save(u, p)
  let res = await list(u, { p_per_page: 2, p_sort: 'title' })
  assert.equal(res.total, 3)
  assert.equal(res.pages, 2)
  assert.deepEqual(res.items.map((i) => i.title), ['Longest Palindromic Substring', 'Median of Two Sorted Arrays'])
  res = await list(u, { p_per_page: 2, p_page: 2, p_sort: 'title' })
  assert.deepEqual(res.items.map((i) => i.title), ['Two Sum'])
  res = await list(u, { p_page: 9 })
  assert.deepEqual(res.items, [])
  assert.equal(res.total, 3)
  res = await list(u, { p_sort: 'difficulty' })
  assert.deepEqual(res.items.map((i) => i.difficulty), ['Easy', 'Medium', 'Hard'])
  res = await list(u)
  assert.equal(res.items[0].title, 'Longest Palindromic Substring')
  assert.deepEqual(res.items[0].languages, [{ language: 'java', language_name: 'Java' }])
  assert.ok(!('description' in res.items[0]))
})

test('stats', async () => {
  const u = await newUser()
  for (const p of [twoSum(), median(), palindrome()]) await save(u, p)
  const { data } = await rpc(u, 'get_stats', {})
  assert.equal(data.total, 3)
  assert.deepEqual(data.difficulty, { Easy: 1, Medium: 1, Hard: 1 })
  assert.deepEqual(data.topics[0], { slug: 'array', name: 'Array', count: 2 })
  assert.equal(data.recent.length, 3)
  assert.deepEqual(data.languages.map((l) => l.language).sort(), ['cpp', 'java', 'python3'])
})

// --- editing ---------------------------------------------------------------------------------------------------------

test('only personal notes are editable', async () => {
  const u = await newUser()
  const { data } = await save(u, twoSum())
  const ok = await call('PATCH', `/rest/v1/questions?id=eq.${data.question_id}`, { token: u.token, body: { personal_notes: 'Use a hash map.' }, prefer: 'return=representation' })
  assert.equal(ok.status, 200)
  assert.equal(ok.data[0].personal_notes, 'Use a hash map.')
  const bad = await call('PATCH', `/rest/v1/questions?id=eq.${data.question_id}`, { token: u.token, body: { description: 'hacked' } })
  assert.equal(bad.status, 403) // permission denied for column
  assert.equal((await detail(u, data.question_id)).description, twoSum().description)
  const direct = await call('POST', '/rest/v1/question_language_versions', { token: u.token, body: { question_id: data.question_id, language: 'rust', language_name: 'Rust', starter_code: 'x' } })
  assert.notEqual(direct.status, 201) // starter code only via save_question
  const directQ = await call('POST', '/rest/v1/questions', { token: u.token, body: { title: 'x' } })
  assert.notEqual(directQ.status, 201)
})

test('solutions CRUD, kept separate from starter code', async () => {
  const u = await newUser()
  const { data } = await save(u, twoSum())
  const created = await call('POST', '/rest/v1/personal_solutions', {
    token: u.token, prefer: 'return=representation',
    body: { question_id: data.question_id, language: 'python3', solution_code: 'return []', notes: 'O(n)' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const sid = created.data[0].id
  const upd = await call('PATCH', `/rest/v1/personal_solutions?id=eq.${sid}`, { token: u.token, body: { notes: 'O(n) time' }, prefer: 'return=representation' })
  assert.equal(upd.data[0].notes, 'O(n) time')
  const q = await detail(u, data.question_id)
  assert.equal(q.personal_solutions[0].solution_code, 'return []')
  assert.equal(q.question_language_versions[0].starter_code, twoSum().starter_code)
  const empty = await call('POST', '/rest/v1/personal_solutions', { token: u.token, body: { question_id: data.question_id } })
  assert.equal(empty.status, 400)
  await call('DELETE', `/rest/v1/personal_solutions?id=eq.${sid}`, { token: u.token })
  assert.deepEqual((await detail(u, data.question_id)).personal_solutions, [])
})

test('delete language version and question (cascades); re-save works', async () => {
  const u = await newUser()
  const { data } = await save(u, twoSum())
  await save(u, twoSum({ language: 'java', language_name: 'Java', starter_code: 'x' }))
  await call('POST', '/rest/v1/personal_solutions', { token: u.token, body: { question_id: data.question_id, solution_code: 'x' } })
  await call('DELETE', `/rest/v1/question_language_versions?question_id=eq.${data.question_id}&language=eq.java`, { token: u.token })
  assert.deepEqual((await detail(u, data.question_id)).question_language_versions.map((v) => v.language), ['python3'])
  const del = await call('DELETE', `/rest/v1/questions?id=eq.${data.question_id}`, { token: u.token, prefer: 'return=representation' })
  assert.equal(del.data.length, 1)
  assert.equal(await detail(u, data.question_id), undefined)
  assert.equal((await save(u, twoSum())).data.status, 'created')
})

// --- daily wars ------------------------------------------------------------------------------------------------------
// Filling a war needs LeetCode, so these cover the API around it; tests/db/war.sql covers the generator.

test('war API: empty state, access control, done button only on own items', async () => {
  const u = await newUser()
  const war = (await rpc(u, 'get_war', {})).data
  assert.equal(war.exists, false)
  assert.deepEqual(war.items, [])
  assert.deepEqual(war.streak, { current: 0, best: 0, won: 0 })
  assert.match(war.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Date.parse(war.deadline) > Date.parse(war.starts_at))
  assert.deepEqual((await rpc(u, 'war_days', {})).data, [])
  assert.notEqual((await rpc(null, 'get_war', {})).status, 200)
  assert.equal((await rpc(u, 'set_war_item_done', { p_item: 999999999, p_done: true })).status, 404)
  // Wars can't be created or edited directly.
  const direct = await call('POST', '/rest/v1/daily_wars', { token: u.token, body: { war_date: '2026-01-01', deadline: new Date().toISOString() } })
  assert.notEqual(direct.status, 201)
  // The generator is not reachable through the API.
  assert.notEqual((await rpc(u, 'generate_daily_wars', {})).status, 200)
  assert.notEqual((await rpc(u, 'fill_war', { uid: u.id })).status, 200)
})
