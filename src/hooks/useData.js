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

export async function deleteCashAdjustment(id) {
  // Pre-fetch loan metadata so we can clean up the inter-investor linked
  // investor_payments rows (refund on lender + top_up on borrower) that
  // were created by transfer_funds_as_loan. cash_adjustments has no FK
  // to investor_payments, so we match by amount + date + the source/
  // destination investor ids on the contribution side.
  const { data: ca } = await supabase
    .from('cash_adjustments')
    .select('id, type, amount, adjustment_date, from_project_id, counterparty')
    .eq('id', id).single()

  if (ca?.type === 'loan_given') {
    const { data: contribs } = await supabase
      .from('loan_contributions')
      .select('investor_id, amount')
      .eq('loan_id', id)

    for (const c of (contribs ?? [])) {
      // Best-effort delete of paired inter-investor payment rows:
      // - refund on the contributor (lender) with matching amount + date
      // - top_up on the borrower (we don't know their investor_id here
      //   directly, so match by source_investor_id = lender + amount + date)
      await supabase.from('investor_payments').delete()
        .eq('investor_id',      c.investor_id)
        .eq('payment_type',     'refund')
        .eq('amount',           c.amount)
        .eq('payment_date',     ca.adjustment_date)
        .not('destination_investor_id', 'is', null)
      await supabase.from('investor_payments').delete()
        .eq('source_investor_id', c.investor_id)
        .eq('payment_type',       'top_up')
        .eq('amount',             c.amount)
        .eq('payment_date',       ca.adjustment_date)
    }
  }

  // Cascade handles loan_contributions and loan_repayments via FK
  const { error } = await supabase.from('cash_adjustments').delete().eq('id', id)
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
    // Plain select — don't embed `investors(...)` because investor_payments
    // has 3 FK columns to investors (investor_id, source_investor_id,
    // destination_investor_id) and PostgREST can't disambiguate them.
    // The UI looks up investor_name from the parent's investors list.
    const { data, error } = await supabase
      .from('investor_payments')
      .select('*')
      .eq('project_id', projectId)
      .order('payment_date', { ascending: false })
    if (error) throw error
    if (!data || data.length === 0) return []

    // Fetch linked expense info separately so the Payments tab can show
    // "Paid X expense" descriptions for expense_paid rows.
    const expenseIds = [...new Set(data.map(p => p.expense_id).filter(Boolean))]
    let expenseMap = {}
    if (expenseIds.length > 0) {
      const { data: exps } = await supabase
        .from('project_expenses')
        .select('id, category, description')
        .in('id', expenseIds)
      expenseMap = Object.fromEntries((exps ?? []).map(e => [e.id, e]))
    }

    return data.map(r => ({
      ...r,
      expense_category:    expenseMap[r.expense_id]?.category    ?? null,
      expense_description: expenseMap[r.expense_id]?.description ?? null,
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

export async function transferFundsAsLoan({ sourceInvestorId, destInvestorId, amount, interestPct, date, notes }) {
  const { data, error } = await supabase.rpc('transfer_funds_as_loan', {
    p_source_investor_id: sourceInvestorId,
    p_dest_investor_id:   destInvestorId,
    p_amount:             amount,
    p_interest_pct:       interestPct ?? 0,
    p_date:               isoDate(date),
    p_notes:              notes ?? null,
  })
  if (error) throw error
  return data
}

// Chronological cross-project ledger for one person — every transaction
// (payment, profit distribution, expense allocation) that involved any
// of their investor records, sorted by date, with a running portfolio
// value computed on the way through.
export function useInvestorLedger(investorIds) {
  return useFetch(async () => {
    if (!investorIds || investorIds.length === 0) return []
    const [paymentsRes, distRes, expensesRes, investorsRes, projectsRes] = await Promise.all([
      supabase.from('investor_payments')
        .select('id, investor_id, project_id, amount, payment_type, payment_date, notes, source_project_id, destination_project_id, expense_id')
        .in('investor_id', investorIds),
      supabase.from('profit_distributions')
        .select('id, investor_id, amount, profit_id, profit_records!inner(record_date, project_id)')
        .in('investor_id', investorIds),
      // Expense shares: need each of this person's investor records and
      // each project's expenses; we'll join in JS.
      supabase.from('project_expenses').select('id, project_id, amount, expense_date, description, category'),
      supabase.from('investors').select('id, project_id, share_percent').in('id', investorIds),
      supabase.from('my_projects').select('id, name'),
    ])
    const projectNameById = {}
    for (const p of (projectsRes.data ?? [])) projectNameById[p.id] = p.name
    const sharePctByRec = {}
    for (const i of (investorsRes.data ?? [])) sharePctByRec[i.id] = Number(i.share_percent || 0)
    const projectIdsOfPerson = new Set((investorsRes.data ?? []).map(i => i.project_id))

    const rows = []
    // Payments
    for (const p of (paymentsRes.data ?? [])) {
      const signed = p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)
      rows.push({
        date: p.payment_date,
        project_id: p.project_id,
        project_name: projectNameById[p.project_id] ?? '?',
        type: p.payment_type,
        amount: signed,
        notes: p.notes,
        link_from: p.source_project_id ? projectNameById[p.source_project_id] : null,
        link_to:   p.destination_project_id ? projectNameById[p.destination_project_id] : null,
        kind: 'payment',
      })
    }
    // Profit distributions
    for (const d of (distRes.data ?? [])) {
      const pr = d.profit_records
      if (!pr) continue
      rows.push({
        date: pr.record_date,
        project_id: pr.project_id,
        project_name: projectNameById[pr.project_id] ?? '?',
        type: 'profit_distribution',
        amount: Number(d.amount),
        kind: 'profit',
      })
    }
    // Expense share allocations (per investor record in projects they're in)
    for (const e of (expensesRes.data ?? [])) {
      if (!projectIdsOfPerson.has(e.project_id)) continue
      // Find the investor record this person has in that project
      const inv = (investorsRes.data ?? []).find(i => i.project_id === e.project_id)
      if (!inv) continue
      const share = (sharePctByRec[inv.id] ?? 0) / 100
      const allocated = Number(e.amount || 0) * share
      if (allocated === 0) continue
      rows.push({
        date: e.expense_date,
        project_id: e.project_id,
        project_name: projectNameById[e.project_id] ?? '?',
        type: 'expense_share',
        amount: -allocated,
        notes: e.description,
        kind: 'expense',
      })
    }

    // Sort by date, then by kind for stable order
    rows.sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return 1
      return 0
    })

    // Running portfolio value: profit + cash net for this person.
    // Internal moves (refund with destination + matching top_up with source)
    // are emitted as separate rows but their effect on the running total
    // depends on whether both legs are in this person's records. For the
    // ledger view, we keep running total = profit minus expenses plus paid
    // (refunds subtract); that mirrors the dashboard's Running Balance.
    let running = 0
    for (const r of rows) {
      if (r.kind === 'expense' || r.kind === 'profit') running += r.amount
      else running += r.amount
      r.running = running
    }
    return rows
  }, [JSON.stringify(investorIds ?? [])])
}

// All investor records visible to the current user (across projects),
// used for the inter-investor lending picker.
export function useAllInvestors() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('investors')
      .select('id, project_id, name, share_percent, amount_invested')
      .order('name')
    if (error) throw error
    return data ?? []
  })
}

