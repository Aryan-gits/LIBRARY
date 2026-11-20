import type {
  Booking,
  FloorUtilizationPoint,
  LibraryFloor,
  PeakHourPoint,
  Seat,
  SeatHoggingFlag,
  SeatStatus,
  SeatZone,
} from './types.ts';

export const PRODUCTION_RESERVATION_MINUTES = 10;
export const PRODUCTION_BREAK_MINUTES = 20;

export const FLOOR_DEFINITIONS: LibraryFloor[] = [
  {
    id: 1,
    floorNumber: 0,
    name: 'Ground Floor',
    subtitle: 'Collaborative Commons & Express Terminals',
    totalSeats: 24,
    quietLevel: 'Collaborative',
  },
  {
    id: 2,
    floorNumber: 1,
    name: 'First Floor',
    subtitle: 'General Reading Hall & Window Carrels',
    totalSeats: 24,
    quietLevel: 'Moderate',
  },
  {
    id: 3,
    floorNumber: 2,
    name: 'Second Floor',
    subtitle: 'Deep Focus Silent Research Wing',
    totalSeats: 24,
    quietLevel: 'Silent',
  },
];

/**
 * Deterministic, tamper-evident QR token per physical seat.
 * Format: SL-F{floorId}-{seatNumber}-{checksum}
 */
