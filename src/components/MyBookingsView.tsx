import { CalendarClock, GraduationCap, MapPin } from 'lucide-react';
import type { Booking, UserProfile } from '../shared/types';

interface MyBookingsViewProps {
  user: UserProfile | null;
  activeBooking: Booking | null;
  history: Booking[];
  onOpenAuth: () => void;
  onGoToFloorMap: () => void;
}

export function MyBookingsView({
  user,
  activeBooking,
  history,
  onOpenAuth,
  onGoToFloorMap,
}: MyBookingsViewProps) {
  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <GraduationCap className="mx-auto h-10 w-10 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-100">
          Student Profile & Booking History
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
          Sign in or register with your university Student ID to reserve seats, scan QR check-ins, and manage your 20-minute break timer.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-6 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Sign In / Register
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Student Profile Card */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 font-display text-lg font-bold text-white">
            {user.fullName
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{user.fullName}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                {user.studentId}
              </span>
              <span aria-hidden="true">·</span>
              <span>{user.department}</span>
              <span aria-hidden="true">·</span>
              <span>{user.email}</span>
            </div>
          </div>
        </div>

        {!activeBooking && (
          <button
            type="button"
            onClick={onGoToFloorMap}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 whitespace-nowrap"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Find an Available Seat
          </button>
        )}
      </div>

      {/* Personal History */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              My Booking History
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your recent library reservations, QR check-ins, and break sessions
            </p>
          </div>
          <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </div>

        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No seat bookings recorded yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Head to the Floor Map to reserve your first study carrel.
            </p>
            <button
              type="button"
              onClick={onGoToFloorMap}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Open Live Floor Map
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Seat</th>
                  <th className="py-2.5 pr-3 font-medium">Floor</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Booked</th>
                  <th className="py-2.5 pr-3 font-medium">Checked In</th>
                  <th className="py-2.5 text-right font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {b.seatNumber}
                    </td>
                    <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{b.floorName}</td>
                    <td className="py-3 pr-3 capitalize font-semibold text-slate-800 dark:text-slate-200">
                      {b.status.replace('_', ' ')}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {new Date(b.bookedAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {b.checkedInAt
                        ? new Date(b.checkedInAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="py-3 text-right text-slate-600 dark:text-slate-300">
                      {b.endReason || 'Active'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
