// src/hooks/useData.js
import { useState, useEffect, useCallback } from 'react'
import { supabase, isoDate } from '../lib/supabase'

// ── Generic fetch hook ───────────────────────────────────────
function useFetch(fetcher, deps = []) {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      setData(result ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load, setData }
}

// ── Projects ─────────────────────────────────────────────────
export function useProjects() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('my_projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  })
}

export async function createProject(values) {
  // Insert without .select() to avoid SELECT RLS policy on returned row
  const { error } = await supabase
    .from('projects')
    .insert({ ...values, our_stake_percent: values.our_stake_percent ?? 100 })
  if (error) throw error
  // Return minimal object — caller reloads the list anyway
  return { name: values.name }
}

export async function updateProject(id, values) {
  const { error } = await supabase.from('projects').update(values).eq('id', id)
  if (error) throw error
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

// ── Investors ─────────────────────────────────────────────────
export function useInvestors(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('investor_profit_summary')
      .select('*')
      .eq('project_id', projectId)
      .order('amount_invested', { ascending: false })
    if (error) throw error
    return data
  }, [projectId])
}

export async function createInvestor(values) {
  const { error } = await supabase.from('investors').insert(values)
  if (error) throw error
}

export async function deleteInvestor(id) {
  const { error } = await supabase.from('investors').delete().eq('id', id)
  if (error) throw error
}

// ── Profit Records ────────────────────────────────────────────
export function useProfitRecords(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('profit_records')
      .select('*')
      .eq('project_id', projectId)
      .order('record_date', { ascending: false })
    if (error) throw error
    return data
  }, [projectId])
}

export async function createProfitRecord(values) {
  // Calls the RPC so profit_distributions rows are created atomically
  // (either custom or auto-proportional based on whether distributions provided)
  const { data, error } = await supabase.rpc('create_profit_record', {
    p_project_id:    values.project_id,
    p_amount:        values.amount,
    p_record_date:   isoDate(values.record_date),
    p_notes:         values.notes ?? null,
    p_distributions: values.distributions ?? null,
  })
  if (error) throw error
  return data
}

export async function deleteProfitRecord(id) {
  const { error } = await supabase.from('profit_records').delete().eq('id', id)
  if (error) throw error
}

// ── Profit Distributions (per-investor breakdown of each profit record) ──
export function useProfitDistributions(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    // Two-query fetch (no embedded relation) so we don't depend on
    // PostgREST inferring the FK on profit_distributions -> profit_records.
    const { data: pr, error: prErr } = await supabase
      .from('profit_records')
      .select('id')
      .eq('project_id', projectId)
    if (prErr) throw prErr
    if (!pr || pr.length === 0) return []
    const ids = pr.map(p => p.id)
    const { data, error } = await supabase
      .from('profit_distributions')
      .select('id, profit_id, investor_id, amount')
      .in('profit_id', ids)
    if (error) throw error
    return data ?? []
  }, [projectId])
}

// ── Cash Adjustments & Loans ──────────────────────────────────
export function useCashFlow() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('cash_adjustments')
      .select('*')
      .order('adjustment_date', { ascending: false })
    if (error) throw error
    return data
  })
}

export function useLoans() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('loan_summary')
      .select('*')
      .order('loan_date', { ascending: false })
    if (error) throw error
    return data
  })
}

export async function createLoan({ adjustment, contributions }) {
  // 1. Create the cash_adjustment record (user_id set by DB default auth.uid())
  const { data: adj, error: adjErr } = await supabase
    .from('cash_adjustments')
    .insert({ ...adjustment })
    .select()
    .single()
  if (adjErr) throw adjErr

  // 2. Save each investor contribution
  if (contributions?.length) {
    const rows = contributions.map(c => ({ ...c, loan_id: adj.id }))
    const { error: cErr } = await supabase.from('loan_contributions').insert(rows)
    if (cErr) throw cErr
  }
  return adj
}

export async function recordRepayment({ loanId, amount, type, toProjectId, date, notes }) {
  const { error } = await supabase.rpc('process_loan_repayment', {
    p_loan_id:        loanId,
    p_amount:         amount,
    p_type:           type,
    p_to_project_id:  toProjectId ?? null,
    p_date:           isoDate(date),
    p_notes:          notes ?? null
  })
  if (error) throw error
}

export async function markSettled(id) {
  const { error } = await supabase
    .from('cash_adjustments')
    .update({ is_settled: true, settled_date: isoDate() })
    .eq('id', id)
  if (error) throw error
}

// ── Investor Running Balance ───────────────────────────────────
export function useInvestorBalances(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('investor_running_balance')
      .select('*')
      .eq('project_id', projectId)
    if (error) throw error
    return data
  }, [projectId])
}

// ── Dashboard aggregate ───────────────────────────────────────
export function useDashboard() {
  const projects    = useProjects()
  const cashflow    = useCashFlow()
  const investments = useMyInvestments()

  const summary = {
    totalInvested:    0,
    totalProfit:      0,
    totalValue:       0,
    activeProjects:   0,
    upcomingProjects: 0,
    loansGiven:       0,
    loansReceived:    0,
    netCash:          0,
  }

  // Portfolio numbers come from the user's investor positions (per-share),
  // NOT from my_projects totals — otherwise a 30% investor sees 100% of project values.
  for (const inv of investments.data) {
    summary.totalInvested += inv.amount_invested ?? 0
    summary.totalProfit   += inv.net_return ?? 0
    summary.totalValue    += inv.current_value ?? 0
  }

  for (const p of projects.data) {
    if (p.status === 'active')   summary.activeProjects++
    if (p.status === 'upcoming') summary.upcomingProjects++
  }

  for (const a of cashflow.data) {
    if (a.type === 'loan_given'     && !a.is_settled) summary.loansGiven    += a.amount
    if (a.type === 'loan_received'  && !a.is_settled) summary.loansReceived += a.amount
    if (a.type === 'deposit')       summary.netCash += a.amount
    if (a.type === 'withdrawal')    summary.netCash -= a.amount
    if (a.type === 'loan_given')    summary.netCash -= a.amount
    if (a.type === 'loan_received') summary.netCash += a.amount
  }

  summary.returnPct = summary.totalInvested > 0
    ? (summary.totalProfit / summary.totalInvested) * 100
    : 0

  return {
    summary,
    projects,
    loading: projects.loading || cashflow.loading || investments.loading,
  }
}

// ── Expenses ──────────────────────────────────────────────────
export function useExpenses(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('project_expenses')
      .select('*')
      .eq('project_id', projectId)
      .order('expense_date', { ascending: false })
    if (error) throw error
    return data
  }, [projectId])
}

export async function createExpense(values) {
  const { error } = await supabase.from('project_expenses').insert(values)
  if (error) throw error
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('project_expenses').delete().eq('id', id)
  if (error) throw error
}

// ── Investor Payments (per-project ledger) ────────────────────
export function useInvestorPayments(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('investor_payment_history')
      .select('*')
      .eq('project_id', projectId)
      .order('payment_date', { ascending: false })
    if (error) throw error
    return data
  }, [projectId])
}

export async function createPayment(values) {
  const { error } = await supabase
    .from('investor_payments')
    .insert({ ...values, payment_date: isoDate(values.payment_date) })
  if (error) throw error
}

export async function deletePayment(id) {
  const { error } = await supabase.from('investor_payments').delete().eq('id', id)
  if (error) throw error
}

// ── My investments (as investor across all projects) ──────────
export function useMyInvestments() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('my_investments')
      .select('*')
      .order('project_name')
    if (error) throw error
    return data
  })
}
