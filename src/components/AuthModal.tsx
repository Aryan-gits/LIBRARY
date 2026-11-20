import { useState } from 'react';
import { Lock, LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import type { UserProfile } from '../shared/types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthModal({ open, onClose, onAuthenticated }: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [department, setDepartment] = useState('Computer Science & Engineering');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user =
        tab === 'login'
          ? await api.login(email, password)
          : await api.register({ email, password, fullName, studentId, department });
      onAuthenticated(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(role: 'student' | 'admin') {
    setError(null);
    setLoading(true);
    try {
      const user = await api.demoLogin(role);
      onAuthenticated(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {tab === 'login' ? 'Sign in to Smart Library' : 'Create Student Account'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              University portal authentication and session security
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {/* Segmented Mode Switch */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === 'login'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === 'register'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Register
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-fullname" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Full Name
                  </label>
                  <input
                    id="auth-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Jordan Verma"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="auth-studentid" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Student ID
                    </label>
                    <input
                      id="auth-studentid"
                      type="text"
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="STU-2026-8821"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-dept" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Department
                    </label>
                    <input
                      id="auth-dept"
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="Computer Science"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                University Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@university.edu"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              {loading ? 'Authenticating...' : tab === 'login' ? 'Sign In' : 'Create Student Account'}
            </button>
          </form>

          {/* Clearly Labeled Hackathon Demo Mode Quick Access */}
          <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Demo Mode Accounts
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Real database sessions
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoLogin('student')}
                className="flex flex-col items-start rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
              >
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Demo Student
                </span>
                <span className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Aarav Sharma · STU-0412
                </span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoLogin('admin')}
                className="flex flex-col items-start rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
              >
                <span className="flex items-center gap-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <ShieldCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                  Demo Admin
                </span>
                <span className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Dr. Elena · ADM-0001
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
