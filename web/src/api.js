import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY)

// The anon/publishable key is designed to be public; Row Level Security limits every user to their own rows.
export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

export class ApiError extends Error {
  constructor(code, message, fields) {
    super(message)
    this.code = code
    this.fields = fields || {}
  }
}

function toApiError(error) {
  if (!error) return null
  if (error.name === 'AbortError' || /abort/i.test(error.message || '')) return Object.assign(new Error('aborted'), { name: 'AbortError' })
  if (/failed to fetch|networkerror|load failed/i.test(error.message || '')) {
    return new ApiError('network_error', 'Cannot reach the database. Check your connection and retry.')
  }
  let fields
  try {
    fields = error.details ? JSON.parse(error.details) : undefined
  } catch {
    fields = undefined
  }
  if (error.code === 'PGRST301' || /jwt/i.test(error.message || '')) {
    return new ApiError('unauthorized', 'Your session expired. Please log in again.')
  }
  return new ApiError(error.code || 'error', error.message || 'Request failed.', fields)
}

async function run(query) {
  const { data, error } = await query
  if (error) throw toApiError(error)
  return data
}

// --- reads ------------------------------------------------------------------------------------------------------------

export function listQuestions({ q, difficulty = [], topics = [], language = '', sort = 'newest', page = 1, perPage = 25 }, signal) {
  let query = supabase.rpc('list_questions', {
    p_q: q || '',
    p_difficulties: difficulty,
    p_topics: topics,
    p_languages: language ? [language] : [],
    p_sort: sort,
    p_page: page,
    p_per_page: perPage,
  })
  if (signal) query = query.abortSignal(signal)
  return run(query)
}

export const getStats = () => run(supabase.rpc('get_stats'))

export async function getQuestion(id) {
  const data = await run(
    supabase
      .from('questions')
      .select(
        '*, language_versions:question_language_versions(*), solutions:personal_solutions(*),' +
          ' war_items:daily_war_items(id, done_at, war:daily_wars(war_date, deadline))',
      )
      .eq('id', id)
      .order('saved_at', { referencedTable: 'question_language_versions', ascending: true })
      .order('updated_at', { referencedTable: 'personal_solutions', ascending: false })
      .maybeSingle(),
  )
  if (!data) throw new ApiError('not_found', 'Question not found.')
  return data
}

// --- daily wars ------------------------------------------------------------------------------------------------------

// date: 'YYYY-MM-DD' or undefined for today's war.
export const getWar = (date) => run(supabase.rpc('get_war', date ? { p_date: date } : {}))

export const getWarDays = (from, to) => run(supabase.rpc('war_days', { p_from: from, p_to: to }))

export const getStreak = () => run(supabase.rpc('war_streak'))

export const getWarSettings = () => run(supabase.rpc('get_war_settings'))

// topics: LeetCode topic slugs; [] = any topic (random).
export const setWarTopics = (topics) => run(supabase.rpc('set_war_topics', { p_topics: topics }))

export const getWarHistory = ({ sort = 'newest', difficulty = [], topics = [], limit = 100 }) =>
  run(supabase.rpc('war_history', { p_sort: sort, p_difficulties: difficulty, p_topics: topics, p_limit: limit }))

export const setWarDone = (itemId, done) => run(supabase.rpc('set_war_item_done', { p_item: itemId, p_done: done }))

// --- writes (only notes, solutions and deletions; the original question is read-only) ---------------------------------

export const updateNotes = (id, personal_notes) =>
  run(supabase.from('questions').update({ personal_notes }).eq('id', id).select('id'))

export const deleteQuestion = (id) => run(supabase.from('questions').delete().eq('id', id))

export const deleteLanguage = (id, language) =>
  run(supabase.from('question_language_versions').delete().eq('question_id', id).eq('language', language))

export const createSolution = (questionId, { language, solution_code, notes }) =>
  run(supabase.from('personal_solutions').insert({ question_id: questionId, language, solution_code, notes }))

export const updateSolution = (id, { language, solution_code, notes }) =>
  run(supabase.from('personal_solutions').update({ language, solution_code, notes }).eq('id', id))

export const deleteSolution = (id) => run(supabase.from('personal_solutions').delete().eq('id', id))