// ── Cross-project investor summary (for the owner's dashboard) ──
// Aggregates every investor record visible to the user, groups by name,
// and computes their consolidated position across all projects.
export function useAllInvestorsSummary() {
  return useFetch(async () => {
    const [investorsRes, paymentsRes, distributionsRes, expensesRes, projectsRes,
           loanContribsRes, loanCashRes, repayDistRes] = await Promise.all([
      supabase.from('investors').select('id, project_id, name, share_percent, amount_invested'),
      supabase.from('investor_payments').select('investor_id, amount, payment_type, source_project_id, source_investor_id, destination_project_id, destination_investor_id'),
      supabase.from('profit_distributions').select('investor_id, amount'),
      supabase.from('project_expenses').select('project_id, amount'),
      supabase.from('my_projects').select('id, name, status'),
      supabase.from('loan_contributions').select('id, loan_id, investor_id, amount'),
      supabase.from('cash_adjustments').select('id, amount, interest_rate_percent, is_settled, type, counterparty'),
      supabase.from('repayment_distributions').select('loan_contribution_id, amount_returned'),
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

    // Loans I gave that are still outstanding (asset = receivable to me).
    // For each loan_contribution, expected return = amount × (1 + interest%/100).
    // Minus the portion already distributed back.
    const loanCaById = {}
    for (const ca of (loanCashRes.data ?? [])) loanCaById[ca.id] = ca
    const repaidByContrib = {}
    for (const rd of (repayDistRes.data ?? [])) {
      repaidByContrib[rd.loan_contribution_id] =
        (repaidByContrib[rd.loan_contribution_id] ?? 0) + Number(rd.amount_returned || 0)
    }
    const loansGivenByInv = {}
    for (const lc of (loanContribsRes.data ?? [])) {
      const loan = loanCaById[lc.loan_id]
      if (!loan || loan.is_settled) continue
      const interest = Number(loan.interest_rate_percent || 0)
      const expected = Number(lc.amount || 0) * (1 + interest / 100)
      const repaid   = repaidByContrib[lc.id] ?? 0
      const outstanding = Math.max(0, expected - repaid)
      loansGivenByInv[lc.investor_id] = (loansGivenByInv[lc.investor_id] ?? 0) + outstanding
    }

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
      const loansGiven    = loansGivenByInv[inv.id] ?? 0

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
        cashIn, cashBack, loansGiven,
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
        loansGiven:    a.loansGiven    + p.loansGiven,
      }), { committed:0, paid:0, profit:0, expense_share:0, outstanding:0, netGain:0, cashIn:0, cashBack:0, loansGiven:0 })
      // Running Balance — the single net position number the user
      // wants. Captures realized P&L, net cash flow, AND outstanding
      // loans-given as a receivable asset:
      //
      //   running_balance = profit              (income earned)
      //                   − expense_share       (cost absorbed)
      //                   + paid_net            (net cash settled)
      //                   + loans_given_outstanding  (receivables — money I'm owed back)
      //
      // Note: paid_net already nets inter-investor moves correctly
      // (a refund on me has no offsetting top_up on me when I'm
      // lending to a different person). Loans-given outstanding then
      // adds back the asset value so a lender doesn't look "down"
      // just because the loan hasn't been repaid yet.
      totals.runningBalance =
        totals.profit
        - totals.expense_share
        + totals.paid
        + totals.loansGiven
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
