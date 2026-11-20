import { AlertTriangle, CheckCircle2, Clock, Info, X, XCircle } from 'lucide-react';
import type { AppNotification } from '../shared/types';

interface ToastContainerProps {
  toasts: AppNotification[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0 no-print"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isWarn =
          toast.type === 'break_warning_5m' ||
          toast.type === 'break_warning_1m' ||
          toast.type === 'auto_released';
        const isSuccess =
          toast.type === 'booking_created' ||
          toast.type === 'checkin_success' ||
          toast.type === 'break_started';

        const Icon = isError
          ? XCircle
          : isWarn
            ? AlertTriangle
            : isSuccess
              ? CheckCircle2
              : toast.type === 'booking_cancelled'
                ? Clock
                : Info;

        const accentClass = isError
          ? 'border-rose-200 dark:border-rose-900/70 text-rose-700 dark:text-rose-300'
          : isWarn
            ? 'border-amber-200 dark:border-amber-900/70 text-amber-700 dark:text-amber-300'
            : isSuccess
              ? 'border-emerald-200 dark:border-emerald-900/70 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-slate-800 text-indigo-600 dark:text-indigo-400';

        return (
          <div
            key={toast.id}
            role="status"
            className={`flex items-start gap-3 rounded-xl border bg-white/95 dark:bg-slate-900/95 p-3.5 shadow-lg backdrop-blur-md transition-all ${accentClass}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{toast.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {toast.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Dismiss notification ${toast.title}`}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
