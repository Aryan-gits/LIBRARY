import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  FLOOR_DEFINITIONS,
  PRODUCTION_BREAK_MINUTES,
  PRODUCTION_RESERVATION_MINUTES,
  computeAvgOccupancyMinutes,
  computeFloorUtilization,
  computePeakHoursFromBookings,
  detectSeatHoggingFlags,
  generateAllLibrarySeatsSeed,
  validateSeatQrToken,
} from '../src/shared/libraryRules.ts';
import type {
  AdminAnalytics,
  Booking,
  ConcurrencyTestResult,
  LibraryFloor,
  LibrarySettings,
  Seat,
  SeatEvent,
  UserProfile,
  UserRole,
} from '../src/shared/types.ts';
import { hashPassword, verifyPassword } from './auth.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'smart_library.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function initDatabaseSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      student_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
      department TEXT NOT NULL DEFAULT 'Computer Science',
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_floors (
      id INTEGER PRIMARY KEY,
      floor_number INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      total_seats INTEGER NOT NULL,
      quiet_level TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seats (
      id TEXT PRIMARY KEY,
      floor_id INTEGER NOT NULL REFERENCES library_floors(id) ON DELETE CASCADE,
      floor_number INTEGER NOT NULL,
      seat_number TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      zone TEXT NOT NULL,
      has_power INTEGER NOT NULL DEFAULT 1,
      has_monitor INTEGER NOT NULL DEFAULT 0,
      is_accessible INTEGER NOT NULL DEFAULT 0,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      desk_group TEXT NOT NULL,
      qr_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'occupied', 'on_break')),
      current_booking_id TEXT NULL,
      current_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      reservation_expires_at TEXT NULL,
      break_expires_at TEXT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      seat_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'occupied', 'on_break', 'completed', 'cancelled', 'expired')),
      booked_at TEXT NOT NULL,
      reservation_expires_at TEXT NULL,
      checked_in_at TEXT NULL,
      break_started_at TEXT NULL,
      break_expires_at TEXT NULL,
      break_count INTEGER NOT NULL DEFAULT 0,
      break_violations INTEGER NOT NULL DEFAULT 0,
      ended_at TEXT NULL,
      end_reason TEXT NULL
    );

    -- Enforce atomic concurrency invariants at database level
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking_seat
      ON bookings(seat_id)
      WHERE status IN ('reserved', 'occupied', 'on_break');

    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking_user
      ON bookings(user_id)
      WHERE status IN ('reserved', 'occupied', 'on_break');

    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, booked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

    CREATE TABLE IF NOT EXISTS check_in_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      seat_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      qr_token_submitted TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('initial_checkin', 'break_resume')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS break_sessions (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      seat_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resumed_at TEXT NULL,
      outcome TEXT NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'resumed', 'expired', 'cancelled'))
    );

    CREATE TABLE IF NOT EXISTS seat_events (
      id TEXT PRIMARY KEY,
      seat_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      booking_id TEXT NULL REFERENCES bookings(id) ON DELETE SET NULL,
      user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      reservation_expiry_minutes INTEGER NOT NULL DEFAULT 10,
      break_duration_minutes INTEGER NOT NULL DEFAULT 20
    );
  `);

  seedInitialData();
}

function seedInitialData() {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO library_settings (id, reservation_expiry_minutes, break_duration_minutes)
     VALUES (1, ?, ?)`
  ).run(PRODUCTION_RESERVATION_MINUTES, PRODUCTION_BREAK_MINUTES);

  const insertFloor = db.prepare(
    `INSERT OR IGNORE INTO library_floors (id, floor_number, name, subtitle, total_seats, quiet_level)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const f of FLOOR_DEFINITIONS) {
    insertFloor.run(f.id, f.floorNumber, f.name, f.subtitle, f.totalSeats, f.quietLevel);
  }

  const existingSeatCount = (db.prepare(`SELECT COUNT(*) as c FROM seats`).get() as { c: number }).c;
  if (existingSeatCount === 0) {
    const insertSeat = db.prepare(
      `INSERT INTO seats (
        id, floor_id, floor_number, seat_number, label, zone,
        has_power, has_monitor, is_accessible, row_index, col_index,
        desk_group, qr_token, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`
    );
    const allSeats = generateAllLibrarySeatsSeed();
    const tx = db.transaction(() => {
      for (const s of allSeats) {
        insertSeat.run(
          s.id,
          s.floorId,
          s.floorNumber,
          s.seatNumber,
          s.label,
          s.zone,
          s.hasPower ? 1 : 0,
          s.hasMonitor ? 1 : 0,
          s.isAccessible ? 1 : 0,
          s.rowIndex,
          s.colIndex,
          s.deskGroup,
          s.qrToken,
          nowIso
        );
      }
    });
    tx();
  }

  const existingUsersCount = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  if (existingUsersCount === 0) {
    seedUsersAndRealisticActivity();
  }
}

function seedUsersAndRealisticActivity() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const demoAccounts = [
    {
      id: 'user-demo-student',
      email: 'aarav.sharma@university.edu',
      pass: 'student123',
      fullName: 'Aarav Sharma',
      studentId: 'STU-2026-0412',
      department: 'Computer Science & Engineering',
      role: 'student',
      isDemo: 1,
    },
    {
      id: 'user-demo-admin',
      email: 'librarian.admin@university.edu',
      pass: 'admin123',
      fullName: 'Dr. Elena Rostova',
      studentId: 'ADM-0001',
      department: 'University Library Administration',
      role: 'admin',
      isDemo: 1,
    },
  ];

  const peerStudents = [
    { id: 'user-peer-01', email: 'maya.patel@university.edu', fullName: 'Maya Patel', studentId: 'STU-2026-1021', department: 'Electrical Engineering' },
    { id: 'user-peer-02', email: 'liam.chen@university.edu', fullName: 'Liam Chen', studentId: 'STU-2026-1044', department: 'Data Science' },
    { id: 'user-peer-03', email: 'sophia.rodriguez@university.edu', fullName: 'Sophia Rodriguez', studentId: 'STU-2026-1089', department: 'Architecture' },
    { id: 'user-peer-04', email: 'noah.kim@university.edu', fullName: 'Noah Kim', studentId: 'STU-2026-1102', department: 'Biomedical Engineering' },
    { id: 'user-peer-05', email: 'chloe.bennett@university.edu', fullName: 'Chloe Bennett', studentId: 'STU-2026-1135', department: 'Economics' },
    { id: 'user-peer-06', email: 'ethan.okafor@university.edu', fullName: 'Ethan Okafor', studentId: 'STU-2026-1168', department: 'Mechanical Engineering' },
    { id: 'user-peer-07', email: 'zara.ali@university.edu', fullName: 'Zara Ali', studentId: 'STU-2026-1190', department: 'Mathematics' },
    { id: 'user-peer-08', email: 'lucas.meyer@university.edu', fullName: 'Lucas Meyer', studentId: 'STU-2026-1214', department: 'Physics' },
    { id: 'user-peer-09', email: 'priya.nair@university.edu', fullName: 'Priya Nair', studentId: 'STU-2026-1242', department: 'Computer Science' },
    { id: 'user-peer-10', email: 'oliver.wright@university.edu', fullName: 'Oliver Wright', studentId: 'STU-2026-1288', department: 'Law' },
    { id: 'user-peer-11', email: 'hana.tanaka@university.edu', fullName: 'Hana Tanaka', studentId: 'STU-2026-1305', department: 'Chemistry' },
    { id: 'user-peer-12', email: 'daniel.park@university.edu', fullName: 'Daniel Park', studentId: 'STU-2026-1340', department: 'Civil Engineering' },
    { id: 'user-peer-13', email: 'amara.diallo@university.edu', fullName: 'Amara Diallo', studentId: 'STU-2026-1371', department: 'Medicine' },
    { id: 'user-peer-14', email: 'julian.foster@university.edu', fullName: 'Julian Foster', studentId: 'STU-2026-1399', department: 'Finance' },
  ];

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, student_id, department, role, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const acc of demoAccounts) {
      insertUser.run(
        acc.id,
        acc.email,
        hashPassword(acc.pass),
        acc.fullName,
        acc.studentId,
        acc.department,
        acc.role,
        acc.isDemo,
        nowIso
      );
    }

    const peerPassHash = hashPassword('peer-demo-pass');
    for (const p of peerStudents) {
      insertUser.run(p.id, p.email, peerPassHash, p.fullName, p.studentId, p.department, 'student', 1, nowIso);
    }

    // Seed active peer occupancy across the 3 floors (leaving plenty of green seats available)
    const activeAssignments: Array<{
      seatId: string;
      userId: string;
      status: 'occupied' | 'reserved' | 'on_break';
      hoursAgo: number;
      breakCount: number;
      breakViolations: number;
    }> = [
      // Ground Floor (6 active / 18 available)
      { seatId: 'seat-1-01', userId: 'user-peer-01', status: 'occupied', hoursAgo: 4.6, breakCount: 3, breakViolations: 1 },
      { seatId: 'seat-1-02', userId: 'user-peer-02', status: 'occupied', hoursAgo: 2.1, breakCount: 1, breakViolations: 0 },
      { seatId: 'seat-1-05', userId: 'user-peer-03', status: 'reserved', hoursAgo: 0.05, breakCount: 0, breakViolations: 0 },
      { seatId: 'seat-1-08', userId: 'user-peer-04', status: 'on_break', hoursAgo: 1.8, breakCount: 1, breakViolations: 0 },
      { seatId: 'seat-1-13', userId: 'user-peer-05', status: 'occupied', hoursAgo: 1.2, breakCount: 0, breakViolations: 0 },
      { seatId: 'seat-1-18', userId: 'user-peer-06', status: 'occupied', hoursAgo: 0.8, breakCount: 0, breakViolations: 0 },
      // First Floor (4 active / 20 available)
      { seatId: 'seat-2-01', userId: 'user-peer-07', status: 'occupied', hoursAgo: 5.2, breakCount: 2, breakViolations: 1 },
      { seatId: 'seat-2-04', userId: 'user-peer-08', status: 'on_break', hoursAgo: 2.4, breakCount: 2, breakViolations: 0 },
      { seatId: 'seat-2-11', userId: 'user-peer-09', status: 'reserved', hoursAgo: 0.04, breakCount: 0, breakViolations: 0 },
      { seatId: 'seat-2-16', userId: 'user-peer-10', status: 'occupied', hoursAgo: 1.5, breakCount: 0, breakViolations: 0 },
      // Second Floor (4 active / 20 available)
      { seatId: 'seat-3-02', userId: 'user-peer-11', status: 'occupied', hoursAgo: 4.3, breakCount: 1, breakViolations: 0 },
      { seatId: 'seat-3-07', userId: 'user-peer-12', status: 'occupied', hoursAgo: 3.1, breakCount: 1, breakViolations: 0 },
      { seatId: 'seat-3-12', userId: 'user-peer-13', status: 'on_break', hoursAgo: 1.4, breakCount: 1, breakViolations: 0 },
      { seatId: 'seat-3-19', userId: 'user-peer-14', status: 'reserved', hoursAgo: 0.03, breakCount: 0, breakViolations: 0 },
    ];

    const insertBooking = db.prepare(
      `INSERT INTO bookings (
        id, seat_id, user_id, status, booked_at, reservation_expires_at,
        checked_in_at, break_started_at, break_expires_at, break_count, break_violations,
        ended_at, end_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateSeat = db.prepare(
      `UPDATE seats
       SET status = ?, current_booking_id = ?, current_user_id = ?,
           reservation_expires_at = ?, break_expires_at = ?, updated_at = ?
       WHERE id = ?`
    );
    const insertEvent = db.prepare(
      `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const a of activeAssignments) {
      const bookingId = crypto.randomUUID();
      const bookedAtMs = now - a.hoursAgo * 3600_000;
      const bookedAtIso = new Date(bookedAtMs).toISOString();
      const checkedInIso = a.status === 'reserved' ? null : new Date(bookedAtMs + 4 * 60_000).toISOString();
      const resExpIso = a.status === 'reserved' ? new Date(now + 8 * 60_000).toISOString() : null;
      const breakStartIso = a.status === 'on_break' ? new Date(now - 6 * 60_000).toISOString() : null;
      const breakExpIso = a.status === 'on_break' ? new Date(now + 14 * 60_000).toISOString() : null;

      insertBooking.run(
        bookingId,
        a.seatId,
        a.userId,
        a.status,
        bookedAtIso,
        resExpIso,
        checkedInIso,
        breakStartIso,
        breakExpIso,
        a.breakCount,
        a.breakViolations,
        null,
        null
      );

      updateSeat.run(a.status, bookingId, a.userId, resExpIso, breakExpIso, nowIso, a.seatId);

      insertEvent.run(
        crypto.randomUUID(),
        a.seatId,
        bookingId,
        a.userId,
        a.status === 'reserved' ? 'booked' : a.status === 'on_break' ? 'break_started' : 'checked_in',
        'student',
        'Demo seed session',
        bookedAtIso
      );
    }

    // Seed completed / expired historical bookings today for realistic Peak Hours & Avg Duration analytics
    const todayBase = new Date(now);
    todayBase.setHours(8, 0, 0, 0);
    const baseMs = todayBase.getTime();
    const historicalSamples = [
      { seatId: 'seat-1-03', userId: 'user-peer-01', startOffsetHrs: 0.5, durationMins: 145, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-1-04', userId: 'user-peer-02', startOffsetHrs: 1.0, durationMins: 180, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-1-06', userId: 'user-peer-03', startOffsetHrs: 1.5, durationMins: 95, status: 'expired', violations: 1, reason: 'Break timer expired (20m limit exceeded)' },
      { seatId: 'seat-1-09', userId: 'user-peer-04', startOffsetHrs: 2.0, durationMins: 210, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-1-12', userId: 'user-peer-05', startOffsetHrs: 2.5, durationMins: 165, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-2-02', userId: 'user-peer-06', startOffsetHrs: 1.2, durationMins: 260, status: 'completed', violations: 1, reason: 'Break timer expired (20m limit exceeded)' },
      { seatId: 'seat-2-05', userId: 'user-peer-07', startOffsetHrs: 2.0, durationMins: 190, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-2-07', userId: 'user-peer-08', startOffsetHrs: 3.0, durationMins: 150, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-2-10', userId: 'user-peer-09', startOffsetHrs: 3.5, durationMins: 115, status: 'expired', violations: 1, reason: 'Break timer expired (20m limit exceeded)' },
      { seatId: 'seat-2-14', userId: 'user-peer-10', startOffsetHrs: 4.0, durationMins: 130, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-3-01', userId: 'user-peer-11', startOffsetHrs: 0.8, durationMins: 220, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-3-03', userId: 'user-peer-12', startOffsetHrs: 1.6, durationMins: 175, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-3-06', userId: 'user-peer-13', startOffsetHrs: 2.4, durationMins: 205, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-3-09', userId: 'user-peer-14', startOffsetHrs: 3.2, durationMins: 140, status: 'completed', violations: 0, reason: 'Checked out normally' },
      { seatId: 'seat-3-15', userId: 'user-peer-01', startOffsetHrs: 4.2, durationMins: 120, status: 'expired', violations: 0, reason: 'Reservation check-in window expired' },
    ];

    for (const h of historicalSamples) {
      const id = crypto.randomUUID();
      const bookedMs = Math.min(now - 30 * 60_000, baseMs + h.startOffsetHrs * 3600_000);
      const checkedInMs = h.reason.includes('Reservation') ? null : bookedMs + 3 * 60_000;
      const endedMs = Math.min(now - 5 * 60_000, bookedMs + h.durationMins * 60_000);

      insertBooking.run(
        id,
        h.seatId,
        h.userId,
        h.status,
        new Date(bookedMs).toISOString(),
        null,
        checkedInMs ? new Date(checkedInMs).toISOString() : null,
        null,
        null,
        h.violations > 0 ? 2 : 1,
        h.violations,
        new Date(endedMs).toISOString(),
        h.reason
      );

      insertEvent.run(
        crypto.randomUUID(),
        h.seatId,
        id,
        h.userId,
        h.status === 'expired' ? 'break_expired' : 'released',
        h.status === 'expired' ? 'system' : 'student',
        h.reason,
        new Date(endedMs).toISOString()
      );
    }
  });

  tx();
}

// --- Query Helpers ---

function mapUserRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    studentId: String(row.student_id),
    department: String(row.department),
    role: row.role as UserRole,
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
  };
}

export function getUserById(id: string): UserProfile | null {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapUserRow(row) : null;
}

export function authenticateUser(email: string, password: string): UserProfile {
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.trim()) as
    | (Record<string, unknown> & { password_hash: string })
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, 'Invalid email or password.');
  }
  return mapUserRow(row);
}

export function registerStudent(input: {
  email: string;
  password: string;
  fullName: string;
  studentId: string;
  department?: string;
}): UserProfile {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const studentId = input.studentId.trim().toUpperCase();
  const department = (input.department || 'General Studies').trim();

  if (!email || !email.includes('@')) throw new AppError(400, 'Please enter a valid university email.');
  if (!fullName || fullName.length < 2) throw new AppError(400, 'Full name is required.');
  if (!studentId || studentId.length < 3) throw new AppError(400, 'Student ID is required.');
  if (!input.password || input.password.length < 6) {
    throw new AppError(400, 'Password must be at least 6 characters.');
  }

  const existing = db
    .prepare(`SELECT id FROM users WHERE email = ? OR student_id = ?`)
    .get(email, studentId);
  if (existing) {
    throw new AppError(409, 'An account with this email or Student ID already exists.');
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, student_id, department, role, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'student', 0, ?)`
  ).run(id, email, hashPassword(input.password), fullName, studentId, department, createdAt);

  return getUserById(id)!;
}

export function getFloors(): LibraryFloor[] {
  const rows = db.prepare(`SELECT * FROM library_floors ORDER BY floor_number ASC`).all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: Number(r.id),
    floorNumber: Number(r.floor_number),
    name: String(r.name),
    subtitle: String(r.subtitle),
    totalSeats: Number(r.total_seats),
    quietLevel: r.quiet_level as LibraryFloor['quietLevel'],
  }));
}

