// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { isMisconfigured } from './lib/supabase'
import Layout from './components/Layout'
import Auth          from './pages/Auth'
import Dashboard     from './pages/Dashboard'
import Projects      from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import CashFlow      from './pages/CashFlow'
import Settings      from './pages/Settings'
import { Spinner }   from './components/ui'

// ── Setup screen (shown when env vars missing) ────────────────
function SetupScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 px-6">
      <div className="max-w-sm w-full">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">⚙️</div>
          <h1 className="text-2xl font-bold text-brand-900 mb-2">Setup Required</h1>
          <p className="text-gray-500 text-sm">Add your Supabase environment variables in Vercel to go live.</p>
        </div>
        <div className="card p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Vercel → Settings → Environment Variables
            </p>
            <div className="space-y-2">
              {['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].map(key => (
                <div key={key} className="bg-gray-50 rounded-lg px-3 py-2 font-mono text-xs text-brand-900 border border-gray-200">
                  {key}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            <p className="font-semibold mb-1">Where to get these values:</p>
            <p>Supabase Dashboard → Your Project → Settings → API</p>
          </div>
          <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer"
            className="btn-primary w-full block text-center">
            Open Vercel Dashboard →
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Protected route wrapper ───────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
  if (!user) return <Navigate to="/auth" replace />
  return children
}

// ── Main app (only rendered when env vars are set) ────────────
function MainApp() {
  const { user, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50">
      <div className="text-center">
        <div className="text-5xl mb-4">📈</div>
        <Spinner size="lg" />
      </div>
    </div>
  )

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/"             element={<Dashboard />} />
              <Route path="/projects"     element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/cashflow"     element={<CashFlow />} />
              <Route path="/settings"     element={<Settings />} />
              <Route path="*"             element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

// ── Root — decides which tree to render ──────────────────────
export default function App() {
  if (isMisconfigured) return <SetupScreen />
  return <MainApp />
}
