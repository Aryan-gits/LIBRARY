import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Unlock,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { AdminAnalytics, LibrarySettings, Seat, UserProfile } from '../shared/types';

interface AdminDashboardProps {
  user: UserProfile | null;
  onOpenAuth: () => void;
  onSwitchToDemoAdmin: () => Promise<void>;
  onSeatsChanged: () => void;
  onNotify: (type: 'info' | 'error', title: string, message: string) => void;
}

export function AdminDashboard({
  user,
  onOpenAuth,
  onSwitchToDemoAdmin,
  onSeatsChanged,
  onNotify,
}: AdminDashboardProps) {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [expiryInput, setExpiryInput] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'seats' | 'history'>('overview');

  const fetchAdminData = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdminAnalytics();
      setAnalytics(data.analytics);
      setSeats(data.seats);
      setSettings(data.settings);
      setExpiryInput(data.settings.reservationExpiryMinutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin analytics.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <ShieldAlert className="mx-auto h-10 w-10 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-100">
          Administrator Authentication Required
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
          The Admin Analytics & Floor Operations console is protected by server-enforced role authorization.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Sign In as Admin
          </button>
          <button
            type="button"
            onClick={onSwitchToDemoAdmin}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            Demo Mode: Switch to Demo Admin
          </button>
        </div>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div
        role="alert"
        data-testid="admin-access-denied"
        className="rounded-2xl border border-rose-200 bg-white p-10 text-center dark:border-rose-900/60 dark:bg-slate-900"
      >
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-100">
          Access Restricted (Student Role)
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
          Signed in as <strong>{user.fullName}</strong> ({user.studentId}). Students cannot access administrator analytics, seat overrides, or occupancy audit logs.
        </p>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onSwitchToDemoAdmin}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Demo Mode: Switch to Demo Admin
          </button>
        </div>
      </div>
    );
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api.updateAdminSettings(expiryInput);
      setSettings(res.settings);
      onNotify(
        'info',
        'Library policy updated',
        `Reservation check-in expiry set to ${res.settings.reservationExpiryMinutes} minutes.`
      );
    } catch (err) {
      onNotify('error', 'Failed to update settings', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleForceRelease(seat: Seat) {
    try {
      await api.adminReleaseSeat(seat.id);
      onNotify('info', `Seat ${seat.seatNumber} released`, 'Administrator override completed.');
      onSeatsChanged();
      fetchAdminData();
    } catch (err) {
      onNotify('error', 'Release failed', err instanceof Error ? err.message : 'Error');
    }
  }

  if (loading && !analytics) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!analytics) return null;

  const { summary, floorUtilization, peakHours, hoggingFlags, recentBookings } = analytics;
  const activeSeats = seats.filter((s) => s.status !== 'available');

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Library Operations & Analytics Console
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Real-time telemetry derived directly from PostgreSQL/SQLite bookings and seat-status events
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['overview', 'seats', 'history'] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(tabKey)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  activeTab === tabKey
                    ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tabKey === 'overview'
                  ? 'Analytics'
                  : tabKey === 'seats'
                    ? `Active Seats (${activeSeats.length})`
                    : 'Booking History'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchAdminData}
            aria-label="Refresh analytics data"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Library Capacity
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {summary.totalSeats}
            </span>
            <span className="text-xs font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
              {summary.availableSeats} Available
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            3 floors · 24 seats per floor
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Currently Occupied & On Break
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {summary.occupiedSeats + summary.onBreakSeats}
            </span>
            <span className="text-xs font-medium text-orange-700 tabular-nums dark:text-orange-400">
              {summary.onBreakSeats} On Break · {summary.reservedSeats} Hold
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Live occupancy: {Math.round(((summary.totalSeats - summary.availableSeats) / summary.totalSeats) * 100)}%
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Bookings Today
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-indigo-600 tabular-nums dark:text-indigo-400">
              {summary.totalBookingsToday}
            </span>
            <span className="text-xs font-medium text-slate-600 tabular-nums dark:text-slate-400">
              {summary.autoReleasedCount} Auto-Released
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Includes active and completed sessions
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Average Occupancy Duration
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {Math.floor(summary.avgOccupancyMinutes / 60)}h {summary.avgOccupancyMinutes % 60}m
            </span>
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Calculated across checked-in sessions
          </div>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Charts Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Peak Hours Analysis */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Peak Hours Analysis
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Active seat occupancy across library operating hours (08:00–22:00)
                  </p>
                </div>
                <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={peakHours} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="peakGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="occupancyCount"
                      name="Occupied Seats"
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#peakGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Floor Utilization Comparison */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Floor Utilization Comparison
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Live seat breakdown across Ground, First, and Second floors
                  </p>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={floorUtilization} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="floorName" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="occupied" stackId="a" name="Occupied" fill="#e11d48" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="onBreak" stackId="a" name="On Break" fill="#ea580c" />
                    <Bar dataKey="reserved" stackId="a" name="Reserved" fill="#eab308" />
                    <Bar dataKey="available" stackId="a" name="Available" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Seat Hogging Review & Policy Config */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Seat Hogging & Break-Rule Review Queue
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sessions flagged for unusually long continuous occupancy (4h+) or expired break timers for staff review
                  </p>
                </div>
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>

              {hoggingFlags.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  No unusual occupancy or break-violation patterns detected right now.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="py-2.5 pr-3 font-medium">Seat</th>
                        <th className="py-2.5 pr-3 font-medium">Student</th>
                        <th className="py-2.5 pr-3 font-medium">Observation</th>
                        <th className="py-2.5 pr-3 font-medium">Review Status</th>
                        <th className="py-2.5 text-right font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {hoggingFlags.map((flag, idx) => (
                        <tr key={`${flag.seatId}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {flag.seatNumber}
                          </td>
                          <td className="py-3 pr-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {flag.userName}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {flag.studentId}
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{flag.reason}</td>
                          <td className="py-3 pr-3">
                            <span
                              className={`font-semibold ${
                                flag.riskLevel === 'Review Recommended'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {flag.riskLevel}
                            </span>
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {Math.floor(flag.durationMinutes / 60)}h {flag.durationMinutes % 60}m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Policy Configuration */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Booking & Expiry Policy
                </h3>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Configure how long a reserved seat waits for physical QR check-in before auto-release.
              </p>

              <form onSubmit={handleSaveSettings} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="res-expiry-mins"
                    className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Reservation Hold Window (minutes)
                  </label>
                  <input
                    id="res-expiry-mins"
                    type="number"
                    min={1}
                    max={60}
                    value={expiryInput}
                    onChange={(e) => setExpiryInput(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-sm text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Production Break Limit</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {settings?.breakDurationMinutes ?? 20} minutes
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Save Reservation Policy
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {activeTab === 'seats' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">
            Currently Active Seats ({activeSeats.length})
          </h3>
          {activeSeats.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              All 72 seats are currently available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Seat</th>
                    <th className="py-2.5 pr-3 font-medium">Floor</th>
                    <th className="py-2.5 pr-3 font-medium">Occupant</th>
                    <th className="py-2.5 pr-3 font-medium">Status</th>
                    <th className="py-2.5 pr-3 font-medium">Zone</th>
                    <th className="py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeSeats.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 pr-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                        {s.seatNumber}
                      </td>
                      <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                        Floor {s.floorNumber}
                      </td>
                      <td className="py-3 pr-3 font-medium text-slate-900 dark:text-slate-100">
                        {s.currentUserName || 'Assigned Student'}
                      </td>
                      <td className="py-3 pr-3 capitalize font-semibold text-slate-700 dark:text-slate-300">
                        {s.status.replace('_', ' ')}
                      </td>
                      <td className="py-3 pr-3 text-slate-500 dark:text-slate-400">{s.zone}</td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleForceRelease(s)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        >
                          <Unlock className="h-3 w-3" aria-hidden="true" />
                          Force Release
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">
            Recent Booking History
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Seat</th>
                  <th className="py-2.5 pr-3 font-medium">Student</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Booked At</th>
                  <th className="py-2.5 pr-3 font-medium">Outcome / Notes</th>
                  <th className="py-2.5 text-right font-medium">Breaks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {b.seatNumber}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{b.userName}</div>
                      <div className="font-mono text-[11px] text-slate-500">{b.studentId}</div>
                    </td>
                    <td className="py-3 pr-3 capitalize font-semibold text-slate-700 dark:text-slate-300">
                      {b.status.replace('_', ' ')}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {new Date(b.bookedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                      {b.endReason || 'Active session'}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {b.breakCount} ({b.breakViolations} exp)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
