import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import './styles/index.css'

import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })

// ── Resize window to app dimensions when installed as PWA ────
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

if (isStandalone) {
  const TARGET_W = 430
  const TARGET_H = Math.min(900, window.screen.availHeight * 0.92)

  // Only resize if window is significantly wider than target
  if (window.outerWidth > TARGET_W + 40) {
    const x = Math.round((window.screen.availWidth  - TARGET_W) / 2)
    const y = Math.round((window.screen.availHeight - TARGET_H) / 2)
    try {
      window.resizeTo(TARGET_W, TARGET_H)
      window.moveTo(x, y)
    } catch (_) {
      // Some OS/browsers block resizeTo — silently ignore
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
