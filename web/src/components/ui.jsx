import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useIsPhone } from '../theme'

const DIFF_STYLE = {
  Easy: 'text-emerald-600 dark:text-emerald-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  Hard: 'text-rose-600 dark:text-rose-400',
}
const DIFF_DOT = { Easy: 'bg-emerald-500', Medium: 'bg-amber-500', Hard: 'bg-rose-500' }

export function Difficulty({ value, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${DIFF_STYLE[value] || ''} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DIFF_DOT[value] || 'bg-zinc-400'}`} />
      {value}
    </span>
  )
}

export function Tag({ children, active, onClick, title }) {
  const base = 'inline-flex items-center rounded border px-1.5 py-px text-[11px] leading-5 whitespace-nowrap'
  const tone = active
    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
    : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400'
  if (!onClick) return <span className={`${base} ${tone}`}>{children}</span>
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${tone} hover:border-zinc-500`}>
      {children}
    </button>
  )
}

export function Button({ variant = 'default', className = '', ...props }) {
  const styles = {
    default:
      'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900',
    primary:
      'border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300',
    danger: 'border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950',
    ghost: 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
  }
  return (
    <button
      type="button"
      className={`rounded-md px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400'

export function Loading({ label = 'Loading…' }) {
  return <p className="py-8 text-center text-sm text-zinc-500">{label}</p>
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-300 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:text-rose-400">
      <span>{error.message || String(error)}</span>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

// Run fn when the tab regains focus, so changes made elsewhere (extension, another device) show up.
export function useOnFocus(fn) {
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && fn()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fn])
}

export function formatDate(iso, withTime = false) {
  if (!iso) return ''
  const d = new Date(iso)
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Layout({ children }) {
  const { user, logout } = useAuth()
  const isPhone = useIsPhone()
  if (isPhone) return children // phone pages draw their own minimal top bar
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 py-3 dark:border-zinc-800">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src="/logo.png" alt="" className="h-6 w-6" />
          DailyWars
        </Link>
        {user && (
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/" className="hover:underline">War</Link>
            <Link to="/streak" className="hover:underline">Streak</Link>
            <Link to="/library" className="hover:underline">Library</Link>
          </nav>
        )}
        {user && (
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="hidden truncate text-zinc-500 lg:inline">{user.email}</span>
            <Button variant="ghost" onClick={logout}>
              Log out
            </Button>
          </div>
        )}
      </header>
      {children}
    </div>
  )
}
