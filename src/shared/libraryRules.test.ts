import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR_DEFINITIONS,
  buildSeatQrToken,
  canTransitionSeatStatus,
  computeAvgOccupancyMinutes,
  computeFloorUtilization,
  computePeakHoursFromBookings,
  detectSeatHoggingFlags,
  evaluateBreakWarning,
  formatCountdown,
  generateAllLibrarySeatsSeed,
  getRemainingSeconds,
  validateSeatQrToken,
} from './libraryRules';
import type { Booking, Seat } from './types';

test('generates exactly 3 floors and 72 uniquely numbered seats (24 per floor)', () => {
  assert.equal(FLOOR_DEFINITIONS.length, 3);
  const seats = generateAllLibrarySeatsSeed();
  assert.equal(seats.length, 72);

  const uniqueIds = new Set(seats.map((s) => s.id));
  const uniqueNumbers = new Set(seats.map((s) => s.seatNumber));
  const uniqueQrTokens = new Set(seats.map((s) => s.qrToken));

  assert.equal(uniqueIds.size, 72);
  assert.equal(uniqueNumbers.size, 72);
  assert.equal(uniqueQrTokens.size, 72);

  assert.equal(seats.filter((s) => s.floorId === 1).length, 24);
  assert.equal(seats.filter((s) => s.floorId === 2).length, 24);
  assert.equal(seats.filter((s) => s.floorId === 3).length, 24);
});

test('QR validation accepts exact seat token (case-insensitive) and rejects mismatched seat tokens', () => {
  const tokenG01 = buildSeatQrToken(1, 'G-01');
  const tokenG02 = buildSeatQrToken(1, 'G-02');

  const ok = validateSeatQrToken(tokenG01.toLowerCase(), {
    floorId: 1,
    seatNumber: 'G-01',
    qrToken: tokenG01,
  });
  assert.equal(ok.valid, true);

  const mismatch = validateSeatQrToken(tokenG02, {
    floorId: 1,
    seatNumber: 'G-01',
    qrToken: tokenG01,
  });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.reason || '', /does not match/i);

  const empty = validateSeatQrToken('   ', {
    floorId: 1,
    seatNumber: 'G-01',
    qrToken: tokenG01,
  });
  assert.equal(empty.valid, false);
});

test('seat state transitions prevent double-booking and enforce valid lifecycle', () => {
  assert.equal(canTransitionSeatStatus('available', 'book'), true);
  assert.equal(canTransitionSeatStatus('reserved', 'book'), false);
  assert.equal(canTransitionSeatStatus('occupied', 'book'), false);
  assert.equal(canTransitionSeatStatus('on_break', 'book'), false);

  assert.equal(canTransitionSeatStatus('reserved', 'checkin'), true);
  assert.equal(canTransitionSeatStatus('available', 'checkin'), false);

  assert.equal(canTransitionSeatStatus('occupied', 'start_break'), true);
  assert.equal(canTransitionSeatStatus('reserved', 'start_break'), false);

  assert.equal(canTransitionSeatStatus('on_break', 'end_break'), true);
  assert.equal(canTransitionSeatStatus('occupied', 'end_break'), false);

  assert.equal(canTransitionSeatStatus('on_break', 'expire'), true);
  assert.equal(canTransitionSeatStatus('occupied', 'expire'), false);
});

test('break countdown formatting and 5m / 1m warning thresholds trigger accurately', () => {
  const now = new Date('2026-11-20T10:00:00.000Z').getTime();
  const expiresIn5m = '2026-11-20T10:05:00.000Z';
  const rem5m = getRemainingSeconds(expiresIn5m, now);
  assert.equal(rem5m, 300);
  assert.equal(formatCountdown(rem5m), '05:00');

  assert.equal(evaluateBreakWarning(300, false, false).trigger, 'five_min');
  assert.equal(evaluateBreakWarning(300, true, false).trigger, 'none');
  assert.equal(evaluateBreakWarning(59, true, false).trigger, 'one_min');
  assert.equal(evaluateBreakWarning(59, true, true).trigger, 'none');
  assert.equal(evaluateBreakWarning(0, true, true).trigger, 'expired');
});

test('analytics calculations reflect real booking activity and flag long/violating sessions', () => {
  const now = new Date('2026-11-20T15:00:00.000Z').getTime();
  const seedSeats = generateAllLibrarySeatsSeed();
  const seats: Seat[] = seedSeats.map((s, idx) => ({
    ...s,
    status: idx === 0 ? 'occupied' : idx === 1 ? 'on_break' : idx === 24 ? 'reserved' : 'available',
    currentBookingId: null,
    currentUserId: null,
    reservationExpiresAt: null,
    breakExpiresAt: null,
    updatedAt: new Date(now).toISOString(),
  }));

  const util = computeFloorUtilization(FLOOR_DEFINITIONS, seats);
  assert.equal(util[0].occupied, 1);
  assert.equal(util[0].onBreak, 1);
  assert.equal(util[0].available, 22);
  assert.equal(util[1].reserved, 1);

  const bookings: Booking[] = [
    {
      id: 'b1',
      seatId: 'seat-1-01',
      seatNumber: 'G-01',
      floorId: 1,
      floorName: 'Ground Floor',
      userId: 'u1',
      userName: 'Alice Chen',
      studentId: 'STU-101',
      status: 'occupied',
      bookedAt: '2026-11-20T10:00:00.000Z',
      reservationExpiresAt: null,
      checkedInAt: '2026-11-20T10:05:00.000Z',
      breakStartedAt: null,
      breakExpiresAt: null,
      breakCount: 2,
      breakViolations: 1,
      endedAt: null,
      endReason: null,
    },
  ];

  const avgMins = computeAvgOccupancyMinutes(bookings, now);
  assert.equal(avgMins, 295);

  const flags = detectSeatHoggingFlags(bookings, FLOOR_DEFINITIONS, now);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].riskLevel, 'Review Recommended');
  assert.equal(flags[0].seatNumber, 'G-01');

  const peak = computePeakHoursFromBookings(bookings, 72, now);
  const hour12 = peak.find((p) => p.hour === '12:00');
  assert.ok(hour12 && hour12.occupancyCount >= 1);
});
