import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookSeatAtomic,
  checkInSeatAtomic,
  db,
  expireStaleBookingsAtomic,
  getActiveBookingForUser,
  getAllSeats,
  initDatabaseSchema,
  releaseBookingAtomic,
  runSeatConcurrencyStressTest,
  startBreakAtomic,
} from './db';

initDatabaseSchema();

function ensureDemoStudentClean() {
  const active = getActiveBookingForUser('user-demo-student');
  if (active) {
    releaseBookingAtomic('user-demo-student', active.id, false);
  }
  db.prepare(`DELETE FROM seat_events WHERE user_id = 'user-demo-student'`).run();
  db.prepare(`DELETE FROM check_in_events WHERE user_id = 'user-demo-student'`).run();
  db.prepare(`DELETE FROM break_sessions WHERE user_id = 'user-demo-student'`).run();
  db.prepare(`DELETE FROM bookings WHERE user_id = 'user-demo-student'`).run();
}

test('atomic concurrency stress test allows exactly 1 winner out of 12 simultaneous attempts', async () => {
  ensureDemoStudentClean();
  const availableSeat = getAllSeats().find((s) => s.status === 'available');
  assert.ok(availableSeat, 'Expected at least one available seat in seed data');

  const result = await runSeatConcurrencyStressTest(availableSeat.id, 12);
  assert.equal(result.attemptedRequests, 12);
  assert.equal(result.succeededCount, 1);
  assert.equal(result.rejectedCount, 11);

  const seatAfter = getAllSeats().find((s) => s.id === availableSeat.id)!;
  assert.equal(seatAfter.status, 'available');
});

test('full booking -> invalid QR rejection -> valid QR check-in -> break -> server expiry flow', (t) => {
  ensureDemoStudentClean();
  t.after(() => ensureDemoStudentClean());

  const availableSeats = getAllSeats().filter((s) => s.status === 'available' && s.floorId === 2);
  assert.ok(availableSeats.length >= 2);
  const targetSeat = availableSeats[0];
  const otherAvailableSeat = availableSeats[1];

  // Book as demo student
  const booking = bookSeatAtomic('user-demo-student', targetSeat.id);
  assert.equal(booking.status, 'reserved');

  // Cannot book a second available seat while holding an active booking
  assert.throws(
    () => bookSeatAtomic('user-demo-student', otherAvailableSeat.id),
    /already have an active booking/i
  );

  // Wrong QR code must be rejected
  assert.throws(
    () => checkInSeatAtomic('user-demo-student', booking.id, otherAvailableSeat.qrToken),
    /does not match/i
  );

  // Correct QR code succeeds -> status occupied
  const checkedIn = checkInSeatAtomic('user-demo-student', booking.id, targetSeat.qrToken);
  assert.equal(checkedIn.booking.status, 'occupied');
  assert.equal(checkedIn.resumedFromBreak, false);

  // Start 20-minute break -> status on_break
  const onBreak = startBreakAtomic('user-demo-student', booking.id);
  assert.equal(onBreak.status, 'on_break');
  assert.ok(onBreak.breakExpiresAt);

  // Simulate server-side expiry in DB (as if 20 minutes elapsed with browser closed)
  const pastIso = new Date(Date.now() - 5000).toISOString();
  db.prepare(`UPDATE bookings SET break_expires_at = ? WHERE id = ?`).run(pastIso, booking.id);
  db.prepare(`UPDATE seats SET break_expires_at = ? WHERE id = ?`).run(pastIso, targetSeat.id);

  const expired = expireStaleBookingsAtomic();
  assert.ok(expired.some((e) => e.bookingId === booking.id && e.kind === 'break_expired'));

  const seatFinal = getAllSeats().find((s) => s.id === targetSeat.id)!;
  assert.equal(seatFinal.status, 'available');
});

test('student cannot release another users booking', (t) => {
  ensureDemoStudentClean();
  t.after(() => ensureDemoStudentClean());

  const availableSeat = getAllSeats().find((s) => s.status === 'available' && s.floorId === 3);
  assert.ok(availableSeat);

  const booking = bookSeatAtomic('user-demo-student', availableSeat.id);
  assert.throws(
    () => releaseBookingAtomic('user-peer-01', booking.id, false),
    /only release or cancel your own booking/i
  );
});