export function buildSeatQrToken(floorId: number, seatNumber: string): string {
  const cleanSeat = seatNumber.trim().toUpperCase();
  const base = `SMARTLIB:${floorId}:${cleanSeat}:2026`;
  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const code = (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `SL-F${floorId}-${cleanSeat}-${code}`;
}

export function validateSeatQrToken(
  scannedRaw: string,
  expectedSeat: Pick<Seat, 'floorId' | 'seatNumber' | 'qrToken'>
): { valid: boolean; normalized: string; reason?: string } {
  const normalized = scannedRaw.trim().toUpperCase();
  if (!normalized) {
    return { valid: false, normalized, reason: 'QR payload is empty.' };
  }
  const canonical = buildSeatQrToken(expectedSeat.floorId, expectedSeat.seatNumber);
  if (normalized !== expectedSeat.qrToken.toUpperCase() && normalized !== canonical) {
    return {
      valid: false,
      normalized,
      reason: `QR code "${normalized}" does not match reserved seat ${expectedSeat.seatNumber}.`,
    };
  }
  return { valid: true, normalized };
}

export function generateFloorSeatsSeed(floorId: number): Array<{
  id: string;
  floorId: number;
  floorNumber: number;
  seatNumber: string;
  label: string;
  zone: SeatZone;
  hasPower: boolean;
  hasMonitor: boolean;
  isAccessible: boolean;
  rowIndex: number;
  colIndex: number;
  deskGroup: string;
  qrToken: string;
}> {
  const floorPrefix = floorId === 1 ? 'G' : floorId === 2 ? 'F1' : 'F2';
  const floorNum = floorId - 1;
  const seats: Array<{
    id: string;
    floorId: number;
    floorNumber: number;
    seatNumber: string;
    label: string;
    zone: SeatZone;
    hasPower: boolean;
    hasMonitor: boolean;
    isAccessible: boolean;
    rowIndex: number;
    colIndex: number;
    deskGroup: string;
    qrToken: string;
  }> = [];

  // 24 seats per floor arranged in 4 rows x 6 columns (3 desk banks separated by aisles)
  for (let i = 0; i < 24; i++) {
    const rowIndex = Math.floor(i / 6); // 0..3
    const colIndex = i % 6; // 0..5
    const numStr = String(i + 1).padStart(2, '0');
    const seatNumber = `${floorPrefix}-${numStr}`;

    let zone: SeatZone;
    if (floorId === 1) {
      zone = colIndex < 2 ? 'Computer Carrel' : rowIndex < 2 ? 'Collaborative Pod' : 'Window Desk';
    } else if (floorId === 2) {
      zone = colIndex === 0 || colIndex === 5 ? 'Window Desk' : rowIndex < 2 ? 'Quiet Study' : 'Collaborative Pod';
    } else {
      zone = colIndex === 0 || colIndex === 5 ? 'Window Desk' : 'Quiet Study';
    }

    const bank = colIndex < 2 ? 'West Wing' : colIndex < 4 ? 'Center Hall' : 'East Wing';
    const deskGroup = `${bank} · Desk ${rowIndex + 1}`;
    const hasPower = true;
    const hasMonitor = zone === 'Computer Carrel' || (floorId === 2 && colIndex === 1 && rowIndex < 2);
    const isAccessible = rowIndex === 0 && (colIndex === 2 || colIndex === 3);

    seats.push({
      id: `seat-${floorId}-${numStr}`,
      floorId,
      floorNumber: floorNum,
      seatNumber,
      label: `Seat ${seatNumber}`,
      zone,
      hasPower,
      hasMonitor,
      isAccessible,
      rowIndex,
      colIndex,
      deskGroup,
      qrToken: buildSeatQrToken(floorId, seatNumber),
    });
  }

  return seats;
}

export function generateAllLibrarySeatsSeed() {
  return FLOOR_DEFINITIONS.flatMap((floor) => generateFloorSeatsSeed(floor.id));
}

export function canTransitionSeatStatus(
  from: SeatStatus,
  action: 'book' | 'checkin' | 'start_break' | 'end_break' | 'release' | 'expire'
): boolean {
  switch (action) {
    case 'book':
      return from === 'available';
    case 'checkin':
      return from === 'reserved';
    case 'start_break':
      return from === 'occupied';
    case 'end_break':
      return from === 'on_break';
    case 'release':
      return from === 'reserved' || from === 'occupied' || from === 'on_break';
    case 'expire':
      return from === 'reserved' || from === 'on_break';
    default:
      return false;
  }
}

export function getRemainingSeconds(expiresAtIso: string | null, nowMs: number = Date.now()): number {
  if (!expiresAtIso) return 0;
  const targetMs = new Date(expiresAtIso).getTime();
  if (Number.isNaN(targetMs)) return 0;
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export type BreakWarningLevel = 'none' | 'five_min' | 'one_min' | 'expired';

export function evaluateBreakWarning(
  remainingSeconds: number,
  alreadyWarned5m: boolean,
  alreadyWarned1m: boolean
): { trigger: BreakWarningLevel } {
  if (remainingSeconds <= 0) {
    return { trigger: 'expired' };
  }
  if (remainingSeconds <= 60 && !alreadyWarned1m) {
    return { trigger: 'one_min' };
  }
  if (remainingSeconds <= 300 && remainingSeconds > 60 && !alreadyWarned5m) {
    return { trigger: 'five_min' };
  }
  return { trigger: 'none' };
}

export function computeFloorUtilization(
  floors: LibraryFloor[],
  seats: Seat[]
): FloorUtilizationPoint[] {
  return floors.map((floor) => {
    const floorSeats = seats.filter((s) => s.floorId === floor.id);
    const totalSeats = floorSeats.length || floor.totalSeats;
    const available = floorSeats.filter((s) => s.status === 'available').length;
    const occupied = floorSeats.filter((s) => s.status === 'occupied').length;
    const reserved = floorSeats.filter((s) => s.status === 'reserved').length;
    const onBreak = floorSeats.filter((s) => s.status === 'on_break').length;
    const active = occupied + reserved + onBreak;
    const utilizationPct = totalSeats > 0 ? Math.round((active / totalSeats) * 100) : 0;

    return {
      floorId: floor.id,
      floorName: floor.name,
      totalSeats,
      available,
      occupied,
      reserved,
      onBreak,
      utilizationPct,
    };
  });
}

export function computePeakHoursFromBookings(
  bookings: Booking[],
  totalSeats: number,
  referenceDateMs: number = Date.now()
): PeakHourPoint[] {
  const hours = Array.from({ length: 15 }, (_, idx) => idx + 8); // 08:00 to 22:00
  const refDate = new Date(referenceDateMs);
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const day = refDate.getDate();

  return hours.map((hour) => {
    const slotStartMs = new Date(year, month, day, hour, 0, 0).getTime();
    const slotEndMs = new Date(year, month, day, hour + 1, 0, 0).getTime();

    const activeInHour = new Set<string>();
    for (const b of bookings) {
      const startMs = new Date(b.bookedAt).getTime();
      const endMs = b.endedAt ? new Date(b.endedAt).getTime() : referenceDateMs;
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      if (startMs < slotEndMs && endMs >= slotStartMs && b.status !== 'cancelled') {
        activeInHour.add(b.seatId);
      }
    }

    const count = Math.min(totalSeats, activeInHour.size);
    const pct = totalSeats > 0 ? Math.round((count / totalSeats) * 100) : 0;
    const label = `${String(hour).padStart(2, '0')}:00`;

    return {
      hour: label,
      hourIndex: hour,
      occupancyCount: count,
      occupancyPct: pct,
    };
  });
}

export function computeAvgOccupancyMinutes(bookings: Booking[], nowMs: number = Date.now()): number {
  const checkedInBookings = bookings.filter((b) => b.checkedInAt);
  if (checkedInBookings.length === 0) return 0;

  let totalMinutes = 0;
  for (const b of checkedInBookings) {
    const startMs = new Date(b.checkedInAt!).getTime();
    const endMs = b.endedAt ? new Date(b.endedAt).getTime() : nowMs;
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      totalMinutes += (endMs - startMs) / 60000;
    }
  }

  return Math.round(totalMinutes / checkedInBookings.length);
}

export function detectSeatHoggingFlags(
  bookings: Booking[],
  floors: LibraryFloor[],
  nowMs: number = Date.now()
): SeatHoggingFlag[] {
  const floorById = new Map(floors.map((f) => [f.id, f.name]));
  const flags: SeatHoggingFlag[] = [];

  for (const b of bookings) {
    if (
      b.status !== 'occupied' &&
      b.status !== 'on_break' &&
      b.breakViolations === 0 &&
      !b.checkedInAt
    ) {
      continue;
    }

    const startMs = new Date(b.checkedInAt || b.bookedAt).getTime();
    const endMs = b.endedAt ? new Date(b.endedAt).getTime() : nowMs;
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    const isLongSession = durationMinutes >= 240; // 4+ hours continuous occupancy
    const hasBreakViolations = b.breakViolations >= 1;
    const hasExcessiveBreaks = b.breakCount >= 3;

    if (!isLongSession && !hasBreakViolations && !hasExcessiveBreaks) {
      continue;
    }

    const reasons: string[] = [];
    if (isLongSession) reasons.push(`Occupied ${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`);
    if (hasBreakViolations) reasons.push(`${b.breakViolations} expired break${b.breakViolations > 1 ? 's' : ''}`);
    if (hasExcessiveBreaks) reasons.push(`${b.breakCount} break cycles`);

    const riskLevel: SeatHoggingFlag['riskLevel'] =
      (isLongSession && hasBreakViolations) || b.breakViolations >= 2
        ? 'Review Recommended'
        : 'Elevated';

    flags.push({
      seatId: b.seatId,
      seatNumber: b.seatNumber,
      floorName: floorById.get(b.floorId) || b.floorName,
      userId: b.userId,
      userName: b.userName,
      studentId: b.studentId,
      durationMinutes,
      breakViolations: b.breakViolations,
      totalBreaks: b.breakCount,
      riskLevel,
      reason: reasons.join(' · '),
    });
  }

  return flags
    .sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) {
        return a.riskLevel === 'Review Recommended' ? -1 : 1;
      }
      return b.durationMinutes - a.durationMinutes;
    })
    .slice(0, 12);
}
