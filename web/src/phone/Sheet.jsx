import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

// Which sheet is open lives in the history entry's state, so the phone's back gesture closes it.
export function useSheet() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = location.state?.sheet || null
  const here = location.pathname + location.search
  const show = (name) => navigate(here, { state: { ...location.state, sheet: name }, replace: Boolean(open) })
  const close = () =>
    location.key !== 'default'
      ? navigate(-1)
      : navigate(here, { replace: true, state: { ...location.state, sheet: null } })
  return { open, show, close }
}

export function TopBar({ onMenu }) {
  return (
    <header className="sticky top-0 z-20 -mx-5 flex items-center justify-between bg-paper/90 px-5 pt-[env(safe-area-inset-top)] backdrop-blur">
      <Link to="/" className="flex h-12 items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
        <img src="/logo.png" alt="" className="h-5 w-5" />
        DailyWars
      </Link>
      <button type="button" onClick={onMenu} aria-label="Menu"
        className="-mr-2 flex h-12 w-12 items-center justify-center rounded-full text-ink-soft active:bg-paper-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  )
}

export function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      html.style.overflow = prev
    }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      <div className="flex items-center justify-between border-b border-line px-5 pt-[env(safe-area-inset-top)]">
        <h2 className="h-12 truncate pt-3.5 text-[15px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close"
          className="-mr-2 flex h-12 w-12 items-center justify-center rounded-full text-ink-soft active:bg-paper-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      {footer && <div className="border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </div>
  )
}

export function MenuItem({ children, hint, onClick, href, tone = 'default' }) {
  const color = { default: 'text-ink', danger: 'text-rose-700', muted: 'text-muted' }[tone]
  const className = `flex w-full items-center justify-between gap-3 border-b border-line py-3.5 text-left text-[16px] ${color} active:opacity-60`
  const body = <>
    <span>{children}</span>
    {hint != null && <span className="text-sm text-muted">{hint}</span>}
  </>
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>
  return <button type="button" onClick={onClick} className={className}>{body}</button>
}
