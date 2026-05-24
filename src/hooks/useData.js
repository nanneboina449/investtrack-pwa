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
    // The investor_profit_summary view doesn't expose is_deleted, so we
    // fetch the soft-deleted ids in a parallel query and filter them out.
    // (Master Audit Phase C — Item 4: hard delete is RESTRICTed at the
    // FK level; soft-deleted investors must be hidden from all pickers.)
    const [summaryRes, deletedRes] = await Promise.all([
      supabase
        .from('investor_profit_summary')
        .select('*')
        .eq('project_id', projectId)
        .order('amount_invested', { ascending: false }),
      supabase
        .from('investors')
        .select('id')
        .eq('project_id', projectId)
        .eq('is_deleted', true),
    ])
    if (summaryRes.error) throw summaryRes.error
    const deletedIds = new Set((deletedRes.data ?? []).map(r => r.id))
    return (summaryRes.data ?? []).filter(r => !deletedIds.has(r.investor_id))
  }, [projectId])
}

export async function createInvestor(values) {
  const { error } = await supabase.from('investors').insert(values)
  if (error) throw error
}

// Phase C: investor.id is referenced by ledger tables (investor_payments,
// loan_contributions, profit_distributions) with ON DELETE RESTRICT. A
// hard delete would error and lose ledger history. Try a hard delete first
// (clean case when investor has no rows yet); if the FK trips, fall back
// to a soft delete by flipping is_deleted=true so the UI hides them.
export async function deleteInvestor(id) {
  const hard = await supabase.from('investors').delete().eq('id', id)
  if (!hard.error) return { mode: 'hard' }

  // 23503 = foreign_key_violation → dependents exist, switch to soft delete.
  if (hard.error.code === '23503') {
    const soft = await supabase
      .from('investors')
      .update({ is_deleted: true })
      .eq('id', id)
    if (soft.error) throw soft.error
    return { mode: 'soft' }
  }
  throw hard.error
}

export async function updateInvestor(id, values) {
  const { error } = await supabase.from('investors').update(values).eq('id', id)
  if (error) throw error
}

// Update a PERSON across every project they're on. Treats investors
// with the same normalized name (lowercase + whitespace collapsed) as
// the same person and propagates email/phone/displayName updates to
// every matching row. RLS may reject rows the user can't edit; we
// silently skip those and report the count actually updated.
//
// Used by /investors — the central contact-details management screen.
export async function updatePerson({ currentName, newName, email, phone }) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const key = norm(currentName)
  if (!key) throw new Error('currentName is required')

  // Find every row matching the current normalized name (RLS-scoped)
  const { data: rows, error: findErr } = await supabase
    .from('investors')
    .select('id, name')
    .eq('is_deleted', false)
  if (findErr) throw findErr
  const targetIds = (rows ?? [])
    .filter(r => norm(r.name) === key)
    .map(r => r.id)
  if (targetIds.length === 0) {
    throw new Error(`No investor records found for "${currentName}"`)
  }

  // Build the patch — only include fields the caller actually wants to
  // change. `email`/`phone` of '' (empty string) is treated as "clear it"
  // and stored as null; null/undefined means "don't touch".
  const patch = {}
  if (newName !== undefined && newName !== null && newName.trim() !== '') {
    patch.name = newName.trim()
  }
  if (email !== undefined && email !== null) {
    patch.email = email.trim() === '' ? null : email.trim()
  }
  if (phone !== undefined && phone !== null) {
    patch.phone = phone.trim() === '' ? null : phone.trim()
  }
  if (Object.keys(patch).length === 0) {
    return { updated: 0 }
  }

  // .select() forces PostgREST to return the rows that were actually
  // updated, so we can verify the count matches our intent. Without
  // it, a missing or restrictive RLS UPDATE policy will silently match
  // zero rows and the caller would see "0 updated" with no error —
  // exactly the bug fix_investors_update_rls.sql addresses.
  const { data: updated, error: updErr } = await supabase
    .from('investors')
    .update(patch)
    .in('id', targetIds)
    .select('id')
  if (updErr) throw updErr
  const count = updated?.length ?? 0
  if (count === 0) {
    // Distinguish RLS denial from "nothing matched" by checking
    // whether the SELECT-side worked (targetIds came from a fresh
    // select, so the rows DO exist). Zero updated here can only mean
    // the UPDATE policy is missing or denying.
    throw new Error(
      `Update was silently rejected by the database — most likely the ` +
      `investors_update RLS policy is missing. Run ` +
      `supabase/fix_investors_update_rls.sql in the Supabase SQL editor.`
    )
  }
  return { updated: count }
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