export function getSettings(): LibrarySettings {
  const row = db.prepare(`SELECT * FROM library_settings WHERE id = 1`).get() as {
    reservation_expiry_minutes: number;
    break_duration_minutes: number;
  };
  return {
    reservationExpiryMinutes: row.reservation_expiry_minutes,
    breakDurationMinutes: row.break_duration_minutes,
  };
}

export function updateSettings(reservationExpiryMinutes: number): LibrarySettings {
  const clamped = Math.max(1, Math.min(60, Math.round(reservationExpiryMinutes)));
  db.prepare(`UPDATE library_settings SET reservation_expiry_minutes = ? WHERE id = 1`).run(clamped);
  return getSettings();
}

export function getAllSeats(includeUserNames = false): Seat[] {
  const rows = db
    .prepare(
      `SELECT s.*, u.full_name as occupant_name
       FROM seats s
       LEFT JOIN users u ON s.current_user_id = u.id
       ORDER BY s.floor_id ASC, s.row_index ASC, s.col_index ASC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    floorId: Number(r.floor_id),
    floorNumber: Number(r.floor_number),
    seatNumber: String(r.seat_number),
    label: String(r.label),
    zone: r.zone as Seat['zone'],
    hasPower: Boolean(r.has_power),
    hasMonitor: Boolean(r.has_monitor),
    isAccessible: Boolean(r.is_accessible),
    rowIndex: Number(r.row_index),
    colIndex: Number(r.col_index),
    deskGroup: String(r.desk_group),
    status: r.status as Seat['status'],
    qrToken: String(r.qr_token),
    currentBookingId: r.current_booking_id ? String(r.current_booking_id) : null,
    currentUserId: r.current_user_id ? String(r.current_user_id) : null,
    currentUserName: includeUserNames && r.occupant_name ? String(r.occupant_name) : null,
    reservationExpiresAt: r.reservation_expires_at ? String(r.reservation_expires_at) : null,
    breakExpiresAt: r.break_expires_at ? String(r.break_expires_at) : null,
    updatedAt: String(r.updated_at),
  }));
}

function mapBookingRow(r: Record<string, unknown>): Booking {
  return {
    id: String(r.id),
    seatId: String(r.seat_id),
    seatNumber: String(r.seat_number),
    floorId: Number(r.floor_id),
    floorName: String(r.floor_name),
    userId: String(r.user_id),
    userName: String(r.full_name),
    studentId: String(r.student_id),
    status: r.status as Booking['status'],
    bookedAt: String(r.booked_at),
    reservationExpiresAt: r.reservation_expires_at ? String(r.reservation_expires_at) : null,
    checkedInAt: r.checked_in_at ? String(r.checked_in_at) : null,
    breakStartedAt: r.break_started_at ? String(r.break_started_at) : null,
    breakExpiresAt: r.break_expires_at ? String(r.break_expires_at) : null,
    breakCount: Number(r.break_count),
    breakViolations: Number(r.break_violations),
    endedAt: r.ended_at ? String(r.ended_at) : null,
    endReason: r.end_reason ? String(r.end_reason) : null,
  };
}

const BOOKING_JOIN_SELECT = `
  SELECT b.*, s.seat_number, s.floor_id, f.name as floor_name, u.full_name, u.student_id
  FROM bookings b
  JOIN seats s ON b.seat_id = s.id
  JOIN library_floors f ON s.floor_id = f.id
  JOIN users u ON b.user_id = u.id
`;

export function getActiveBookingForUser(userId: string): Booking | null {
  const row = db
    .prepare(`${BOOKING_JOIN_SELECT} WHERE b.user_id = ? AND b.status IN ('reserved', 'occupied', 'on_break') LIMIT 1`)
    .get(userId) as Record<string, unknown> | undefined;
  return row ? mapBookingRow(row) : null;
}

export function getBookingHistoryForUser(userId: string): Booking[] {
  const rows = db
    .prepare(`${BOOKING_JOIN_SELECT} WHERE b.user_id = ? ORDER BY b.booked_at DESC LIMIT 20`)
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(mapBookingRow);
}

// ============================================================================
// ATOMIC TRANSACTIONAL BOOKING OPERATIONS (BEGIN IMMEDIATE)
// ============================================================================

export function bookSeatAtomic(userId: string, seatId: string): Booking {
  const tx = db.transaction((): string => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const settings = getSettings();
    const expiresIso = new Date(now + settings.reservationExpiryMinutes * 60_000).toISOString();

    const seat = db.prepare(`SELECT * FROM seats WHERE id = ?`).get(seatId) as
      | { id: string; seat_number: string; status: string }
      | undefined;

    if (!seat) {
      throw new AppError(404, 'Selected seat was not found.');
    }

    if (seat.status !== 'available') {
      throw new AppError(409, `Seat ${seat.seat_number} is currently ${seat.status.replace('_', ' ')} and cannot be booked.`);
    }

    const existingActive = db
      .prepare(`SELECT b.id, s.seat_number FROM bookings b JOIN seats s ON b.seat_id = s.id WHERE b.user_id = ? AND b.status IN ('reserved', 'occupied', 'on_break')`)
      .get(userId) as { id: string; seat_number: string } | undefined;

    if (existingActive) {
      throw new AppError(
        409,
        `You already have an active booking on seat ${existingActive.seat_number}. Release it before booking another seat.`
      );
    }

    const bookingId = crypto.randomUUID();

    // Conditional update guarantees atomic state transition
    const seatUpdate = db
      .prepare(
        `UPDATE seats
         SET status = 'reserved',
             current_booking_id = ?,
             current_user_id = ?,
             reservation_expires_at = ?,
             break_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND status = 'available'`
      )
      .run(bookingId, userId, expiresIso, nowIso, seatId);

    if (seatUpdate.changes !== 1) {
      throw new AppError(409, `Seat ${seat.seat_number} was just claimed by another student.`);
    }

    db.prepare(
      `INSERT INTO bookings (id, seat_id, user_id, status, booked_at, reservation_expires_at)
       VALUES (?, ?, ?, 'reserved', ?, ?)`
    ).run(bookingId, seatId, userId, nowIso, expiresIso);

    db.prepare(
      `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
       VALUES (?, ?, ?, ?, 'booked', 'student', ?, ?)`
    ).run(
      crypto.randomUUID(),
      seatId,
      bookingId,
      userId,
      `Reserved for ${settings.reservationExpiryMinutes}m awaiting QR check-in`,
      nowIso
    );

    return bookingId;
  });

  try {
    const bookingId = tx.immediate();
    const row = db.prepare(`${BOOKING_JOIN_SELECT} WHERE b.id = ?`).get(bookingId) as Record<string, unknown>;
    return mapBookingRow(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      throw new AppError(409, 'Booking conflict detected by database constraint. Seat or student already holds an active reservation.');
    }
    throw err;
  }
}

export function checkInSeatAtomic(userId: string, bookingId: string, qrToken: string): { booking: Booking; resumedFromBreak: boolean } {
  const tx = db.transaction((): boolean => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const booking = db
      .prepare(`SELECT * FROM bookings WHERE id = ? AND user_id = ?`)
      .get(bookingId, userId) as Record<string, unknown> | undefined;

    if (!booking) {
      throw new AppError(404, 'Active booking not found for your account.');
    }

    const status = String(booking.status);
    if (status !== 'reserved' && status !== 'on_break') {
      throw new AppError(409, `Cannot check in when booking status is "${status}".`);
    }

    const seatId = String(booking.seat_id);
    const seat = db.prepare(`SELECT * FROM seats WHERE id = ?`).get(seatId) as {
      id: string;
      floor_id: number;
      seat_number: string;
      qr_token: string;
    };

    const validation = validateSeatQrToken(qrToken, {
      floorId: seat.floor_id,
      seatNumber: seat.seat_number,
      qrToken: seat.qr_token,
    });
    if (!validation.valid) {
      throw new AppError(400, validation.reason || 'Invalid QR code.');
    }

    if (status === 'reserved' && booking.reservation_expires_at) {
      if (now > new Date(String(booking.reservation_expires_at)).getTime()) {
        throw new AppError(410, 'Reservation check-in window expired before QR scan.');
      }
    }

    if (status === 'on_break' && booking.break_expires_at) {
      if (now > new Date(String(booking.break_expires_at)).getTime()) {
        throw new AppError(410, 'Your 20-minute break has expired and the seat was released.');
      }
    }

    const resumedFromBreak = status === 'on_break';

    db.prepare(
      `UPDATE bookings
       SET status = 'occupied',
           checked_in_at = COALESCE(checked_in_at, ?),
           reservation_expires_at = NULL,
           break_expires_at = NULL
       WHERE id = ?`
    ).run(nowIso, bookingId);

    db.prepare(
      `UPDATE seats
       SET status = 'occupied',
           reservation_expires_at = NULL,
           break_expires_at = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(nowIso, seatId);

    if (resumedFromBreak) {
      db.prepare(
        `UPDATE break_sessions
         SET resumed_at = ?, outcome = 'resumed'
         WHERE booking_id = ? AND outcome = 'active'`
      ).run(nowIso, bookingId);
    }

    db.prepare(
      `INSERT INTO check_in_events (id, booking_id, seat_id, user_id, qr_token_submitted, event_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      bookingId,
      seatId,
      userId,
      validation.normalized,
      resumedFromBreak ? 'break_resume' : 'initial_checkin',
      nowIso
    );

    db.prepare(
      `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
       VALUES (?, ?, ?, ?, ?, 'student', ?, ?)`
    ).run(
      crypto.randomUUID(),
      seatId,
      bookingId,
      userId,
      resumedFromBreak ? 'break_ended' : 'checked_in',
      resumedFromBreak ? 'Resumed occupancy via QR scan before 20m limit' : 'Checked in via physical seat QR code',
      nowIso
    );

    return resumedFromBreak;
  });

  const resumedFromBreak = tx.immediate();
  const row = db.prepare(`${BOOKING_JOIN_SELECT} WHERE b.id = ?`).get(bookingId) as Record<string, unknown>;
  return { booking: mapBookingRow(row), resumedFromBreak };
}

export function startBreakAtomic(userId: string, bookingId: string): Booking {
  const tx = db.transaction(() => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const breakExpiresIso = new Date(now + PRODUCTION_BREAK_MINUTES * 60_000).toISOString();

    const booking = db
      .prepare(`SELECT * FROM bookings WHERE id = ? AND user_id = ?`)
      .get(bookingId, userId) as Record<string, unknown> | undefined;

    if (!booking) {
      throw new AppError(404, 'Booking not found.');
    }
    if (String(booking.status) !== 'occupied') {
      throw new AppError(409, 'Only checked-in occupied seats can start a break.');
    }

    const seatId = String(booking.seat_id);

    db.prepare(
      `UPDATE bookings
       SET status = 'on_break',
           break_started_at = ?,
           break_expires_at = ?,
           break_count = break_count + 1
       WHERE id = ?`
    ).run(nowIso, breakExpiresIso, bookingId);

    db.prepare(
      `UPDATE seats
       SET status = 'on_break',
           break_expires_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(breakExpiresIso, nowIso, seatId);

    db.prepare(
      `INSERT INTO break_sessions (id, booking_id, seat_id, user_id, started_at, expires_at, outcome)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    ).run(crypto.randomUUID(), bookingId, seatId, userId, nowIso, breakExpiresIso);

    db.prepare(
      `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
       VALUES (?, ?, ?, ?, 'break_started', 'student', '20-minute break started', ?)`
    ).run(crypto.randomUUID(), seatId, bookingId, userId, nowIso);
  });

  tx.immediate();
  const row = db.prepare(`${BOOKING_JOIN_SELECT} WHERE b.id = ?`).get(bookingId) as Record<string, unknown>;
  return mapBookingRow(row);
}

export function accelerateBreakForDemoAtomic(userId: string, bookingId: string, secondsRemaining = 12): Booking {
  const clampedSecs = Math.max(3, Math.min(120, Math.round(secondsRemaining)));
  const tx = db.transaction(() => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const newExpiryIso = new Date(now + clampedSecs * 1000).toISOString();

    const booking = db
      .prepare(`SELECT * FROM bookings WHERE id = ? AND user_id = ?`)
      .get(bookingId, userId) as Record<string, unknown> | undefined;

    if (!booking || String(booking.status) !== 'on_break') {
      throw new AppError(409, 'Accelerated timer test is only available while a break is active.');
    }

    const seatId = String(booking.seat_id);
    db.prepare(`UPDATE bookings SET break_expires_at = ? WHERE id = ?`).run(newExpiryIso, bookingId);
    db.prepare(`UPDATE seats SET break_expires_at = ?, updated_at = ? WHERE id = ?`).run(
      newExpiryIso,
      nowIso,
      seatId
    );
    db.prepare(`UPDATE break_sessions SET expires_at = ? WHERE booking_id = ? AND outcome = 'active'`).run(
      newExpiryIso,
      bookingId
    );
  });

  tx.immediate();
  const row = db.prepare(`${BOOKING_JOIN_SELECT} WHERE b.id = ?`).get(bookingId) as Record<string, unknown>;
  return mapBookingRow(row);
}

export function releaseBookingAtomic(userId: string, bookingId: string, isAdminOverride = false): Booking {
  const tx = db.transaction(() => {
    const nowIso = new Date().toISOString();
    const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as
      | Record<string, unknown>
      | undefined;

    if (!booking) {
      throw new AppError(404, 'Booking not found.');
    }

    if (!isAdminOverride && String(booking.user_id) !== userId) {
      throw new AppError(403, 'You can only release or cancel your own booking.');
    }

    const prevStatus = String(booking.status);
    if (prevStatus !== 'reserved' && prevStatus !== 'occupied' && prevStatus !== 'on_break') {
      throw new AppError(409, 'This booking is already closed.');
    }

    const nextBookingStatus = prevStatus === 'reserved' ? 'cancelled' : 'completed';
    const endReason = isAdminOverride
      ? 'Released by library administrator'
      : prevStatus === 'reserved'
        ? 'Cancelled by student before check-in'
        : 'Checked out and released by student';

    db.prepare(
      `UPDATE bookings SET status = ?, ended_at = ?, end_reason = ? WHERE id = ?`
    ).run(nextBookingStatus, nowIso, endReason, bookingId);

    if (prevStatus === 'on_break') {
      db.prepare(
        `UPDATE break_sessions SET outcome = 'cancelled' WHERE booking_id = ? AND outcome = 'active'`
      ).run(bookingId);
    }

    const seatId = String(booking.seat_id);
    db.prepare(
      `UPDATE seats
       SET status = 'available',
           current_booking_id = NULL,
           current_user_id = NULL,
           reservation_expires_at = NULL,
           break_expires_at = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(nowIso, seatId);

    db.prepare(
      `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      seatId,
      bookingId,
      String(booking.user_id),
      isAdminOverride ? 'admin_override' : prevStatus === 'reserved' ? 'cancelled' : 'released',
      isAdminOverride ? 'admin' : 'student',
      endReason,
      nowIso
    );
  });

  tx.immediate();
  const row = db.prepare(`${BOOKING_JOIN_SELECT} WHERE b.id = ?`).get(bookingId) as Record<string, unknown>;
  return mapBookingRow(row);
}

export interface ExpiredReleaseResult {
  bookingId: string;
  userId: string;
  seatId: string;
  seatNumber: string;
  kind: 'reservation_expired' | 'break_expired';
}

export function expireStaleBookingsAtomic(): ExpiredReleaseResult[] {
  const tx = db.transaction((): ExpiredReleaseResult[] => {
    const nowIso = new Date().toISOString();
    const expiredRows = db
      .prepare(
        `SELECT b.id, b.seat_id, b.user_id, b.status, s.seat_number
         FROM bookings b
         JOIN seats s ON b.seat_id = s.id
         WHERE (b.status = 'reserved' AND b.reservation_expires_at IS NOT NULL AND b.reservation_expires_at <= ?)
            OR (b.status = 'on_break' AND b.break_expires_at IS NOT NULL AND b.break_expires_at <= ?)`
      )
      .all(nowIso, nowIso) as Array<{
      id: string;
      seat_id: string;
      user_id: string;
      status: 'reserved' | 'on_break';
      seat_number: string;
    }>;

    if (expiredRows.length === 0) return [];

    const results: ExpiredReleaseResult[] = [];
    for (const row of expiredRows) {
      const isBreak = row.status === 'on_break';
      const endReason = isBreak
        ? 'Break timer expired (20m limit exceeded) — auto-released by server'
        : 'Reservation check-in window expired — auto-released by server';

      db.prepare(
        `UPDATE bookings
         SET status = 'expired',
             ended_at = ?,
             break_violations = break_violations + ?,
             end_reason = ?
         WHERE id = ?`
      ).run(nowIso, isBreak ? 1 : 0, endReason, row.id);

      if (isBreak) {
        db.prepare(`UPDATE break_sessions SET outcome = 'expired' WHERE booking_id = ? AND outcome = 'active'`).run(
          row.id
        );
      }

      db.prepare(
        `UPDATE seats
         SET status = 'available',
             current_booking_id = NULL,
             current_user_id = NULL,
             reservation_expires_at = NULL,
             break_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(nowIso, row.seat_id);

      db.prepare(
        `INSERT INTO seat_events (id, seat_id, booking_id, user_id, event_type, actor_role, note, created_at)
         VALUES (?, ?, ?, ?, ?, 'system', ?, ?)`
      ).run(
        crypto.randomUUID(),
        row.seat_id,
        row.id,
        row.user_id,
        isBreak ? 'break_expired' : 'reservation_expired',
        endReason,
        nowIso
      );

      results.push({
        bookingId: row.id,
        userId: row.user_id,
        seatId: row.seat_id,
        seatNumber: row.seat_number,
        kind: isBreak ? 'break_expired' : 'reservation_expired',
      });
    }

    return results;
  });

  return tx.immediate();
}

export function adminForceReleaseSeatAtomic(seatId: string): void {
  const seat = db.prepare(`SELECT current_booking_id, status FROM seats WHERE id = ?`).get(seatId) as
    | { current_booking_id: string | null; status: string }
    | undefined;
  if (!seat) throw new AppError(404, 'Seat not found.');
  if (seat.current_booking_id) {
    releaseBookingAtomic('admin', seat.current_booking_id, true);
  } else {
    db.prepare(
      `UPDATE seats SET status = 'available', current_booking_id = NULL, current_user_id = NULL, reservation_expires_at = NULL, break_expires_at = NULL, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), seatId);
  }
}

export function getAdminAnalytics(): AdminAnalytics {
  const floors = getFloors();
  const seats = getAllSeats(true);

  const allBookingRows = db
    .prepare(`${BOOKING_JOIN_SELECT} ORDER BY b.booked_at DESC LIMIT 200`)
    .all() as Array<Record<string, unknown>>;
  const bookings = allBookingRows.map(mapBookingRow);

  const eventRows = db
    .prepare(
      `SELECT e.*, s.seat_number, s.floor_id
       FROM seat_events e
       JOIN seats s ON e.seat_id = s.id
       ORDER BY e.created_at DESC LIMIT 40`
    )
    .all() as Array<Record<string, unknown>>;

  const recentEvents: SeatEvent[] = eventRows.map((r) => ({
    id: String(r.id),
    seatId: String(r.seat_id),
    seatNumber: String(r.seat_number),
    floorId: Number(r.floor_id),
    bookingId: r.booking_id ? String(r.booking_id) : null,
    userId: r.user_id ? String(r.user_id) : null,
    eventType: r.event_type as SeatEvent['eventType'],
    actorRole: r.actor_role as SeatEvent['actorRole'],
    note: String(r.note),
    createdAt: String(r.created_at),
  }));

  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayBookings = bookings.filter((b) => new Date(b.bookedAt).getTime() >= todayStart.getTime());

  const availableSeats = seats.filter((s) => s.status === 'available').length;
  const occupiedSeats = seats.filter((s) => s.status === 'occupied').length;
  const reservedSeats = seats.filter((s) => s.status === 'reserved').length;
  const onBreakSeats = seats.filter((s) => s.status === 'on_break').length;
  const autoReleasedCount = bookings.filter((b) => b.status === 'expired').length;

  return {
    summary: {
      totalSeats: seats.length,
      availableSeats,
      occupiedSeats,
      reservedSeats,
      onBreakSeats,
      totalBookingsToday: todayBookings.length,
      avgOccupancyMinutes: computeAvgOccupancyMinutes(bookings, now),
      autoReleasedCount,
    },
    floorUtilization: computeFloorUtilization(floors, seats),
    peakHours: computePeakHoursFromBookings(todayBookings.length > 0 ? todayBookings : bookings, seats.length, now),
    hoggingFlags: detectSeatHoggingFlags(bookings, floors, now),
    recentBookings: bookings.slice(0, 30),
    recentEvents,
  };
}

/**
 * Concurrency Proof Test:
 * Spawns N concurrent booking promises against the exact same seat inside a realistic
 * simultaneous contention burst, verifying that SQLite BEGIN IMMEDIATE + UNIQUE INDEX
 * guarantees exactly 1 winner and N-1 clean rejections, then cleans up the test seat.
 */
export async function runSeatConcurrencyStressTest(seatId: string, concurrency = 10): Promise<ConcurrencyTestResult> {
  const seat = db.prepare(`SELECT id, seat_number, status FROM seats WHERE id = ?`).get(seatId) as
    | { id: string; seat_number: string; status: string }
    | undefined;

  if (!seat) throw new AppError(404, 'Target seat not found.');
  if (seat.status !== 'available') {
    throw new AppError(409, `Pick an available (green) seat to run the concurrency test. ${seat.seat_number} is currently ${seat.status}.`);
  }

  // Create ephemeral test student accounts for the burst
  const count = Math.max(2, Math.min(20, concurrency));
  const testUsers: Array<{ id: string; name: string }> = [];
  const passHash = hashPassword('stress-test-pass');
  const nowIso = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const id = `stress-${crypto.randomUUID()}`;
    const name = `Concurrent Student #${i + 1}`;
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, student_id, department, role, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, 'Stress Test', 'student', 1, ?)`
    ).run(id, `${id}@test.edu`, passHash, name, `STRESS-${id.slice(7, 13).toUpperCase()}`, nowIso);
    testUsers.push({ id, name });
  }

  const started = performance.now();

  const outcomes = await Promise.all(
    testUsers.map(
      (u) =>
        new Promise<{ worker: string; success: boolean; status: number; message: string; bookingId?: string }>(
          (resolve) => {
            setImmediate(() => {
              try {
                const booking = bookSeatAtomic(u.id, seatId);
                resolve({
                  worker: u.name,
                  success: true,
                  status: 201,
                  message: `Acquired atomic lock & reserved ${seat.seat_number}`,
                  bookingId: booking.id,
                });
              } catch (err) {
                const status = err instanceof AppError ? err.statusCode : 409;
                const message = err instanceof Error ? err.message : 'Rejected by lock';
                resolve({
                  worker: u.name,
                  success: false,
                  status,
                  message,
                });
              }
            });
          }
        )
    )
  );

  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  const winner = outcomes.find((o) => o.success);

  // Clean up test booking & ephemeral users so the real seat remains clean after test
  db.transaction(() => {
    if (winner?.bookingId) {
      db.prepare(`DELETE FROM seat_events WHERE booking_id = ?`).run(winner.bookingId);
      db.prepare(`DELETE FROM bookings WHERE id = ?`).run(winner.bookingId);
      db.prepare(
        `UPDATE seats SET status = 'available', current_booking_id = NULL, current_user_id = NULL, reservation_expires_at = NULL, break_expires_at = NULL, updated_at = ? WHERE id = ?`
      ).run(new Date().toISOString(), seatId);
    }
    const delUser = db.prepare(`DELETE FROM users WHERE id = ?`);
    for (const u of testUsers) {
      delUser.run(u.id);
    }
  }).immediate();

  return {
    seatNumber: seat.seat_number,
    attemptedRequests: count,
    succeededCount: outcomes.filter((o) => o.success).length,
    rejectedCount: outcomes.filter((o) => !o.success).length,
    winningUser: winner ? winner.worker : null,
    durationMs,
    outcomes: outcomes.map(({ bookingId: _b, ...rest }) => rest),
  };
}
