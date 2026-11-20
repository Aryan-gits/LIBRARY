# Smart Library — Intelligent Seat Finder & Booking System

A full-stack university library seat finder, atomic booking engine, QR check-in system, 20-minute break manager with server-side automatic seat release, and administrator analytics dashboard.

---

## Features Implemented

- **Live 3-Floor Interactive Seat Map (72 Seats)**:
  - **Ground Floor** (`G-01` to `G-24`), **First Floor** (`F1-01` to `F1-24`), and **Second Floor** (`F2-01` to `F2-24`) with desks, walkable aisles, entrances, and zone/status filters.
  - Color-coded & icon-labeled seat statuses: **Green** (Available), **Red** (Occupied), **Yellow** (Reserved awaiting check-in), **Orange** (On Break), **Blue outline** (Selected).
  - Real-time synchronization across all connected tabs/users in under 1 second via WebSockets (`/ws`) with automatic reconnection and state resync.
- **Atomic Concurrency-Safe Booking Engine**:
  - Uses database-level `BEGIN IMMEDIATE` transactions (and `SELECT ... FOR UPDATE` in the included Supabase PostgreSQL migration) plus partial unique indexes (`uq_active_booking_seat`, `uq_active_booking_user`) so two students can never book the same seat simultaneously, and each student is limited to one active booking.
  - Includes a built-in **10-Request Concurrency Stress Test** on the seat detail panel and automated unit/integration tests.
- **QR Code Check-In & Printable Stickers**:
  - Every seat has a unique tamper-evident QR token (`SL-F{floor}-{seat}-{checksum}`).
  - Camera scanning via `html5-qrcode` plus Demo Mode simulator (with valid & wrong-seat QR test buttons) and printable QR code sheets for all 72 seats (`qrcode`).
- **20-Minute Break Timer & Server-Side Auto-Release**:
  - Checked-in students can click **Start 20-Min Break**.
  - Break expiry timestamps are stored in the database and enforced every 2 seconds by a server-side background job (`expireStaleBookingsAtomic()`), automatically releasing expired seats even if the student closes their browser.
  - Displays 5-minute and 1-minute in-app warnings while online.
  - Includes a clearly labeled **Demo: Test 10s Expiry** control so evaluators can verify server-side auto-release in 10 seconds.
- **Protected Admin Dashboard & Recharts Analytics**:
  - Role-based access control (`403 Forbidden` for students).
  - Real database-derived **Peak Hours Analysis**, **Floor Utilization Comparison**, **Average Occupancy Duration**, **Seat Hogging & Break-Rule Review Queue**, configurable reservation hold window, and live seat force-release.

---

## Demo Accounts (Hackathon Mode)

You can sign in via the **Demo Mode Quick Switch** in the sidebar or register a brand-new student account:

- **Demo Student**: `aarav.sharma@university.edu` / `student123` (Student ID: `STU-2026-0412`)
- **Demo Admin**: `librarian.admin@university.edu` / `admin123` (Staff ID: `ADM-0001`)

---

## Project Structure

```text
├── server.ts                          # Express + WebSocket server + 2s expiry sweeper + Vite middleware
├── server/
│   ├── auth.ts                        # scrypt password hashing, HMAC session tokens, RBAC middleware
│   ├── db.ts                          # SQLite WAL atomic transactions, analytics queries, stress test
│   └── db.test.ts                     # Server integration tests (concurrency, QR check-in, expiry, RBAC)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql     # Complete Supabase PostgreSQL schema, RLS, RPCs, & Realtime
├── src/
│   ├── shared/
│   │   ├── types.ts                   # Shared TypeScript interfaces
│   │   ├── libraryRules.ts            # Pure domain rules (QR validation, layout, warnings, analytics)
│   │   └── libraryRules.test.ts       # Unit tests for domain logic
│   ├── lib/
│   │   ├── api.ts                     # Typed REST API client
│   │   └── supabase.ts                # Optional Supabase client adapter
│   ├── hooks/
│   │   └── useLibraryRealtime.ts      # WebSocket + Supabase Realtime hook with reconnect sync
│   └── components/                    # FloorMap, SeatDetailPanel, ActiveBookingPanel, QrScannerModal,
│                                      # AdminDashboard, QrPrintSheet, AuthModal, ToastContainer, etc.
└── data/                              # Auto-created SQLite database directory
```

---

## Running Locally on a MacBook with VS Code

1. **Install Node.js (v20 or v22)**:
   ```bash
   brew install node
   ```
2. **Open the project in VS Code**, open the integrated terminal (`Ctrl + \``), and install dependencies:
   ```bash
   npm install
   ```
3. **Create your `.env` file** (optional for local SQLite mode):
   ```bash
   cp .env.example .env
   ```
4. **Run the full-stack application**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in Chrome or Safari.
5. **Run all unit & concurrency tests**:
   ```bash
   npm test
   npx tsx --test server/db.test.ts
   ```

---

## Connecting External Supabase PostgreSQL (Optional Cloud Setup)

By default, the app runs immediately using the built-in Express + SQLite + WebSocket backend so no external keys are required to test or demo. To connect a hosted Supabase project:

1. Create a new project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase Dashboard and execute the full contents of `supabase/migrations/001_initial_schema.sql`.
3. Enable `pg_cron` (Database -> Extensions) and uncomment the `cron.schedule` line at the bottom of the migration so `public.release_expired_bookings()` runs automatically every minute on PostgreSQL.
4. Add your project URL and Anon Key to `.env`:
   ```env
   VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
   ```

---

## Deploying to Production

1. Build the frontend bundle:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   NODE_ENV=production npm start
   ```
3. Recommended hosting platforms for full-stack Node + WebSockets: **Render**, **Railway**, or **Fly.io** (ensure `PORT=3000` or platform `PORT` env var and persistent disk if using SQLite).
