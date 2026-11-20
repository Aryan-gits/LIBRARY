import { useEffect, useState } from 'react';
import {
  Accessibility,
  AlertCircle,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  FlaskConical,
  MapPin,
  Monitor,
  PlugZap,
  QrCode,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCountdown, getRemainingSeconds } from '../shared/libraryRules';
import type {
  Booking,
  ConcurrencyTestResult,
  LibraryFloor,
  Seat,
  UserProfile,
} from '../shared/types';

interface SeatDetailPanelProps {
  seat: Seat | null;
  floor: LibraryFloor | undefined;
  user: UserProfile | null;
  activeBooking: Booking | null;
  onBookSeat: (seat: Seat) => Promise<void>;
  onOpenAuth: () => void;
  onOpenQrCheckIn: () => void;
  onConcurrencyCompleted: (result: ConcurrencyTestResult) => void;
}

export function SeatDetailPanel({
  seat,
  floor,
  user,
  activeBooking,
  onBookSeat,
  onOpenAuth,
  onOpenQrCheckIn,
  onConcurrencyCompleted,
}: SeatDetailPanelProps) {
  const [bookingLoading, setBookingLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<ConcurrencyTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setTestResult(null);
    setTestError(null);
  }, [seat?.id]);

  if (!seat) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <MapPin className="mx-auto h-8 w-8 text-indigo-500" aria-hidden="true" />
        <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
          Select a Seat on the Floor Map
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Click any green seat across the three floors to inspect its zone, power and monitor amenities, and reserve it instantly.
        </p>
      </div>
    );
  }

  const isMySeat = Boolean(activeBooking && activeBooking.seatId === seat.id);
  const canBook = seat.status === 'available' && !activeBooking;
  const expiryIso = seat.status === 'reserved' ? seat.reservationExpiresAt : seat.breakExpiresAt;
  const remainingSecs = getRemainingSeconds(expiryIso, nowMs);

  const statusMeta: Record<Seat['status'], { label: string; desc: string; tone: string }> = {
    available: {
      label: 'Available Now',
      desc: 'Ready for immediate booking and QR check-in.',
      tone: 'text-emerald-700 dark:text-emerald-400',
    },
    reserved: {
      label: 'Reserved (Awaiting Check-In)',
      desc: `Check-in window expires in ${formatCountdown(remainingSecs)}.`,
      tone: 'text-amber-700 dark:text-amber-400',
    },
    occupied: {
      label: 'Occupied',
      desc: 'Student has checked in via physical seat QR code.',
      tone: 'text-rose-700 dark:text-rose-400',
    },
    on_break: {
      label: 'Student on 20-Min Break',
      desc: `Seat auto-releases in ${formatCountdown(remainingSecs)} if not resumed.`,
      tone: 'text-orange-700 dark:text-orange-400',
    },
  };

  async function handleBookClick() {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!seat) return;
    setBookingLoading(true);
    try {
      await onBookSeat(seat);
    } finally {
      setBookingLoading(false);
    }
  }

  async function handleRunConcurrencyTest() {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!seat) return;
    setTestError(null);
    setTestLoading(true);
    try {
      const { result } = await api.runConcurrencyTest(seat.id, 10);
      setTestResult(result);
      onConcurrencyCompleted(result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Concurrency test failed');
    } finally {
      setTestLoading(false);
    }
  }

  const meta = statusMeta[seat.status];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {floor?.name || `Floor ${seat.floorId}`} · {seat.deskGroup}
            </p>
            <h3 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Seat {seat.seatNumber}
            </h3>
          </div>
          <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{meta.desc}</p>

        {/* Amenities & Metadata (Unboxed clean rows) */}
        <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100 text-xs dark:divide-slate-800 dark:border-slate-800">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-500 dark:text-slate-400">Study Zone</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{seat.zone}</dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
              AC + USB-C Power
            </dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {seat.hasPower ? 'Equipped' : 'Standard'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              External Display
            </dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {seat.hasMonitor ? '27" USB-C Monitor' : 'Bring Your Own Laptop'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Accessibility className="h-3.5 w-3.5" aria-hidden="true" />
              Accessibility
            </dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {seat.isAccessible ? 'Step-Free Aisle Desk' : 'Standard Height'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              Physical QR ID
            </dt>
            <dd className="font-mono text-[11px] font-medium text-slate-700 dark:text-slate-300">
              {seat.qrToken}
            </dd>
          </div>
        </dl>

        {/* Primary Action */}
        <div className="mt-4 space-y-2.5">
          {!user ? (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
              Sign In to Book Seat {seat.seatNumber}
            </button>
          ) : isMySeat ? (
            <button
              type="button"
              onClick={onOpenQrCheckIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              {activeBooking?.status === 'reserved'
                ? 'Scan QR to Check In'
                : activeBooking?.status === 'on_break'
                  ? 'Scan QR to Resume from Break'
                  : 'View Active Session'}
            </button>
          ) : activeBooking ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                You currently hold seat <strong>{activeBooking.seatNumber}</strong>. Only one active booking is permitted per student.
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canBook || bookingLoading}
              onClick={handleBookClick}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
              {bookingLoading
                ? 'Acquiring Atomic Lock...'
                : seat.status === 'available'
                  ? `Book Seat ${seat.seatNumber}`
                  : `Unavailable (${seat.status.replace('_', ' ')})`}
            </button>
          )}
        </div>
      </div>

      {/* Built-in Atomic Concurrency Verification Panel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Atomic Booking Concurrency Test
            </h4>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">DB Lock Verification</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Fires 10 simultaneous booking transactions for seat {seat.seatNumber} to verify that row locking and unique constraints allow exactly 1 winner.
        </p>

        <button
          type="button"
          disabled={testLoading || seat.status !== 'available'}
          onClick={handleRunConcurrencyTest}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {testLoading ? 'Running 10 Simultaneous Requests...' : 'Simulate 10 Concurrent Bookings'}
        </button>

        {testError && (
          <p className="mt-2.5 text-xs font-medium text-rose-600 dark:text-rose-400">{testError}</p>
        )}

        {testResult && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {testResult.succeededCount} Succeeded · {testResult.rejectedCount} Rejected
              </span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {testResult.durationMs}ms
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Winner: <strong className="text-slate-900 dark:text-slate-100">{testResult.winningUser}</strong> (cleaned up after proof).
            </p>
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 font-mono text-[10px] dark:bg-slate-950">
              {testResult.outcomes.map((o, idx) => (
                <div
                  key={idx}
                  className={
                    o.success
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  [{o.status}] {o.worker}: {o.success ? 'BOOKED' : '409 CONFLICT'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
