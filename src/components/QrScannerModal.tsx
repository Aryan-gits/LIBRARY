import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import { AlertCircle, Camera, CheckCircle2, QrCode, ShieldAlert, X } from 'lucide-react';
import type { Booking, Seat } from '../shared/types';

interface QrScannerModalProps {
  open: boolean;
  booking: Booking | null;
  seats: Seat[];
  onClose: () => void;
  onSubmitQr: (qrToken: string) => Promise<void>;
}

export function QrScannerModal({
  open,
  booking,
  seats,
  onClose,
  onSubmitQr,
}: QrScannerModalProps) {
  const [manualToken, setManualToken] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewQrDataUrl, setPreviewQrDataUrl] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const targetSeat = seats.find((s) => s.id === booking?.seatId) || null;
  const wrongSeat = seats.find((s) => s.id !== booking?.seatId) || null;

  useEffect(() => {
    if (!open || !targetSeat) return;
    setSubmitError(null);
    setCameraError(null);
    setManualToken('');

    QRCode.toDataURL(targetSeat.qrToken, {
      width: 140,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => setPreviewQrDataUrl(url))
      .catch(() => setPreviewQrDataUrl(''));

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current?.clear();
            scannerRef.current = null;
          });
      }
      setCameraActive(false);
    };
  }, [open, targetSeat?.id, targetSeat?.qrToken]);

  if (!open || !booking || !targetSeat) return null;

  async function startCameraScanner() {
    setCameraError(null);
    try {
      const qr = new Html5Qrcode('qr-camera-region');
      scannerRef.current = qr;
      setCameraActive(true);
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        async (decodedText) => {
          await qr.stop().catch(() => {});
          setCameraActive(false);
          await handleVerifyToken(decodedText);
        },
        () => {}
      );
    } catch {
      setCameraActive(false);
      setCameraError(
        'Camera access is unavailable in this browser or device. Use the Demo QR Check-In options below.'
      );
    }
  }

  async function stopCameraScanner() {
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setCameraActive(false);
  }

  async function handleVerifyToken(token: string) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmitQr(token);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'QR verification failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualToken.trim()) {
      setSubmitError('Please enter or scan a seat QR code token.');
      return;
    }
    await handleVerifyToken(manualToken);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="qr-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {booking.status === 'on_break' ? 'Scan QR to Resume Seat' : 'QR Seat Check-In'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Validating physical presence at Seat {targetSeat.seatNumber} · {booking.floorName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR scanner"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          {/* Camera Scanner Region */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Camera QR Scanner
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Point your laptop or phone camera at the seat desk sticker.
                </p>
              </div>
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={startCameraScanner}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 whitespace-nowrap"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Start Camera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCameraScanner}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  Stop Camera
                </button>
              )}
            </div>

            <div
              id="qr-camera-region"
              className={`mt-3 overflow-hidden rounded-lg ${cameraActive ? 'min-h-[220px] bg-black' : 'hidden'}`}
            />

            {cameraError && (
              <p className="mt-2.5 text-xs text-amber-700 dark:text-amber-400">{cameraError}</p>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              data-testid="qr-error-alert"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Manual Token Entry */}
          <form onSubmit={handleFormSubmit} className="space-y-2.5">
            <label htmlFor="manual-qr-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Enter Seat QR Code Token
            </label>
            <div className="flex gap-2">
              <input
                id="manual-qr-input"
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder={targetSeat.qrToken}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? 'Verifying...' : 'Verify & Check In'}
              </button>
            </div>
          </form>

          {/* Demo-Mode Physical Sticker Simulator */}
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Demo Mode Seat QR Simulator
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Backend-verified token check
              </span>
            </div>

            <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row dark:border-slate-800 dark:bg-slate-950">
              {previewQrDataUrl ? (
                <img
                  src={previewQrDataUrl}
                  alt={`QR code for seat ${targetSeat.seatNumber}`}
                  className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 bg-white p-1"
                />
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <QrCode className="h-10 w-10 text-slate-400" />
                </div>
              )}

              <div className="flex-1 space-y-2.5 text-xs">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Seat {targetSeat.seatNumber} Token
                  </p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {targetSeat.qrToken}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleVerifyToken(targetSeat.qrToken)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Scan Correct Seat QR
                  </button>

                  {wrongSeat && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleVerifyToken(wrongSeat.qrToken)}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      Test Wrong Seat QR ({wrongSeat.seatNumber})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
