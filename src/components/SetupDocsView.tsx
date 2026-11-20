import { Database, Laptop, Lock, Radio, Terminal } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';

export function SetupDocsView() {
  const supabaseActive = isSupabaseConfigured();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Architecture, Demo Mode & Deployment Guide
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Smart Library runs out-of-the-box with an ACID SQLite + WebSocket backend and includes full Supabase PostgreSQL SQL migrations for cloud deployment.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Radio className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Active Runtime: Express + SQLite + WebSocket
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              All bookings use <code className="font-mono">BEGIN IMMEDIATE</code> transactions and partial unique indexes (<code className="font-mono">uq_active_booking_seat</code>) to prevent double-booking. A server-side background job checks expiry timestamps every 2 seconds.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Database className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              Supabase PostgreSQL Migration Included
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Status: <strong>{supabaseActive ? 'Connected via Env Vars' : 'Local SQLite Mode (Supabase optional)'}</strong>. Apply <code className="font-mono">supabase/migrations/001_initial_schema.sql</code> in your Supabase SQL Editor and set <code className="font-mono">VITE_SUPABASE_URL</code> + <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in <code className="font-mono">.env</code>.
            </p>
          </div>
        </div>
      </div>

      {/* MacBook VS Code Instructions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Laptop className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Running Locally on MacBook with VS Code
          </h3>
        </div>

        <ol className="mt-4 space-y-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          <li>
            <strong>1. Install Prerequisites:</strong> Install Node.js 20+ (via <code className="font-mono">brew install node</code>) and open the project folder in VS Code.
          </li>
          <li>
            <strong>2. Install Packages:</strong> Open the VS Code integrated terminal (<kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700">Ctrl + `</kbd>) and run:
            <pre className="mt-1.5 overflow-x-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
              npm install
            </pre>
          </li>
          <li>
            <strong>3. Start Full-Stack Dev Server:</strong> Launch Express, SQLite, WebSockets, and Vite together on port 3000:
            <pre className="mt-1.5 overflow-x-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
              npm run dev
            </pre>
          </li>
          <li>
            <strong>4. Run Unit & Concurrency Tests:</strong> Verify domain rules and atomic locking:
            <pre className="mt-1.5 overflow-x-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
              npm test && npx tsx --test server/db.test.ts
            </pre>
          </li>
        </ol>

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-2 dark:border-slate-800">
          <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <div>
              <strong className="text-slate-900 dark:text-slate-100">Demo Credentials:</strong>
              <div className="mt-1 font-mono text-[11px]">
                Student: aarav.sharma@university.edu / student123
              </div>
              <div className="font-mono text-[11px]">
                Admin: librarian.admin@university.edu / admin123
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <div>
              <strong className="text-slate-900 dark:text-slate-100">Production Build:</strong>
              <div className="mt-1">
                Run <code className="font-mono">npm run build</code> then <code className="font-mono">NODE_ENV=production npm start</code> on Render, Railway, or Fly.io.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
