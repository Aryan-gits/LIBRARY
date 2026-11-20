import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Coffee,
  FastForward,
  LogOut,
  QrCode,
  Timer,
  UserCheck,
} from 'lucide-react';
import {
  evaluateBreakWarning,
  formatCountdown,
  getRemainingSeconds,
} from '../shared/libraryRules';
import type { Booking } from '../shared/types';

interface ActiveBookingPanelProps {
  booking: Booking;
  onOpenQrCheckIn: () => void;
  onStartBreak: () => Promise<void>;
  onReleaseBooking: () => Promise<void>;
  onAccelerateBreakDemo: () => Promise<void>;
  onBreakWarning: (level: 'five_min' | 'one_min', seatNumber: string) => void;
}

export function ActiveBookingPanel({
  booking,
  onOpenQrCheckIn,
  onStartBreak,
  onReleaseBooking,
  onAccelerateBreakDemo,
  onBreakWarning,
}: ActiveBookingPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);

  const warned5mRef = useRef<string | null>(null);
  const warned1mRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset warning tracking when break session changes
  useEffect(() => {
    warned5mRef.current = null;
    warned1mRef.current = null;
  }, [booking.id, booking.breakStartedAt]);

  const targetExpiry =
    booking.status === 'reserved'
      ? booking.reservationExpiresAt
      : booking.status === 'on_break'
        ? booking.breakExpiresAt
        : null;

  const remainingSeconds = getRemainingSeconds(targetExpiry, nowMs);

  // Trigger 5-min and 1-min break warnings when student is online
  useEffect(() => {
    if (booking.status !== 'on_break' || !booking.breakExpiresAt) return;
    const key = `${booking.id}:${booking.breakStartedAt}`;
    const res = evaluateBreakWarning(
      remainingSeconds,
      warned5mRef.current === key,
      warned1mRef.current === key
    );
    if (res.trigger === 'five_min') {
      warned5mRef.current = key;
      onBreakWarning('five_min', booking.seatNumber);
    } else if (res.trigger === 'one_min') {
      warned1mRef.current = key;
      onBreakWarning('one_min', booking.seatNumber);
    }
  }, [booking.id, booking.status, booking.breakStartedAt, booking.breakExpiresAt, booking.seatNumber, remainingSeconds, onBreakWarning]);

  const statusConfig = {
    reserved: {
      title: 'Reserved — Awaiting QR Check-In',
      subtitle: 'Scan the QR sticker on your physical desk before the hold expires.',
      accent: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20',
      timerLabel: 'Hold Expires In',
    },
    occupied: {
      title: 'Checked In — Seat Occupied',
      subtitle: 'Your study session is active. Start a 20-minute break if stepping away.',
      accent: 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-indigo-950/20',
      timerLabel: 'Session Status',
    },
    on_break: {
      title: 'On Break — 20-Minute Protection Active',
      subtitle: 'Scan the seat QR code again before the timer hits 00:00 or the server will auto-release your seat.',
      accent: 'border-orange-200 bg-orange-50/70 dark:border-orange-900/60 dark:bg-orange-950/20',
      timerLabel: 'Auto-Release In',
    },
  } as const;

  const cfg = statusConfig[booking.status as keyof typeof statusConfig] || statusConfig.occupied;

  async function runAction(name: string, fn: () => Promise<void>) {
    setBusyAction(name);
    try {
      await fn();
    } finally {
      setBusyAction(null);
      setConfirmRelease(false);
    }
  }

  const isLowBreakTime = booking.status === 'on_break' && remainingSeconds <= 300;

  return (
    <section
      aria-label="Active seat booking"
      data-testid="active-booking-panel"
      className={`rounded-2xl border p-4 sm:p-5 transition-colors ${cfg.accent}`}
    >
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
              Seat {booking.seatNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span>{booking.floorName}</span>
            <span aria-hidden="true">·</span>
            <span>{cfg.title}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{cfg.subtitle}</p>
        </div>

        {/* Countdown + Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {(booking.status === 'reserved' || booking.status === 'on_break') && (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 dark:border-slate-700 dark:bg-slate-900">
              {isLowBreakTime ? (
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              ) : (
                <Timer className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              )}
              <div>
                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {cfg.timerLabel}
                </div>
                <div
                  data-testid="booking-countdown"
                  className={`font-mono text-base font-bold leading-tight tabular-nums ${
                    isLowBreakTime
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {formatCountdown(remainingSeconds)}
                </div>
              </div>
            </div>
          )}

          {booking.status === 'occupied' && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-400">
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Verified Active
            </div>
          )}

          {booking.status === 'reserved' && (
            <button
              type="button"
              onClick={onOpenQrCheckIn}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 whitespace-nowrap"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              Scan QR to Check In
            </button>
          )}

          {booking.status === 'occupied' && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => runAction('break', onStartBreak)}
              className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60 whitespace-nowrap"
            >
              <Coffee className="h-4 w-4" aria-hidden="true" />
              {busyAction === 'break' ? 'Starting Break...' : 'Start 20-Min Break'}
            </button>
          )}

          {booking.status === 'on_break' && (
            <>
              <button
                type="button"
                onClick={onOpenQrCheckIn}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 whitespace-nowrap"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Scan QR to Resume
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => runAction('accel', onAccelerateBreakDemo)}
                title="Developer/Demo testing helper: fast-forwards server break expiry to 10 seconds"
                className="flex items-center gap-1.5 rounded-xl border border-orange-300 bg-white px-3 py-2.5 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:bg-slate-900 dark:text-orange-300 dark:hover:bg-orange-950/40 whitespace-nowrap"
              >
                <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
                {busyAction === 'accel' ? 'Updating...' : 'Demo: Test 10s Expiry'}
              </button>
            </>
          )}

          {!confirmRelease ? (
            <button
              type="button"
              onClick={() => setConfirmRelease(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {booking.status === 'reserved' ? 'Cancel Booking' : 'Release Seat'}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => runAction('release', onReleaseBooking)}
                className="rounded-xl bg-rose-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap"
              >
                {busyAction === 'release' ? 'Releasing...' : 'Confirm Release'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRelease(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Keep
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
