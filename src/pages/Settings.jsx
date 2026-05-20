// src/pages/Settings.jsx
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

const APP_VERSION = '1.2.0'
const BUILD_DATE  = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })

export default function Settings() {
  const { user, signOut } = useAuth()
  const [clearing, setClearing] = useState(false)

  const clearCacheAndReload = async () => {
    setClearing(true)
    try {
      // Unregister service workers
      const regs = await navigator.serviceWorker?.getRegistrations()
      for (const reg of regs || []) await reg.unregister()
      // Clear all caches
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    } catch (_) {}
    window.location.reload(true)
  }

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
              <div className="w-10 h-10 bg-brand-50 rounded-full flex items-center justify-center text-brand-900 font-bold text-sm">
                {user?.user_metadata?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase()}
              </div>
              <div>
                {user?.user_metadata?.full_name && (
                  <p className="font-semibold text-gray-900 text-sm">{user.user_metadata.full_name}</p>
                )}
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
            </div>
            <button onClick={signOut}
              className="w-full text-center text-sm font-semibold text-red-500 bg-red-50 rounded-xl py-2.5 active:scale-95 transition-transform">
              Sign Out
            </button>
          </div>
        </section>

        {/* App info */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">App</p>
          <div className="card p-4 space-y-3">
            {[
              { label: 'Version',    value: `v${APP_VERSION}` },
              { label: 'Currency',   value: 'Indian Rupee (₹ INR)' },
              { label: 'Platform',   value: 'Progressive Web App' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Cache */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Cache</p>
          <div className="card p-4 space-y-3">
            <p className="text-xs text-gray-400">If the app looks outdated, clear the cache and reload to get the latest version.</p>
            <button onClick={clearCacheAndReload} disabled={clearing}
              className="w-full text-center text-sm font-semibold text-blue-600 bg-blue-50 rounded-xl py-2.5 active:scale-95 transition-transform disabled:opacity-50">
              {clearing ? 'Clearing…' : '🔄 Clear Cache & Reload'}
            </button>
          </div>
        </section>

        {/* Install */}
        <section>
          <div className="card p-4 bg-brand-50 border-brand-100">
            <p className="font-semibold text-brand-900 mb-1">📱 Install App</p>
            <p className="text-xs text-brand-700">Tap Share → "Add to Home Screen" in Safari, or the install icon in Chrome to install InvestTrack.</p>
          </div>
        </section>

        {/* Branding */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-300">InvestTrack v{APP_VERSION}</p>
          <p className="text-xs text-gray-300 mt-0.5">© Vishwa Technologies Ltd</p>
        </div>

      </div>
    </div>
  )
}
