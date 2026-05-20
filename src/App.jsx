// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Auth          from './pages/Auth'
import Dashboard     from './pages/Dashboard'
import Projects      from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import CashFlow      from './pages/CashFlow'
import Settings      from './pages/Settings'
import { Spinner }   from './components/ui'

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

export default function App() {
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
              <Route path="/"              element={<Dashboard />} />
              <Route path="/projects"      element={<Projects />} />
              <Route path="/projects/:id"  element={<ProjectDetail />} />
              <Route path="/cashflow"      element={<CashFlow />} />
              <Route path="/settings"      element={<Settings />} />
              <Route path="*"              element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  )
}
