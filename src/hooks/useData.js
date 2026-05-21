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
    const { data: projects, error } = await supabase
      .from('my_projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    if (!projects || projects.length === 0) return []

    // The my_projects view multiplies total_profit by num_investors and
    // total_raised by num_profit_records due to a Cartesian LEFT JOIN.
    // Until the view migration is applied (and even after, as a safety
    // net), recompute these totals client-side from the source tables.
    const ids = projects.map(p => p.id)
    const [profitsRes, invsRes, expensesRes] = await Promise.all([
      supabase.from('profit_records').select('project_id, amount').in('project_id', ids),
      supabase.from('investors').select('project_id, amount_invested').in('project_id', ids),
      supabase.from('project_expenses').select('project_id, amount').in('project_id', ids),
    ])

    const sumBy = (rows, col = 'amount') => {
      const m = {}
      for (const r of (rows ?? [])) {
        m[r.project_id] = (m[r.project_id] ?? 0) + Number(r[col] || 0)
      }
      return m
    }
    const profitMap   = sumBy(profitsRes.data)
    const raisedMap   = sumBy(invsRes.data, 'amount_invested')
    const expensesMap = sumBy(expensesRes.data)

    return projects.map(p => {
      const profit   = profitMap[p.id]   ?? 0
      const raised   = raisedMap[p.id]   ?? 0
      const expenses = expensesMap[p.id] ?? 0
      return {
        ...p,
        total_profit:   profit,
        total_raised:   raised,
        total_expenses: expenses,
        net_profit:     profit - expenses,
      }
    })
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

export async function updateInvestor(id, values) {
  const { error } = await supabase.from('investors').update(values).eq('id', id)
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

export async function updateProfitRecord(id, values) {
  // Fetch current amount to detect change so we can scale distributions
  const { data: prRow, error: prErr } = await supabase
    .from('profit_records').select('amount').eq('id', id).single()
  if (prErr) throw prErr

  const oldAmount = Number(prRow.amount || 0)
  const fields = {
    ...(values.amount      !== undefined ? { amount: values.amount } : {}),
    ...(values.record_date !== undefined ? { record_date: isoDate(values.record_date) } : {}),
    ...(values.notes       !== undefined ? { notes: values.notes } : {}),
  }
  const { error } = await supabase.from('profit_records').update(fields).eq('id', id)
  if (error) throw error

  // If amount changed, scale all profit_distributions for this record proportionally
  if (values.amount !== undefined && Number(values.amount) !== oldAmount && oldAmount > 0) {
    const ratio = Number(values.amount) / oldAmount
    const { data: dists } = await supabase
      .from('profit_distributions').select('id, amount').eq('profit_id', id)
    for (const d of (dists ?? [])) {
      await supabase.from('profit_distributions')
        .update({ amount: Math.round(Number(d.amount) * ratio * 100) / 100 })
        .eq('id', d.id)
    }
  }
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

export async function updateLoan(id, values) {
  // Allowed fields on a loan transaction. Contributions / repayments
  // aren't touched here — those are separate edits.
  const allow = ['description', 'counterparty', 'amount', 'interest_rate_percent', 'adjustment_date', 'notes']
  const fields = {}
  for (const k of allow) {
    if (values[k] !== undefined) {
      fields[k] = k === 'adjustment_date' ? isoDate(values[k]) : values[k]
    }
  }
  const { error } = await supabase.from('cash_adjustments').update(fields).eq('id', id)
  if (error) throw error
}

export async function updateCashAdjustment(id, values) {
  // Generic update for non-loan adjustments (deposit / withdrawal / reallocation)
  const allow = ['description', 'counterparty', 'amount', 'adjustment_date', 'notes']
  const fields = {}
  for (const k of allow) {
    if (values[k] !== undefined) {
      fields[k] = k === 'adjustment_date' ? isoDate(values[k]) : values[k]
    }
  }
  const { error } = await supabase.from('cash_adjustments').update(fields).eq('id', id)
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

export async function updateExpense(id, values) {
  // Sync the linked investor_payment when amount, paid_by, or date changes.
  const { data: oldRow, error: e1 } = await supabase
    .from('project_expenses')
    .select('amount, paid_by_investor_id, expense_date, category, description, project_id')
    .eq('id', id).single()
  if (e1) throw e1

  const fields = { ...values }
  if (fields.expense_date !== undefined) fields.expense_date = isoDate(fields.expense_date)
  const { error } = await supabase.from('project_expenses').update(fields).eq('id', id)
  if (error) throw error

  // Find the linked payment created by the expense-to-payment trigger
  const { data: linkedPayment } = await supabase
    .from('investor_payments').select('id').eq('expense_id', id).maybeSingle()

  const newPaidBy = values.paid_by_investor_id !== undefined ? values.paid_by_investor_id : oldRow.paid_by_investor_id
  const newAmount = values.amount !== undefined ? values.amount : oldRow.amount
  const newDate   = values.expense_date !== undefined ? isoDate(values.expense_date) : oldRow.expense_date

  if (linkedPayment && newPaidBy) {
    // Update the linked payment to match new values
    await supabase.from('investor_payments').update({
      investor_id:  newPaidBy,
      amount:       newAmount,
      payment_date: newDate,
    }).eq('id', linkedPayment.id)
  } else if (linkedPayment && !newPaidBy) {
    // Was paid by investor, now no payer — drop the payment
    await supabase.from('investor_payments').delete().eq('id', linkedPayment.id)
  } else if (!linkedPayment && newPaidBy) {
    // Was project-funded, now paid by an investor — create the payment
    await supabase.from('investor_payments').insert({
      investor_id:  newPaidBy,
      project_id:   oldRow.project_id,
      amount:       newAmount,
      payment_type: 'expense_paid',
      expense_id:   id,
      payment_date: newDate,
      notes:        'Paid expense (edited)',
    })
  }
}

// ── Investor Payments (per-project ledger) ────────────────────
export function useInvestorPayments(projectId) {
  return useFetch(async () => {
    if (!projectId) return []
    // Query the table directly so we can pull the link columns too
    // (the investor_payment_history view doesn't include them).
    const { data, error } = await supabase
      .from('investor_payments')
      .select('id, investor_id, project_id, amount, payment_type, payment_date, notes, expense_id, source_project_id, source_investor_id, destination_project_id, destination_investor_id, investors(name, share_percent), project_expenses(category, description)')
      .eq('project_id', projectId)
      .order('payment_date', { ascending: false })
    if (error) throw error
    // Flatten the embedded shapes so the UI keeps reading the same fields
    return (data ?? []).map(r => ({
      ...r,
      investor_name:       r.investors?.name ?? null,
      share_percent:       r.investors?.share_percent ?? null,
      expense_category:    r.project_expenses?.category ?? null,
      expense_description: r.project_expenses?.description ?? null,
    }))
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

export async function updatePayment(id, values) {
  // Safe to edit: amount, date, notes. payment_type is fixed; if you
  // need to change the type, delete and re-create.
  const allow = ['amount', 'payment_date', 'notes']
  const fields = {}
  for (const k of allow) {
    if (values[k] !== undefined) {
      fields[k] = k === 'payment_date' ? isoDate(values[k]) : values[k]
    }
  }
  const { error } = await supabase.from('investor_payments').update(fields).eq('id', id)
  if (error) throw error
}

// For a "move" (refund + linked top_up paired via destination/source columns),
// update both sides together. Pass the refund payment id; we'll find the
// matching top_up via the destination link.
export async function updateMove({ refundId, amount, notes, date }) {
  const { data: refund, error: e1 } = await supabase
    .from('investor_payments')
    .select('id, investor_id, project_id, destination_investor_id, destination_project_id')
    .eq('id', refundId).single()
  if (e1) throw e1
  if (!refund.destination_investor_id || !refund.destination_project_id) {
    throw new Error('This payment is not part of a linked move')
  }
  const { data: topup, error: e2 } = await supabase
    .from('investor_payments')
    .select('id')
    .eq('investor_id', refund.destination_investor_id)
    .eq('project_id', refund.destination_project_id)
    .eq('source_investor_id', refund.investor_id)
    .eq('source_project_id', refund.project_id)
    .maybeSingle()
  if (e2) throw e2

  const fields = {}
  if (amount !== undefined) fields.amount = amount
  if (notes  !== undefined) fields.notes = notes
  if (date   !== undefined) fields.payment_date = isoDate(date)

  if (Object.keys(fields).length === 0) return
  await supabase.from('investor_payments').update(fields).eq('id', refund.id)
  if (topup?.id) {
    await supabase.from('investor_payments').update(fields).eq('id', topup.id)
  }
}

export async function reallocateInvestorPosition({ sourceInvestorId, destProjectId, amount, date, notes }) {
  const { data, error } = await supabase.rpc('reallocate_investor_position', {
    p_source_investor_id: sourceInvestorId,
    p_dest_project_id:    destProjectId,
    p_amount:             amount,
    p_date:               isoDate(date),
    p_notes:              notes ?? null,
  })
  if (error) throw error
  return data
}

// ── Cross-project investor summary (for the owner's dashboard) ──
// Aggregates every investor record visible to the user, groups by name,
// and computes their consolidated position across all projects.
export function useAllInvestorsSummary() {
  return useFetch(async () => {
    const [investorsRes, paymentsRes, distributionsRes, expensesRes, projectsRes] = await Promise.all([
      supabase.from('investors').select('id, project_id, name, share_percent, amount_invested'),
      supabase.from('investor_payments').select('investor_id, amount, payment_type, source_project_id, destination_project_id'),
      supabase.from('profit_distributions').select('investor_id, amount'),
      supabase.from('project_expenses').select('project_id, amount'),
      supabase.from('my_projects').select('id, name, status'),
    ])

    if (investorsRes.error) throw investorsRes.error

    const paymentByInv = {}
    // External cash flow per investor: cash that genuinely left the
    // user's wallet OR came back externally (refunds without a
    // destination project). Internal moves (top_up with source / refund
    // with destination) cancel out across projects so they don't
    // change the user's true cash position.
    const cashInByInv      = {} // money out of wallet into projects (non-internal top-ups + share_contributions + expense_paid)
    const cashBackByInv    = {} // money returned externally (refund without destination)
    for (const p of (paymentsRes.data ?? [])) {
      const amt = Number(p.amount || 0)
      const sign = p.payment_type === 'refund' ? -1 : 1
      paymentByInv[p.investor_id] = (paymentByInv[p.investor_id] ?? 0) + sign * amt
      if (p.payment_type === 'refund') {
        // External cash back only when there's no destination project
        if (!p.destination_project_id) {
          cashBackByInv[p.investor_id] = (cashBackByInv[p.investor_id] ?? 0) + amt
        }
      } else {
        // top_up with source → reallocation, not new cash in
        const isInternalMove = p.payment_type === 'top_up' && !!p.source_project_id
        if (!isInternalMove) {
          cashInByInv[p.investor_id] = (cashInByInv[p.investor_id] ?? 0) + amt
        }
      }
    }
    const profitByInv = {}
    for (const d of (distributionsRes.data ?? [])) {
      profitByInv[d.investor_id] = (profitByInv[d.investor_id] ?? 0) + Number(d.amount || 0)
    }
    const expenseByProject = {}
    for (const e of (expensesRes.data ?? [])) {
      expenseByProject[e.project_id] = (expenseByProject[e.project_id] ?? 0) + Number(e.amount || 0)
    }
    const projectMap = {}
    for (const p of (projectsRes.data ?? [])) projectMap[p.id] = p

    const byName = {}
    for (const inv of (investorsRes.data ?? [])) {
      const proj = projectMap[inv.project_id]
      if (!proj) continue // only show projects the user can see
      const committed     = Number(inv.amount_invested || 0)
      const sharePct      = Number(inv.share_percent || 0)
      const paid          = paymentByInv[inv.id] ?? 0
      const profit        = profitByInv[inv.id] ?? 0
      const expense_share = ((expenseByProject[inv.project_id] ?? 0) * sharePct) / 100
      const outstanding   = committed + expense_share - paid
      const netGain       = profit - expense_share
      const cashIn        = cashInByInv[inv.id] ?? 0
      const cashBack      = cashBackByInv[inv.id] ?? 0

      // Normalize for grouping: lowercase, trim, collapse internal whitespace.
      // Display uses the first record's cleaned name.
      const cleaned = (inv.name || '').trim().replace(/\s+/g, ' ')
      const key = cleaned.toLowerCase()
      if (!key) continue
      if (!byName[key]) byName[key] = { name: cleaned, projects: [] }
      byName[key].projects.push({
        investor_id: inv.id,
        project_id:  inv.project_id,
        project_name: proj.name,
        project_status: proj.status,
        share_percent: sharePct,
        committed, paid, profit, expense_share, outstanding, netGain,
        cashIn, cashBack,
      })
    }

    return Object.values(byName).map(g => {
      const totals = g.projects.reduce((a, p) => ({
        committed:     a.committed     + p.committed,
        paid:          a.paid          + p.paid,
        profit:        a.profit        + p.profit,
        expense_share: a.expense_share + p.expense_share,
        outstanding:   a.outstanding   + p.outstanding,
        netGain:       a.netGain       + p.netGain,
        cashIn:        a.cashIn        + p.cashIn,
        cashBack:      a.cashBack      + p.cashBack,
      }), { committed:0, paid:0, profit:0, expense_share:0, outstanding:0, netGain:0, cashIn:0, cashBack:0 })
      // "Available balance" = realized profits + external cash returned - external cash put in
      //   Positive means the user is net positive in cash terms even before completed projects pay back.
      //   Negative means they still have capital deployed beyond what they've earned back.
      // Internal moves between their own projects don't change available — they net to zero.
      totals.available = totals.profit + totals.cashBack - totals.cashIn

      // Group projects by status so the donut can show active vs completed allocation
      const allocByStatus = g.projects.reduce((acc, p) => {
        const key = p.project_status || 'other'
        acc[key] = (acc[key] ?? 0) + p.paid
        return acc
      }, {})
      return { ...g, totals, allocByStatus, projectCount: g.projects.length }
    }).sort((a, b) => b.totals.committed - a.totals.committed)
  })
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
