import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, QrCode } from 'lucide-react';
import type { LibraryFloor, Seat } from '../shared/types';

interface QrPrintSheetProps {
  floors: LibraryFloor[];
  seats: Seat[];
}

export function QrPrintSheet({ floors, seats }: QrPrintSheetProps) {
  const [selectedFloorId, setSelectedFloorId] = useState<number | 'all'>(1);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});

  const visibleSeats =
    selectedFloorId === 'all' ? seats : seats.filter((s) => s.floorId === selectedFloorId);

  useEffect(() => {
    let cancelled = false;
    async function generateAll() {
      const entries = await Promise.all(
        visibleSeats.map(async (s) => {
          const url = await QRCode.toDataURL(s.qrToken, {
            width: 160,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
          return [s.id, url] as const;
        })
      );
      if (!cancelled) {
        setQrImages((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    }
    generateAll();
    return () => {
      cancelled = true;
    };
  }, [selectedFloorId, seats.length]);

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Physical Seat QR Code Registry
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Unique cryptographic desk stickers for all 72 seats across 3 library floors. Print and affix to each study carrel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter QR sheet by floor"
            value={selectedFloorId}
            onChange={(e) =>
              setSelectedFloorId(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (24 Seats)
              </option>
            ))}
            <option value="all">All 3 Floors (72 Seats)</option>
          </select>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print QR Stickers
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {visibleSeats.map((seat) => {
          const floorName = floors.find((f) => f.id === seat.floorId)?.name || '';
          const img = qrImages[seat.id];
          return (
            <div
              key={seat.id}
              className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {floorName}
              </span>
              <span className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                {seat.seatNumber}
              </span>

              <div className="my-3 flex h-28 w-28 items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5">
                {img ? (
                  <img
                    src={img}
                    alt={`QR sticker for ${seat.seatNumber}`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <QrCode className="h-8 w-8 text-slate-300" />
                )}
              </div>

              <span className="font-mono text-[10px] font-medium text-slate-600 dark:text-slate-400 break-all">
                {seat.qrToken}
              </span>
              <span className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                {seat.zone}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
