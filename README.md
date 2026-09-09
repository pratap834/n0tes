# 📝 The Electronic Notepad

An authentic, old-fashioned sectional notepad application built with Next.js, styled with vintage desk stationery and Manila folder aesthetics, and backed by **NeonDB** (serverless PostgreSQL). Designed to be easily deployed to **Vercel**.

---

## 🌟 Key Features

- **Old-Fashioned Aesthetic**: Authentic Manila folder tabs, yellow legal pad paper with faint horizontal ruling lines and a soft red margin line, beveled tactile buttons, typewriter/serif typography, and a retro system status bar. No generic AI templates or neon gradients.
- **Categorized Sections**: Organize notes across multiple folder tabs (e.g. *General*, *To-Do & Tasks*, *Ideas & Drafts*, or create your own custom tabs).
- **Instant Search & Index**: Quickly filter notes within any section by title or content.
- **Autosave & Persistence**: Changes to notes are debounced and automatically saved. Backed by NeonDB serverless PostgreSQL.
- **Export & Print**: Export notes as clean `.txt` files or print directly using a print-optimized clean stylesheet.
- **Serverless & Edge Ready**: Powered by `@neondatabase/serverless` and optimized for instant cold starts on Vercel.
- **Graceful Fallback**: Includes a built-in local store so the app functions seamlessly out of the box even before configuring database credentials.

---

## 🚀 Quickstart & Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure NeonDB (Optional for local preview, required for persistence)
1. Sign up or log into [Neon Console](https://console.neon.tech).
2. Create a new PostgreSQL project (takes ~2 seconds).
3. Copy your database connection string:
   ```
   postgresql://[user]:[password]@[endpoint-hostname]/neondb?sslmode=require
   ```
4. Create a `.env.local` file in the root directory:
   ```env
   DATABASE_URL="postgresql://[user]:[password]@[endpoint-hostname]/neondb?sslmode=require"
   ```
   *(The app automatically executes table creation on first run — no manual SQL scripts required! A reference `db/schema.sql` is also provided).*

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🚢 Deploying to Vercel

1. Push your code to your GitHub repository:
   ```bash
   git add .
   git commit -m "Initial commit of retro notepad"
   git push -u origin main
   ```
2. Go to [Vercel Dashboard](https://vercel.com) and click **"Add New Project"**.
3. Import your `n0tes` repository.
4. Under **Environment Variables**, add:
   - **Key**: `DATABASE_URL`
   - **Value**: Your NeonDB PostgreSQL connection string
5. Click **"Deploy"**.

Your vintage notepad will be live on your Vercel domain in under a minute!
