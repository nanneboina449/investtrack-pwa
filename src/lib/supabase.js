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

export const pct = (val) => `${(val ?? 0).toFixed(2)}%`

export const isoDate = (d = new Date()) =>
  (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
