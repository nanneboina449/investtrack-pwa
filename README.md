# InvestTrack PWA

A mobile-first Progressive Web App for tracking investments, profits, and loans. Built with React + Vite + Tailwind + Supabase.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your Supabase credentials:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these from: [app.supabase.com](https://app.supabase.com) → Your Project → Settings → API

### 3. Set up the database
Run both SQL files in the Supabase SQL Editor (in order):
1. `../InvestTrack/Supabase/schema.sql`
2. `../InvestTrack/Supabase/schema_loan_contributions.sql`

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
Set environment variables in Vercel dashboard.

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

---

## Project Structure

```
src/
├── main.jsx              ← Entry point + PWA registration
├── App.jsx               ← Router + auth guard
├── contexts/
│   └── AuthContext.jsx   ← Supabase auth state
├── hooks/
│   └── useData.js        ← All data fetching & mutations
├── lib/
│   └── supabase.js       ← Supabase client + helpers
├── components/
│   ├── Layout.jsx        ← Bottom navigation
│   └── ui/index.jsx      ← Sheet, StatCard, ShareBar, etc.
├── pages/
│   ├── Auth.jsx          ← Sign in / sign up
│   ├── Dashboard.jsx     ← Portfolio overview
│   ├── Projects.jsx      ← Projects list
│   ├── ProjectDetail.jsx ← Investors, profits, balances
│   ├── CashFlow.jsx      ← Loans, repayments, adjustments
│   └── Settings.jsx      ← Account + app info
└── styles/
    └── index.css         ← Tailwind + custom components
```

---

## Key Features

- **Projects** — active, upcoming, completed with total value + expected return
- **Multi-investor** — per-project investors with share %, auto-computed contribution amounts
- **Share allocation bar** — visual who owns what
- **Profit records** — auto-split to each investor by share %
- **Running balance** — invested + profit − loaned + repaid = effective balance per investor
- **Loan tracking** — record which investors funded each loan, from which project
- **Repayment distribution** — auto-splits repayments proportionally back to contributors
- **Adjust into project** — loan repayment can be directed into another project
- **Offline support** — Workbox service worker caches assets and Supabase responses
- **Installable** — full PWA manifest for home screen install on iOS/Android
