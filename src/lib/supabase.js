// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isMisconfigured = !SUPABASE_URL || !SUPABASE_ANON_KEY

export const supabase = isMisconfigured
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })

export const inr = (val) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(val ?? 0)

// Compact Indian-format currency: Lakh / Crore short form so dense
// tiles (project cards, dashboard metric strips) don't overflow.
//   < 1,000          → ₹999
//   < 1,00,000       → ₹X,XXX        (full thousands)
//   < 1,00,00,000    → ₹X.XL         (Lakhs, up to 1 decimal)
//   ≥ 1,00,00,000    → ₹X.XCr        (Crores, up to 2 decimals)
// Negative values get a leading "−". Use inr() for full-precision display.
export const inrCompact = (val) => {
  const n = Number(val ?? 0)
  if (!Number.isFinite(n)) return '₹0'
  const sign = n < 0 ? '−' : ''
  const abs  = Math.abs(n)

  // Strip trailing ".0" / ".00" so "12.0L" renders as "12L"
  const trim = (s) => s.replace(/\.?0+$/, '')

  if (abs < 1000) {
    return `${sign}₹${Math.round(abs)}`
  }
  if (abs < 100000) {
    return `${sign}₹${new Intl.NumberFormat('en-IN').format(Math.round(abs))}`
  }
  if (abs < 10000000) {
    const lakhs = abs / 100000
    return `${sign}₹${trim(lakhs.toFixed(lakhs >= 100 ? 0 : 1))}L`
  }
  const crores = abs / 10000000
  return `${sign}₹${trim(crores.toFixed(crores >= 100 ? 0 : crores >= 10 ? 1 : 2))}Cr`
}

export const pct = (val) => `${(val ?? 0).toFixed(2)}%`

export const isoDate = (d = new Date()) =>
  (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
