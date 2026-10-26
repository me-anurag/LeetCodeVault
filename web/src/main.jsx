import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './index.css'
import './theme'
import { configured } from './api'
import { registerServiceWorker } from './pwa'
import { AuthProvider, useAuth } from './auth'
import { Layout, Loading } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import QuestionDetail from './pages/QuestionDetail'
import Streak from './pages/Streak'
import War from './pages/War'

function Protected({ children }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <Layout><Loading /></Layout>
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location }} />
  return <Layout>{children}</Layout>
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-sm">
      <h1 className="mb-3 text-lg font-semibold">DailyWars is not configured</h1>
      <p className="text-zinc-500">
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (in <code>web/.env.local</code> locally,
        or in Netlify's environment variables) and rebuild.
      </p>
    </div>
  )
}

registerServiceWorker()

createRoot(document.getElementById('root')).render(
  !configured ? <NotConfigured /> :
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><War /></Protected>} />
          <Route path="/war/:date" element={<Protected><War /></Protected>} />
          <Route path="/streak" element={<Protected><Streak /></Protected>} />
          <Route path="/library" element={<Protected><Dashboard /></Protected>} />
          <Route path="/questions/:id" element={<Protected><QuestionDetail /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
