// src/pages/Auth.jsx
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Spinner } from '../components/ui'

export default function Auth() {
  const { signIn, signUp } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fn = isSignUp ? signUp : signIn
      const { error } = await fn(email, password)
      if (error) throw error
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-brand-50 to-white">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="w-20 h-20 bg-brand-900 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-4 shadow-lg">
          📈
        </div>
        <h1 className="text-3xl font-bold text-brand-900">InvestTrack</h1>
        <p className="text-gray-500 mt-1 text-sm">Your investment portfolio, simplified</p>
      </div>

      {/* Form */}
      <div className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">
          {isSignUp ? 'Create Account' : 'Welcome back'}
        </h2>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={loading}>
            {loading ? <Spinner size="sm" /> : null}
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <button
          onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
          className="text-sm text-brand-900 font-medium w-full text-center"
        >
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  )
}
