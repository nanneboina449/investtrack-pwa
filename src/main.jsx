import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import './styles/index.css'

import { registerSW } from 'virtual:pwa-register'

// Force immediate SW update — clear old caches and reload
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // New version available — update immediately without asking
    updateSW(true)
  },
  onOfflineReady() {
    console.log('InvestTrack v1.2.0 ready for offline use')
  },
})

// Resize to phone dimensions when installed as PWA on desktop
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

if (isStandalone) {
  const TARGET_W = 430
  const TARGET_H = Math.min(900, window.screen.availHeight * 0.92)
  if (window.outerWidth > TARGET_W + 40) {
    try {
      window.resizeTo(TARGET_W, TARGET_H)
      window.moveTo(
        Math.round((window.screen.availWidth  - TARGET_W) / 2),
        Math.round((window.screen.availHeight - TARGET_H) / 2)
      )
    } catch (_) {}
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
