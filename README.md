# InvestTrack PWA

A mobile-first Progressive Web App for tracking investments, profits, expenses, loans, and shared portfolios. Built with React + Vite + Tailwind + Supabase.

Version 1.2.0 · ₹ INR-first · © Vishwa Technologies Ltd

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
Create `.env` in the project root:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these from: [app.supabase.com](https://app.supabase.com) → Your Project → Settings → API.

If env vars are missing the app renders a self-explanatory **Setup Required** screen instead of crashing.

### 3. Set up the database
Run the bundled SQL in the Supabase SQL Editor:

1. `supabase/full_schema.sql` — full schema (projects, investors, profit_records, cash_adjustments, loan_contributions, project_expenses, project_members) plus all views and the `process_loan_repayment` RPC.

If you hit RLS errors or recursion after enabling sharing, the repo ships these recovery scripts (run them in order, only if needed):
- `supabase/fix_grants_v2.sql`
- `supabase/fix_recursion.sql`
- `supabase/fix_rls.sql`

### 4. Run locally
```bash
npm run dev
```
Open http://localhost:5173

### 5. Build for production
```bash
npm run build
npm run preview   # test the production build
```

---

## Deploy

### Vercel (recommended)
```bash
npm i -g vercel
vercel
```
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel dashboard. `vercel.json` is already configured for SPA routing.

### Netlify
```bash
npm run build
# drag the dist/ folder into Netlify
```

---

## Install as PWA

After deploying to HTTPS:
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: three-dot menu → Add to Home Screen / Install App
- **Desktop Chrome**: address bar install icon

Service worker (Workbox via `vite-plugin-pwa`) caches assets and Supabase responses for offline use.

---

## Project Structure

```
src/
├── main.jsx              ← Entry point + PWA registration
├── App.jsx               ← Router + auth guard + SetupScreen
├── contexts/
│   └── AuthContext.jsx   ← Supabase auth state
├── hooks/
│   ├── useData.js        ← Projects, investors, profits, loans, expenses, dashboard
│   └── useSharing.js     ← Project members, invites, roles
├── lib/
│   └── supabase.js       ← Supabase client + inr/pct/isoDate helpers
├── components/
│   ├── Layout.jsx        ← Bottom navigation
│   ├── InviteBanner.jsx  ← Pending-invite prompt on dashboard
│   ├── ShareModal.jsx    ← Invite-by-email + role management
│   └── ui/index.jsx      ← Sheet, StatCard, ShareBar, ProgressBar, Toast, Empty, …
├── pages/
│   ├── Auth.jsx          ← Sign in / sign up
│   ├── Dashboard.jsx     ← Portfolio overview + My Investments
│   ├── Projects.jsx      ← Projects list + Add
│   ├── ProjectDetail.jsx ← Investors, profits, expenses, sharing
│   ├── CashFlow.jsx      ← Loans, repayments, deposits, adjustments
│   └── Settings.jsx      ← Account, cache reset, app info
└── styles/
    └── index.css         ← Tailwind + custom components
supabase/                 ← SQL schema + RLS recovery scripts
scripts/
└── generate-icons.mjs    ← Regenerate PWA icons (npm run generate-icons)
```

---

## Features

### Projects & investors
- **Projects** — Active / Upcoming / Done tabs with total value and expected return.
- **Our stake %** — set what slice of a project's total value is yours; "investable pool" computes live in the Add Project sheet.
- **Multi-investor** — per-project investors with share %, auto-computed contribution amounts and a visual share-allocation bar.

### Profit, expenses & balances
- **Profit records** — auto-split to each investor by share %.
- **Expense tracking** — per-project expenses subtract from net return.
- **Running balance** — `invested + profit − expenses − loaned + repaid = effective balance` per investor.

### Cash flow & loans
- **5 transaction types** — loan given/received, deposit, withdrawal, reallocation.
- **Loan contributions** — record which investors funded each loan, from which project; auto-fills proportionally to share %.
- **Repayment distribution** — splits repayments proportionally back to contributors via the `process_loan_repayment` Postgres RPC.
- **Adjust into project** — loan repayment can be directed into another project instead of cash.
- **Settle / progress tracking** — outstanding balance, progress bar, settle button.

### Sharing
- **Invite by email** — owner can invite users as **owner / editor / viewer**.
- **Auto-accept on login** — pending invites for the signed-in email accept on dashboard mount via the `accept_pending_invites` RPC.
- **My Investments** — Dashboard view across every project where you are listed as an investor (regardless of who owns the project).
- **Role-gated UI** — destructive actions and edit forms hide for non-owners.

### PWA & UX
- Mobile-first layout with bottom nav, sheet modals, toasts.
- Offline support via Workbox service worker.
- Installable on iOS / Android / Desktop with full manifest.
- "Clear Cache & Reload" in Settings for forcing a refresh after deploys.
