import { createContext, useContext, useEffect, useState } from 'react'
import { ApiError, supabase } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('checking') // checking | authenticated | anonymous

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setStatus(data.session ? 'authenticated' : 'anonymous')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setStatus(session ? 'authenticated' : 'anonymous')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Returns a message when there's nothing more to do here (e.g. "confirm your email").
  const authenticate = async (mode, email, password) => {
    const { data, error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    if (error) {
      const network = /failed to fetch/i.test(error.message)
      throw new ApiError(error.code || 'auth_error', network ? 'Cannot reach the server. Check your connection.' : error.message)
    }
    if (mode === 'register' && !data.session) return 'Account created. Check your email for the confirmation link, then log in.'
    return null
  }

  const logout = () => supabase.auth.signOut()

  return <AuthContext.Provider value={{ user, status, authenticate, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
