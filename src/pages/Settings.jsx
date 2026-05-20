// src/pages/Settings.jsx
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const { user, signOut } = useAuth()

  return (
    <div className="page-enter">
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-5">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <div className="px-4 py-5 space-y-4">
        {/* Account */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Account</p>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-50 rounded-full flex items-center justify-center text-brand-900 font-bold">
                {user?.email?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{user?.email}</p>
                <p className="text-xs text-gray-400">Signed in</p>
              </div>
            </div>
            <button onClick={signOut} className="w-full text-center text-sm font-semibold text-red-500 bg-red-50 rounded-xl py-2.5">
              Sign Out
            </button>
          </div>
        </section>

        {/* App info */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">App</p>
          <div className="card p-4 space-y-3">
            {[
              { label: 'Version',       value: '1.0.0' },
              { label: 'Currency',      value: 'Indian Rupee (₹)' },
              { label: 'Backend',       value: 'Supabase' },
              { label: 'Platform',      value: 'PWA' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Install prompt */}
        <section>
          <div className="card p-4 bg-brand-50 border-brand-100">
            <p className="font-semibold text-brand-900 mb-1">📱 Install App</p>
            <p className="text-xs text-brand-700">Tap the Share button in your browser → "Add to Home Screen" to install InvestTrack as a native app.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
