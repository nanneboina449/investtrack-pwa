// src/components/Layout.jsx
//
// Two layouts:
//   - Mobile / tablet (< 1024px): bottom-nav with icon + label
//   - Desktop (≥ 1024px): collapsible sidebar (expanded → 240px,
//     collapsed → 68px icon-only). State persisted to localStorage.
//
// The CSS custom property --sidebar-w (set on document.documentElement
// via the `sidebar-collapsed` class) determines the left margin of the
// main content area. See src/styles/index.css.
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',          label: 'Portfolio', icon: '◈' },
  { to: '/projects',  label: 'Projects',  icon: '⬡' },
  { to: '/investors', label: 'Investors', icon: '👥' },
  { to: '/cashflow',  label: 'Cash Flow', icon: '⇄' },
  { to: '/settings',  label: 'Settings',  icon: '⚙' },
]

const COLLAPSED_KEY = 'sidebar:collapsed'

export default function Layout({ children }) {
  // Persisted sidebar state — defaults to expanded
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' }
    catch { return false }
  })

  // Mirror the state into a class on <html> so CSS can read it via
  // the --sidebar-w custom property and adjust the content margin.
  useEffect(() => {
    const root = document.documentElement
    if (collapsed) root.classList.add('sidebar-collapsed')
    else           root.classList.remove('sidebar-collapsed')
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch {}
  }, [collapsed])

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar (≥ lg). Width controlled by .app-sidebar class +
          .collapsed modifier — CSS handles the transition. */}
      <aside
        className={`app-sidebar hidden lg:flex lg:flex-col fixed top-0 bottom-0 left-0 bg-white border-r border-gray-200 z-30 ${collapsed ? 'collapsed' : ''}`}
        aria-label="Primary navigation"
      >
        {/* Brand */}
        <div className="p-4 border-b border-gray-100 relative">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="w-8 h-8 rounded-lg bg-brand-900 text-white grid place-items-center font-bold text-sm flex-shrink-0">
              IT
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-bold text-sm text-brand-900 truncate">InvestTrack</p>
                <p className="sidebar-brand-sub text-[10px] text-gray-400 truncate">Vishwa Technologies</p>
              </div>
            )}
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto no-scrollbar">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `nav-link flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
                 ${isActive
                   ? 'bg-brand-50 text-brand-900'
                   : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`
              }
            >
              <span className="text-lg leading-none w-6 text-center flex-shrink-0">{icon}</span>
              <span className="sidebar-label truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="m-2 p-2 rounded-xl text-gray-500 hover:bg-gray-50 hover:text-gray-700 flex items-center gap-2 text-xs font-medium"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="text-base leading-none">{collapsed ? '»' : '«'}</span>
          <span className="sidebar-label">Collapse</span>
        </button>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between">
          <span>₹ INR</span>
          <span className="sidebar-foot-text">v1.2</span>
        </div>
      </aside>

      {/* App content — left margin keyed to --sidebar-w on lg+. */}
      <div
        className="app-frame flex-1 min-w-0"
        style={{ marginLeft: 'var(--sidebar-w)' }}
      >
        <main className="pb-nav overflow-y-auto min-h-screen bg-gray-50">
          {children}
        </main>

        {/* Mobile bottom nav (hidden on lg+) */}
        <nav className="bottom-nav lg:hidden">
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
    </div>
  )
}
