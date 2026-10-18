import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { Button, inputClass } from '../components/ui'

export default function Login() {
  const { status, authenticate } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') return <Navigate to={location.state?.from?.pathname || '/'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const note = await authenticate(mode, email, password)
      if (note) {
        setNotice(note)
        setMode('login')
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          LeetVault
        </div>
        <p className="text-sm text-zinc-500">
          {mode === 'login' ? 'Log in to your question library.' : 'Create your account.'}
        </p>
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input className={inputClass} type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
          {error?.fields?.email && <span className="text-xs text-rose-600">{error.fields.email}</span>}
        </label>
        <label className="block space-y-1 text-sm">
          <span>Password</span>
          <input className={inputClass} type="password" required minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password}
            onChange={(e) => setPassword(e.target.value)} />
          {error?.fields?.password && <span className="text-xs text-rose-600">{error.fields.password}</span>}
        </label>
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {error && !error.fields?.email && !error.fields?.password && (
          <p className="text-sm text-rose-600">{error.message}</p>
        )}
        <Button type="submit" variant="primary" className="w-full py-1.5" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </Button>
        <button type="button" className="w-full text-center text-sm text-zinc-500 hover:underline"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
          {mode === 'login' ? 'No account? Register' : 'Have an account? Log in'}
        </button>
      </form>
    </div>
  )
}
