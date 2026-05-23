// src/components/Layout.jsx
import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',         label: 'Portfolio', icon: '◈' },
  { to: '/projects', label: 'Projects',  icon: '⬡' },
  { to: '/cashflow', label: 'Cash Flow', icon: '⇄' },
  { to: '/settings', label: 'Settings',  icon: '⚙' },
]

export default function Layout({ children }) {
  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar (hidden on mobile) */}
      <aside className="hidden lg:flex lg:flex-col fixed top-0 bottom-0 left-0 w-60 bg-white border-r border-gray-200 z-30">
        <div className="p-6 border-b border-gray-100">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Portfolio</p>
          <p className="font-bold text-xl text-brand-900">InvestTrack</p>
          <p className="text-xs text-gray-400 mt-1">Vishwa Technologies</p>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors
                 ${isActive
                   ? 'bg-brand-50 text-brand-900'
                   : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`
              }>
              <span className="text-xl leading-none w-5 text-center">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>₹ INR</span>
          <span>v1.2</span>
        </div>
      </aside>

      {/* Mobile-style decorations only shown on lg if there's no sidebar overlap */}
      <div className="desktop-deco-left lg:hidden" aria-hidden="true">
        <div className="deco-label">Portfolio</div>
        <div className="deco-value">InvestTrack</div>
        <div className="deco-divider" />
        <div className="deco-label">Built by</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 500 }}>Vishwa Technologies Ltd</div>
      </div>
      <div className="desktop-deco-right lg:hidden" aria-hidden="true">
        <div className="deco-label">Currency</div>
        <div className="deco-value">₹ INR</div>
        <div className="deco-divider" style={{ margin: '12px 0' }} />
        <div className="deco-label">Track</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 500, lineHeight: 1.8 }}>
          Investments<br />Profits<br />Loans<br />Shares
        </div>
      </div>

      {/* App content */}
      <div className="app-frame lg:!max-w-none lg:!mx-0 lg:ml-60 lg:flex-1 lg:bg-gray-50 lg:!shadow-none">
        <main className="pb-nav lg:!pb-0 overflow-y-auto min-h-screen bg-gray-50">
          {children}
        </main>

        {/* Mobile bottom nav (hidden on lg) */}
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
