# InvestTrack — Complete Deployment Guide

## Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- A [Vercel](https://vercel.com) account (free tier works)
- A [GitHub](https://github.com) account (for Vercel auto-deploy)

---

## Step 1 — Supabase Setup

### 1.1 Create project
1. Go to https://supabase.com → New Project
2. Name it `investtrack`, pick a region close to India (e.g. Mumbai / Singapore)
3. Set a strong database password → **Save it somewhere**
4. Wait ~2 min for the project to spin up

### 1.2 Run the schema
1. Go to **SQL Editor** in the left sidebar
2. Click **New query**
3. Paste the full contents of `../InvestTrack/Supabase/schema.sql` → Run
4. Create another new query
5. Paste the full contents of `../InvestTrack/Supabase/schema_loan_contributions.sql` → Run

### 1.3 Get your API keys
Go to **Settings → API** and copy:
- **Project URL** → looks like `https://abcdefgh.supabase.co`
- **anon / public key** → long JWT string

### 1.4 Enable Email Auth
Go to **Authentication → Providers → Email** → make sure it's enabled.
For development, also go to **Authentication → Settings** and turn off **"Confirm email"** (makes testing easier — re-enable for production).

---

## Step 2 — Local Setup & Test

```bash
# Clone / enter the project folder
cd investtrack-pwa

# Install dependencies
npm install

# Copy env file
cp .env.example .env
```

Edit `.env`:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

```bash
# Run locally
npm run dev
```

Open http://localhost:5173 — create an account and test everything works.

```bash
# Test production build locally
npm run build
npm run preview
```

---

## Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: InvestTrack PWA"

# Create a repo on github.com named investtrack-pwa
git remote add origin https://github.com/YOUR_USERNAME/investtrack-pwa.git
git branch -M main
git push -u origin main
```

---

## Step 4 — Deploy to Vercel

### Option A — Vercel Dashboard (easiest)
1. Go to https://vercel.com → New Project
2. Import from GitHub → select `investtrack-pwa`
3. Framework preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`
6. Click **Environment Variables** → add:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
7. Click **Deploy**

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel

# When prompted:
# Framework: Vite
# Build command: npm run build
# Output dir: dist

# Add env vars
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# Redeploy with env vars
vercel --prod
```

Your app will be live at `https://investtrack-pwa.vercel.app` (or your custom domain).

---

## Step 5 — Install as PWA

### iOS (Safari)
1. Open your Vercel URL in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down → **Add to Home Screen**
4. Tap **Add** — the InvestTrack icon appears on your home screen

### Android (Chrome)
1. Open your Vercel URL in Chrome
2. Tap the **3-dot menu** → **Add to Home Screen** (or **Install App**)
3. Confirm — icon appears on home screen

### Desktop (Chrome / Edge)
1. Open the URL
2. Click the **install icon** in the address bar (right side)
3. Click **Install**

---

## Step 6 — Custom Domain (optional)

In Vercel dashboard → your project → **Settings → Domains**:
1. Add your domain (e.g. `investtrack.yourdomain.com`)
2. Add the DNS record Vercel shows you in your domain registrar
3. Vercel auto-provisions HTTPS

---

## Supabase Production Checklist

Before going live:
- [ ] Re-enable **email confirmation** in Auth settings
- [ ] Set up **SMTP** (Settings → Auth → SMTP) for real confirmation emails
- [ ] Review **Row Level Security** — already enabled in the schema
- [ ] Set up **Database backups** (Settings → Database → Backups)
- [ ] Add your Vercel domain to **Auth → URL Configuration → Site URL**
- [ ] Add `https://your-app.vercel.app` to **Auth → Redirect URLs**

---

## Environment Variables Reference

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |

**Never commit `.env` to git** — it's in `.gitignore` already.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page after deploy | Check Vercel function logs; ensure env vars are set |
| Auth not working | Add your Vercel URL to Supabase Auth → Redirect URLs |
| Page 404 on refresh | `vercel.json` handles SPA routing — ensure it's committed |
| PWA not installable | Must be served over HTTPS (Vercel does this automatically) |
| Icons not showing | Run `npm run build` and check `dist/icons/` has PNG files |
| DB errors | Open Supabase → SQL Editor and verify both schema files ran without errors |
