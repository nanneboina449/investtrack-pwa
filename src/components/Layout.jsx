// src/components/Layout.jsx
import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',         label: 'Dashboard', icon: '◈' },
  { to: '/projects', label: 'Projects',  icon: '⬡' },
  { to: '/cashflow', label: 'Cash Flow', icon: '⇄' },
  { to: '/settings', label: 'Settings',  icon: '⚙' },
]

export default function Layout({ children }) {
  return (
    <>
      {/* Desktop side decorations */}
      <div className="desktop-deco-left" aria-hidden="true">
        <div className="deco-label">Portfolio</div>
        <div className="deco-value">InvestTrack</div>
        <div className="deco-divider" />
        <div className="deco-label">Powered by</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 500 }}>Supabase + Vercel</div>
      </div>

      <div className="desktop-deco-right" aria-hidden="true">
        <div className="deco-label">Currency</div>
        <div className="deco-value">₹ INR</div>
        <div className="deco-divider" style={{ margin: '12px 0' }} />
        <div className="deco-label">Track</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 500, lineHeight: 1.8 }}>
          Investments<br />Profits<br />Loans<br />Shares
        </div>
      </div>

      {/* App frame */}
      <div className="app-frame">
        <main className="pb-nav overflow-y-auto min-h-screen bg-gray-50">
          {children}
        </main>

        <nav className="bottom-nav">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  )
}
