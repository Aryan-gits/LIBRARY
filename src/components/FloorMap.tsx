import { useMemo, useState } from 'react';
import {
  Accessibility,
  Check,
  Clock,
  Coffee,
  Compass,
  DoorOpen,
  Monitor,
  PlugZap,
  Search,
  UserCheck,
} from 'lucide-react';
import type { LibraryFloor, Seat, SeatStatus, SeatZone } from '../shared/types';

interface FloorMapProps {
  floors: LibraryFloor[];
  seats: Seat[];
  activeFloorId: number;
  selectedSeatId: string | null;
  currentUserId: string | null;
  onSelectFloor: (floorId: number) => void;
  onSelectSeat: (seatId: string) => void;
}

type FilterStatus = 'all' | SeatStatus;

export function FloorMap({
  floors,
  seats,
  activeFloorId,
  selectedSeatId,
  currentUserId,
  onSelectFloor,
  onSelectSeat,
}: FloorMapProps) {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [zoneFilter, setZoneFilter] = useState<'all' | SeatZone>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const activeFloor = floors.find((f) => f.id === activeFloorId) || floors[0];

  const floorSeats = useMemo(
    () => seats.filter((s) => s.floorId === activeFloorId),
    [seats, activeFloorId]
  );

  const floorStats = useMemo(() => {
    const total = floorSeats.length;
    const available = floorSeats.filter((s) => s.status === 'available').length;
    const occupied = floorSeats.filter((s) => s.status === 'occupied').length;
    const reserved = floorSeats.filter((s) => s.status === 'reserved').length;
    const onBreak = floorSeats.filter((s) => s.status === 'on_break').length;
    const occupancyPct = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
    return { total, available, occupied, reserved, onBreak, occupancyPct };
  }, [floorSeats]);

  const matchesFilter = (seat: Seat) => {
    if (statusFilter !== 'all' && seat.status !== statusFilter) return false;
    if (zoneFilter !== 'all' && seat.zone !== zoneFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (
        !seat.seatNumber.toLowerCase().includes(q) &&
        !seat.zone.toLowerCase().includes(q) &&
        !seat.deskGroup.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  };

  // Group into 4 rows x 3 desk banks (2 seats per bank per row = 24 seats)
  const rows = [0, 1, 2, 3];
  const banks = [
    { name: 'West Wing', cols: [0, 1] },
    { name: 'Center Hall', cols: [2, 3] },
    { name: 'East Wing', cols: [4, 5] },
  ];

  function renderSeatButton(seat: Seat) {
    const isSelected = seat.id === selectedSeatId;
    const isMine = Boolean(currentUserId && seat.currentUserId === currentUserId);
    const dimmed = !matchesFilter(seat);

    let surfaceClass = '';
    let statusCode = '';
    let StatusIcon = Check;

    switch (seat.status) {
      case 'available':
        surfaceClass =
          'bg-emerald-50 border-emerald-400 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/60';
        statusCode = 'Avail';
        StatusIcon = Check;
        break;
      case 'occupied':
        surfaceClass =
          'bg-rose-50 border-rose-400 text-rose-900 hover:bg-rose-100 dark:bg-rose-950/50 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/60';
        statusCode = 'In Use';
        StatusIcon = UserCheck;
        break;
      case 'reserved':
        surfaceClass =
          'bg-yellow-50 border-yellow-400 text-yellow-900 hover:bg-yellow-100 dark:bg-yellow-950/50 dark:border-yellow-600 dark:text-yellow-200 dark:hover:bg-yellow-900/60';
        statusCode = 'Hold';
        StatusIcon = Clock;
        break;
      case 'on_break':
        surfaceClass =
          'bg-orange-50 border-orange-400 text-orange-900 hover:bg-orange-100 dark:bg-orange-950/50 dark:border-orange-600 dark:text-orange-200 dark:hover:bg-orange-900/60';
        statusCode = 'Break';
        StatusIcon = Coffee;
        break;
    }

    const selectedClass = isSelected
      ? 'ring-2 ring-blue-600 ring-offset-2 ring-offset-white dark:ring-blue-400 dark:ring-offset-slate-900 border-blue-600 dark:border-blue-400 scale-[1.02] shadow-md'
      : '';

    return (
      <button
        key={seat.id}
        type="button"
        onClick={() => onSelectSeat(seat.id)}
        aria-label={`Seat ${seat.seatNumber}, ${seat.zone}, status ${seat.status.replace('_', ' ')}${isMine ? ', your booking' : ''}`}
        aria-pressed={isSelected}
        data-testid={`seat-${seat.seatNumber}`}
        className={`group relative flex min-h-[68px] flex-col justify-between rounded-xl border p-2.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${surfaceClass} ${selectedClass} ${
          dimmed ? 'opacity-30' : 'opacity-100'
        }`}
      >
        <div className="flex w-full items-center justify-between gap-1">
          <span className="font-mono text-xs font-bold tracking-tight tabular-nums">
            {seat.seatNumber}
          </span>
          <StatusIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium leading-none">
            {isMine ? 'Yours' : statusCode}
          </span>
          <div className="flex items-center gap-0.5 opacity-70">
            {seat.hasMonitor && <Monitor className="h-3 w-3" aria-hidden="true" />}
            {seat.isAccessible && <Accessibility className="h-3 w-3" aria-hidden="true" />}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* Floor Selector & Live Floor Metrics */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 2xl:flex-row 2xl:items-center">
          <div
            role="tablist"
            aria-label="Library floors"
            className="grid w-full grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 sm:w-auto sm:inline-grid dark:bg-slate-800"
          >
            {floors.map((floor) => {
              const fSeats = seats.filter((s) => s.floorId === floor.id);
              const fAvail = fSeats.filter((s) => s.status === 'available').length;
              const active = floor.id === activeFloorId;
              return (
                <button
                  key={floor.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectFloor(floor.id)}
                  className={`flex flex-col items-start justify-center rounded-lg px-3.5 py-2 text-left transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <span className="text-xs font-semibold sm:text-sm">{floor.name}</span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {fAvail}/{floor.totalSeats} free
                  </span>
                </button>
              );
            })}
          </div>

          {/* Floor Quick Stats */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Available: </span>
              <span className="font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                {floorStats.available}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Occupied: </span>
              <span className="font-mono font-semibold text-rose-700 tabular-nums dark:text-rose-400">
                {floorStats.occupied}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Reserved: </span>
              <span className="font-mono font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                {floorStats.reserved}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">On Break: </span>
              <span className="font-mono font-semibold text-orange-700 tabular-nums dark:text-orange-400">
                {floorStats.onBreak}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Occupancy: </span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {floorStats.occupancyPct}%
              </span>
            </div>
          </div>
        </div>

        {/* Floor Subtitle + Filters */}
        <div className="flex flex-col justify-between gap-3 border-t border-slate-100 pt-3.5 lg:flex-row lg:items-center dark:border-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {activeFloor?.name}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeFloor?.subtitle}</span>
            <span aria-hidden="true">·</span>
            <span>Acoustic Profile: {activeFloor?.quietLevel}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap shrink-0">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find seat (e.g. G-12)"
                aria-label="Search seats by number or zone"
                className="w-36 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <select
              aria-label="Filter seats by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available Only</option>
              <option value="reserved">Reserved</option>
              <option value="occupied">Occupied</option>
              <option value="on_break">On Break</option>
            </select>

            <select
              aria-label="Filter seats by study zone"
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value as 'all' | SeatZone)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">All Zones</option>
              <option value="Quiet Study">Quiet Study</option>
              <option value="Window Desk">Window Desk</option>
              <option value="Collaborative Pod">Collaborative Pod</option>
              <option value="Computer Carrel">Computer Carrel</option>
            </select>
          </div>
        </div>
      </div>

      {/* Architectural Interactive Blueprint */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {/* Legend */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded border border-emerald-500 bg-emerald-100 dark:bg-emerald-900/70" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded border border-rose-500 bg-rose-100 dark:bg-rose-900/70" />
              Occupied
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded border border-yellow-500 bg-yellow-100 dark:bg-yellow-900/70" />
              Reserved (Check-in Pending)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded border border-orange-500 bg-orange-100 dark:bg-orange-900/70" />
              On Break (20m Timer)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded border-2 border-blue-600 bg-white dark:border-blue-400 dark:bg-slate-900" />
              Selected Seat
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
              Power at all desks
            </span>
            <span className="flex items-center gap-1">
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              Monitor
            </span>
            <span className="flex items-center gap-1">
              <Accessibility className="h-3.5 w-3.5" aria-hidden="true" />
              Accessible
            </span>
          </div>
        </div>

        {/* North Entrance & QR Check-in Gate */}
        <div className="mb-5 flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
          <span className="flex items-center gap-2 font-medium">
            <DoorOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            Main Floor Entrance · Elevator & Stairwell Lobby
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            Windows along West & East perimeters
          </span>
        </div>

        {/* 3 Desk Wings separated by walkable aisles */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {banks.map((bank) => (
            <div
              key={bank.name}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/50"
            >
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{bank.name}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {bank.name === 'Center Hall' ? 'Main Aisle Access' : 'Window Perimeter'}
                </span>
              </div>

              <div className="space-y-3">
                {rows.map((rowIdx) => {
                  const pairSeats = bank.cols
                    .map((colIdx) =>
                      floorSeats.find((s) => s.rowIndex === rowIdx && s.colIndex === colIdx)
                    )
                    .filter((s): s is Seat => Boolean(s));

                  return (
                    <div key={rowIdx}>
                      {rowIdx === 2 && (
                        <div className="my-2.5 flex items-center justify-center rounded-md border border-dashed border-slate-300/80 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-700 dark:text-slate-500">
                          Cross Walkable Aisle
                        </div>
                      )}
                      <div className="rounded-xl border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-1.5 flex items-center justify-between px-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                          <span>Desk Row {rowIdx + 1}</span>
                          <span>{pairSeats[0]?.zone}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {pairSeats.map((seat) => renderSeatButton(seat))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
