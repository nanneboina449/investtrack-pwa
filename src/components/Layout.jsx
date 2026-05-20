// src/components/Layout.jsx
import { NavLink, useLocation } from 'react-router-dom'

const NAV = [
  { to: '/',         label: 'Dashboard', icon: '◈' },
  { to: '/projects', label: 'Projects',  icon: '⬡' },
  { to: '/cashflow', label: 'Cash Flow', icon: '⇄' },
  { to: '/settings', label: 'Settings',  icon: '⚙' },
]

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto relative">
      <main className="flex-1 pb-nav overflow-y-auto">
        {children}
      </main>

      <nav className="bottom-nav">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