export async function recordRepayment({ loanId, amount, type, toProjectId, date, notes, destInvestorMap }) {
  // Audit Phase B: when type=project_adjustment and we know the
  // contributor → destination investor mapping by UUID, pass it through
  // so the RPC can skip name matching. The frontend builds this map by
  // joining loan_contributions to the destination project's investors.
  const { error } = await supabase.rpc('process_loan_repayment', {
    p_loan_id:            loanId,
    p_amount:             amount,
    p_type:               type,
    p_to_project_id:      toProjectId ?? null,
    p_date:               isoDate(date),
    p_notes:              notes ?? null,
    p_dest_investor_map:  destInvestorMap ?? null,
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
  // FK on investor_payments.cash_adjustment_id is now ON DELETE RESTRICT
  // (Audit Phase B). The delete_cash_adjustment RPC does the explicit
  // teardown inside a transaction: payments first, then the
  // cash_adjustment itself (which cascades to loan_contributions and
  // loan_repayments via their own FKs).
  const { error } = await supabase.rpc('delete_cash_adjustment', { p_id: id })
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

export async function reallocateInvestorPosition({ sourceInvestorId, destProjectId, destInvestorId, amount, date, notes }) {
  const { data, error } = await supabase.rpc('reallocate_investor_position', {
    p_source_investor_id: sourceInvestorId,
    p_dest_project_id:    destProjectId,
    p_amount:             amount,
    p_date:               isoDate(date),
    p_notes:              notes ?? null,
    p_dest_investor_id:   destInvestorId ?? null,
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
// Phase C: filter out soft-deleted investors so pickers can't pick them.
export function useAllInvestors() {
  return useFetch(async () => {
    const { data, error } = await supabase
      .from('investors')
      .select('id, project_id, name, share_percent, amount_invested')
      .eq('is_deleted', false)
      .order('name')
    if (error) throw error
    return data ?? []
  })
}

// Manage Investors page hook — fetches every investor record (including
// email, soft-delete status) and joins the project name client-side so
// the UI can group by project. Includes soft-deleted rows when
// includeDeleted=true (the Investors page has a toggle for that).
export function useAllInvestorsAdmin(includeDeleted = false) {
  return useFetch(async () => {
    const [invsRes, projsRes] = await Promise.all([
      supabase.from('investors')
        .select('id, project_id, name, email, phone, share_percent, amount_invested, is_deleted, created_at')
        .order('name'),
      supabase.from('my_projects').select('id, name, status'),
    ])
    if (invsRes.error) throw invsRes.error
    const projById = {}
    for (const p of (projsRes.data ?? [])) projById[p.id] = p

    return (invsRes.data ?? [])
      .filter(i => includeDeleted ? true : !i.is_deleted)
      .map(i => ({
        ...i,
        project_name:   projById[i.project_id]?.name   ?? '(no access)',
        project_status: projById[i.project_id]?.status ?? null,
      }))
      // Drop rows for projects RLS hid from us — those won't appear in
      // my_projects so project_name comes back '(no access)'.
      .filter(i => i.project_name !== '(no access)')
  }, [includeDeleted])
}

// ── Cross-project investor summary (for the owner's dashboard) ──
// Aggregates every investor record visible to the user, groups by name,
// and computes their consolidated position across all projects.
export function useAllInvestorsSummary() {
  return useFetch(async () => {
    const [investorsRes, paymentsRes, distributionsRes, expensesRes, projectsRes,
           loanContribsRes, loanCashRes, repayDistRes, loanRepayRes] = await Promise.all([
      // Phase C: exclude soft-deleted investors from the dashboard summary
      // (their historical rows remain queryable for audit, but they don't
      // contribute to the consolidated portfolio view).
      supabase.from('investors').select('id, project_id, name, share_percent, amount_invested').eq('is_deleted', false),
      supabase.from('investor_payments').select('investor_id, amount, payment_type, source_project_id, source_investor_id, destination_project_id, destination_investor_id, cash_adjustment_id'),
      supabase.from('profit_distributions').select('investor_id, amount'),
      supabase.from('project_expenses').select('project_id, amount'),
      supabase.from('my_projects').select('id, name, status'),
      supabase.from('loan_contributions').select('id, loan_id, investor_id, amount'),
      supabase.from('cash_adjustments').select('id, amount, interest_rate_percent, is_settled, type, counterparty'),
      supabase.from('repayment_distributions').select('loan_contribution_id, amount_returned'),
      supabase.from('loan_repayments').select('loan_id, amount'),
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

    // Audit BUG 3 fix: loans I RECEIVED still outstanding (payable).
    // For each top_up payment linked to a cash_adjustment_id where the
    // loan isn't settled, the borrower owes the principal + interest
    // share back. Subtract from their running balance.
    const repaidByLoan = {}
    for (const lr of (loanRepayRes.data ?? [])) {
      repaidByLoan[lr.loan_id] = (repaidByLoan[lr.loan_id] ?? 0) + Number(lr.amount || 0)
    }
    const loansReceivedByInv = {}
    for (const p of (paymentsRes.data ?? [])) {
      if (p.payment_type !== 'top_up' || !p.cash_adjustment_id) continue
      const loan = loanCaById[p.cash_adjustment_id]
      if (!loan || loan.is_settled) continue
      const interest = Number(loan.interest_rate_percent || 0)
      const expectedBack = Number(p.amount || 0) * (1 + interest / 100)
      // Approximate: borrower's share of repayments. Since this borrower
      // borrowed amount p.amount out of total contributions = loan.amount,
      // their portion of any repayment is (p.amount / loan.amount) × repaid.
      const totalLoan = Number(loan.amount || 0)
      const totalRepaid = repaidByLoan[p.cash_adjustment_id] ?? 0
      const borrowerShareRepaid = totalLoan > 0 ? (Number(p.amount) / totalLoan) * totalRepaid : 0
      const outstanding = Math.max(0, expectedBack - borrowerShareRepaid)
      loansReceivedByInv[p.investor_id] = (loansReceivedByInv[p.investor_id] ?? 0) + outstanding
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
      const loansReceived = loansReceivedByInv[inv.id] ?? 0
      // Total out-of-pocket cash this person contributed via this investor
      // record — share_contributions + top_ups without source + expense_paid.
      // Internal moves (top_up with source) are NOT counted because that
      // money was already contributed elsewhere.
      const cashContributed = (paymentsRes.data ?? [])
        .filter(p => p.investor_id === inv.id
          && p.payment_type !== 'refund'
          && !(p.payment_type === 'top_up' && p.source_project_id))
        .reduce((s, p) => s + Number(p.amount || 0), 0)
      // Wallet balance — external refunds received (no destination set) MINUS
      // external cash deployed back via fresh contributions. Positive means
      // they have cash on hand that hasn't been redeployed to a project.
      const walletDeposits = (paymentsRes.data ?? [])
        .filter(p => p.investor_id === inv.id
          && p.payment_type === 'refund'
          && !p.destination_project_id && !p.destination_investor_id)
        .reduce((s, p) => s + Number(p.amount || 0), 0)

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
        cashIn, cashBack, loansGiven, loansReceived,
        cashContributed, walletDeposits,
      })
    }

    return Object.values(byName).map(g => {
      const totals = g.projects.reduce((a, p) => ({
        committed:        a.committed        + p.committed,
        paid:             a.paid             + p.paid,
        profit:           a.profit           + p.profit,
        expense_share:    a.expense_share    + p.expense_share,
        outstanding:      a.outstanding      + p.outstanding,
        netGain:          a.netGain          + p.netGain,
        cashIn:           a.cashIn           + p.cashIn,
        cashBack:         a.cashBack         + p.cashBack,
        loansGiven:       a.loansGiven       + p.loansGiven,
        loansReceived:    a.loansReceived    + (p.loansReceived ?? 0),
        cashContributed:  a.cashContributed  + (p.cashContributed ?? 0),
        walletDeposits:   a.walletDeposits   + (p.walletDeposits ?? 0),
      }), { committed:0, paid:0, profit:0, expense_share:0, outstanding:0, netGain:0, cashIn:0, cashBack:0, loansGiven:0, loansReceived:0, cashContributed:0, walletDeposits:0 })
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
      // Running Balance (audit BUG 3 fix included): subtract outstanding
      // loans the user RECEIVED so borrowed cash doesn't inflate their
      // portfolio. The borrowed amount sits in paid_net (positive top_up)
      // but they owe it back, so loansReceived offsets it.
      totals.runningBalance =
        totals.profit
        - totals.expense_share
        + totals.paid
        + totals.loansGiven
        - totals.loansReceived
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

// ── My Portfolio (strictly the logged-in user's data) ─────────
// Aggregates everything for one person:
//   - their projects (current value per project)
//   - loans they GAVE that are still outstanding (assets / receivable)
//   - loans they RECEIVED that are still outstanding (liabilities / payable)
//   - the timeline of every event on their investor records (for AreaChart)
//
// Identification rule: per investtrack_portfolio_ui_spec.pdf, match
// investors rows on EXACT name + email — i.e. the row's email matches
// auth.email() AND the row's name matches user_metadata.full_name. If
// the user's name metadata isn't set, falls back to email-only so the
// screen still works (with a debug warning).
//
// Options:
//   allowNameFallback (default false) — adds a tier-3 fallback that
//     matches by name alone when no records have the user's email yet.
//     Used by /portfolio/explain so the breakdown is visible even
//     before the user runs the RLS fix and links their email.
export function useMyPortfolio({ allowNameFallback = false } = {}) {
  return useFetch(async () => {
    // 1. Identify the logged-in user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const myEmail = norm(user.email)
    const myName  = norm(user.user_metadata?.full_name)
    if (!myEmail) return null

    // 2. Pull every investor row + projects the user owns. RLS already
    // restricts to projects the user can see; we further filter to rows
    // whose email (and ideally name) match the logged-in identity.
    const [allInvestorsRes, projectsRes, ownedProjectsRes] = await Promise.all([
      supabase.from('investors')
        .select('id, project_id, name, email, share_percent, amount_invested, is_deleted'),
      supabase.from('my_projects').select('id, name, status, total_value, our_stake_percent, user_id'),
      // Projects this user owns (auth.uid matches projects.user_id). Used as
      // a fallback display when they own projects but haven't added themselves
      // as an investor — the empty state surfaces "Projects you own" with a
      // prompt to set up an investor record, rather than a dead-end message.
      supabase.from('projects').select('id, name, status').eq('user_id', user.id),
    ])
    if (allInvestorsRes.error) throw allInvestorsRes.error

    const projectMap = {}
    for (const p of (projectsRes.data ?? [])) projectMap[p.id] = p
    const ownedProjects = ownedProjectsRes.data ?? []

    // Two-tier email-based matching (no name-only auto-match — too risky
    // when two distinct people on the platform share a name):
    //   1. strict        — email AND name both match (preferred)
    //   2. email-only    — drop the name check (handles name drift on a
    //                      record that already has the user's email)
    //   3. none          — render empty state pointing the user at the
    //                      /investors tab to add their email to their
    //                      person record. updatePerson() broadcasts the
    //                      email change across every project they're on,
    //                      so a single edit there unblocks this screen.
    const ownedProjectIds = new Set(ownedProjects.map(p => p.id))
    const allInvs = allInvestorsRes.data ?? []
    const candidatesByEmail = allInvs.filter(i =>
      !i.is_deleted && norm(i.email) === myEmail
    )
    const candidatesByName = myName
      ? allInvs.filter(i => !i.is_deleted && norm(i.name) === myName)
      : []
    const strictMatches = candidatesByEmail.filter(i =>
      !myName || norm(i.name) === myName
    )

    let myRecords = []
    let matchMode = 'none'
    if (strictMatches.length > 0) {
      myRecords = strictMatches
      matchMode = myName ? 'strict' : 'email-only-no-metadata-name'
    } else if (candidatesByEmail.length > 0) {
      myRecords = candidatesByEmail
      matchMode = 'loose-email-only'
    } else if (allowNameFallback && candidatesByName.length > 0) {
      // Opt-in: used by /portfolio/explain so the breakdown is
      // visible before the user links their email in /investors.
      myRecords = candidatesByName
      matchMode = 'loose-name-only'
    }

    if (myRecords.length === 0) {
      // Claim candidates: every investor row on a project the user owns
      // that isn't already linked to a different live user's email. The
      // user can pick whichever row is "them" and click to attach their
      // email. We sort so name-matches float to the top.
      const claimCandidates = allInvs
        .filter(i => !i.is_deleted && ownedProjectIds.has(i.project_id))
        .map(i => ({
          id: i.id,
          project_id: i.project_id,
          project_name: ownedProjects.find(p => p.id === i.project_id)?.name ?? '?',
          name: i.name,
          share_percent: Number(i.share_percent || 0),
          current_email: i.email ?? null,
          name_matches: myName && norm(i.name) === myName,
        }))
        .sort((a, b) =>
          (b.name_matches ? 1 : 0) - (a.name_matches ? 1 : 0)
          || a.project_name.localeCompare(b.project_name)
        )

      return {
        identity: { email: user.email, name: user.user_metadata?.full_name ?? null },
        empty: true,
        matchMode,
        claimCandidates,                              // investor rows on owned projects
        ownedProjects: ownedProjects.map(p => ({      // projects (so we can still link out)
          project_id: p.id, name: p.name, status: p.status,
        })),
        runningBalance: 0, netReturn: 0, invested: 0, realizedProfit: 0, totalExpenses: 0,
        projects: [], loansGiven: [], loansReceived: [], timeline: [],
      }
    }

    const myIds = myRecords.map(r => r.id)
    const myProjectIds = [...new Set(myRecords.map(r => r.project_id))]

    // 3. Fetch only what's needed for these records
    const [paymentsRes, distributionsRes, expensesRes, loanContribsRes,
           loanCashRes, repayDistRes, loanRepayRes] = await Promise.all([
      supabase.from('investor_payments')
        .select('id, investor_id, project_id, amount, payment_type, payment_date, notes, source_project_id, destination_project_id, destination_investor_id, cash_adjustment_id, expense_id')
        .in('investor_id', myIds),
      supabase.from('profit_distributions')
        .select('id, investor_id, amount, profit_id, profit_records!inner(record_date, project_id)')
        .in('investor_id', myIds),
      // Expense shares: need all expenses on the projects I'm in
      supabase.from('project_expenses')
        .select('id, project_id, amount, expense_date, description, category')
        .in('project_id', myProjectIds),
      supabase.from('loan_contributions')
        .select('id, loan_id, investor_id, project_id, amount')
        .in('investor_id', myIds),
      supabase.from('cash_adjustments')
        .select('id, amount, interest_rate_percent, is_settled, type, counterparty, adjustment_date'),
      supabase.from('repayment_distributions').select('loan_contribution_id, amount_returned'),
      supabase.from('loan_repayments').select('loan_id, amount'),
    ])

    const loanById = {}
    for (const l of (loanCashRes.data ?? [])) loanById[l.id] = l

    // 4. Headline aggregates
    let profitTotal = 0
    for (const d of (distributionsRes.data ?? [])) profitTotal += Number(d.amount || 0)

    let expenseTotal = 0
    const expenseByProject = {}
    for (const e of (expensesRes.data ?? [])) {
      expenseByProject[e.project_id] = (expenseByProject[e.project_id] ?? 0) + Number(e.amount || 0)
    }
    for (const rec of myRecords) {
      const share = Number(rec.share_percent || 0) / 100
      expenseTotal += (expenseByProject[rec.project_id] ?? 0) * share
    }

    // Net cash paid (positive = money out of wallet into projects; refund subtracts)
    let paidNet = 0
    let cashContributed = 0  // external cash deployed (excludes internal moves)
    let cashBack = 0         // external cash returned (refund without destination)
    for (const p of (paymentsRes.data ?? [])) {
      const amt = Number(p.amount || 0)
      const sign = p.payment_type === 'refund' ? -1 : 1
      paidNet += sign * amt
      if (p.payment_type === 'refund') {
        if (!p.destination_project_id) cashBack += amt
      } else {
        const isInternalMove = p.payment_type === 'top_up' && !!p.source_project_id
        if (!isInternalMove) cashContributed += amt
      }
    }

    // Loans GIVEN (assets / receivables)
    const repaidByContrib = {}
    for (const rd of (repayDistRes.data ?? [])) {
      repaidByContrib[rd.loan_contribution_id] =
        (repaidByContrib[rd.loan_contribution_id] ?? 0) + Number(rd.amount_returned || 0)
    }
    const loansGiven = []
    let loansGivenOutstanding = 0
    for (const lc of (loanContribsRes.data ?? [])) {
      const loan = loanById[lc.loan_id]
      if (!loan) continue
      const interest = Number(loan.interest_rate_percent || 0)
      const expected = Number(lc.amount || 0) * (1 + interest / 100)
      const repaid   = repaidByContrib[lc.id] ?? 0
      const outstanding = Math.max(0, expected - repaid)
      if (loan.is_settled || outstanding <= 0.01) continue
      loansGivenOutstanding += outstanding
      loansGiven.push({
        id: lc.id,
        loan_id: loan.id,
        counterparty: loan.counterparty || '—',
        date: loan.adjustment_date,
        principal: Number(lc.amount || 0),
        interest_pct: interest,
        outstanding,
      })
    }

    // Loans RECEIVED (liabilities / payables)
    const repaidByLoan = {}
    for (const lr of (loanRepayRes.data ?? [])) {
      repaidByLoan[lr.loan_id] = (repaidByLoan[lr.loan_id] ?? 0) + Number(lr.amount || 0)
    }
    const loansReceived = []
    let loansReceivedOutstanding = 0
    for (const p of (paymentsRes.data ?? [])) {
      if (p.payment_type !== 'top_up' || !p.cash_adjustment_id) continue
      const loan = loanById[p.cash_adjustment_id]
      if (!loan || loan.is_settled) continue
      const interest = Number(loan.interest_rate_percent || 0)
      const expectedBack = Number(p.amount || 0) * (1 + interest / 100)
      const totalLoan = Number(loan.amount || 0)
      const totalRepaid = repaidByLoan[p.cash_adjustment_id] ?? 0
      const borrowerShareRepaid = totalLoan > 0
        ? (Number(p.amount) / totalLoan) * totalRepaid : 0
      const outstanding = Math.max(0, expectedBack - borrowerShareRepaid)
      if (outstanding <= 0.01) continue
      loansReceivedOutstanding += outstanding
      loansReceived.push({
        id: p.id,
        loan_id: loan.id,
        counterparty: loan.counterparty || '—',
        date: loan.adjustment_date,
        principal: Number(p.amount || 0),
        interest_pct: interest,
        outstanding,
      })
    }

    // Per-project breakdown (asset cards)
    const projectsRollup = {}
    for (const rec of myRecords) {
      const proj = projectMap[rec.project_id]
      if (!proj) continue
      const share = Number(rec.share_percent || 0) / 100
      const myProfit  = (distributionsRes.data ?? [])
        .filter(d => d.investor_id === rec.id)
        .reduce((s, d) => s + Number(d.amount || 0), 0)
      const myExpense = (expenseByProject[rec.project_id] ?? 0) * share
      const myPaidNet = (paymentsRes.data ?? [])
        .filter(p => p.investor_id === rec.id)
        .reduce((s, p) => s + (p.payment_type === 'refund' ? -1 : 1) * Number(p.amount || 0), 0)
      const currentValue = myPaidNet + myProfit - myExpense
      if (!projectsRollup[rec.project_id]) {
        projectsRollup[rec.project_id] = {
          project_id: rec.project_id,
          name: proj.name,
          status: proj.status,
          share_percent: Number(rec.share_percent || 0),
          invested: 0, profit: 0, expense: 0, currentValue: 0,
        }
      }
      const r = projectsRollup[rec.project_id]
      r.invested     += myPaidNet
      r.profit       += myProfit
      r.expense      += myExpense
      r.currentValue += currentValue
    }
    const projects = Object.values(projectsRollup)
      .sort((a, b) => b.currentValue - a.currentValue)

    // Hero running balance — same formula as the project-owner Dashboard,
    // restricted to this person's records.
    const runningBalance = profitTotal - expenseTotal + paidNet
      + loansGivenOutstanding - loansReceivedOutstanding

    // 5. Timeline for the AreaChart and ledger view
    const projectNameById = {}
    for (const p of (projectsRes.data ?? [])) projectNameById[p.id] = p.name
    const rows = []
    for (const p of (paymentsRes.data ?? [])) {
      const signed = p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)
      let label = 'Payment'
      if (p.payment_type === 'share_contribution') label = 'Capital Contribution'
      else if (p.payment_type === 'top_up' && p.source_project_id) label = 'Capital Reallocation (in)'
      else if (p.payment_type === 'top_up')   label = 'Top-up'
      else if (p.payment_type === 'refund' && p.destination_project_id) label = 'Capital Reallocation (Move)'
      else if (p.payment_type === 'refund')   label = 'Refund'
      else if (p.payment_type === 'expense_paid') label = 'Expense Paid'
      rows.push({
        kind: 'payment',
        type: p.payment_type,
        date: p.payment_date,
        amount: signed,
        label,
        sub: projectNameById[p.project_id] ?? '',
        notes: p.notes ?? null,
      })
    }
    for (const d of (distributionsRes.data ?? [])) {
      const pr = d.profit_records
      if (!pr) continue
      rows.push({
        kind: 'profit',
        type: 'profit_distribution',
        date: pr.record_date,
        amount: Number(d.amount),
        label: 'Profit Distribution',
        sub: projectNameById[pr.project_id] ?? '',
      })
    }
    for (const e of (expensesRes.data ?? [])) {
      if (!myProjectIds.includes(e.project_id)) continue
      const rec = myRecords.find(r => r.project_id === e.project_id)
      if (!rec) continue
      const share = Number(rec.share_percent || 0) / 100
      const allocated = Number(e.amount || 0) * share
      if (allocated === 0) continue
      rows.push({
        kind: 'expense',
        type: 'expense_share',
        date: e.expense_date,
        amount: -allocated,
        label: 'Expense Absorbed',
        sub: e.description || e.category || '',
      })
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    let running = 0
    for (const r of rows) { running += r.amount; r.running = running }

    return {
      identity: { email: user.email, name: user.user_metadata?.full_name ?? null },
      empty: false,
      matchMode,                              // 'strict' | 'loose-email-only' | 'email-only-no-metadata-name'
      ownedProjects: ownedProjects.map(p => ({ project_id: p.id, name: p.name, status: p.status })),
      runningBalance,
      netReturn: profitTotal - expenseTotal,
      invested: cashContributed - cashBack,  // net out of pocket
      realizedProfit: profitTotal,
      totalExpenses: expenseTotal,
      projects,
      loansGiven,
      loansReceived,
      timeline: rows,
    }
  }, [allowNameFallback])
}
