export type UserRole = 'student' | 'admin';

export type SeatStatus = 'available' | 'reserved' | 'occupied' | 'on_break';

export type BookingStatus =
  | 'reserved'
  | 'occupied'
  | 'on_break'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type SeatZone =
  | 'Quiet Study'
  | 'Collaborative Pod'
  | 'Window Desk'
  | 'Computer Carrel';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  studentId: string;
  department: string;
  role: UserRole;
  isDemo?: boolean;
  createdAt: string;
}

export interface LibraryFloor {
  id: number;
  floorNumber: number;
  name: string;
  subtitle: string;
  totalSeats: number;
  quietLevel: 'Silent' | 'Moderate' | 'Collaborative';
}

export interface Seat {
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
  status: SeatStatus;
  qrToken: string;
  currentBookingId: string | null;
  currentUserId: string | null;
  currentUserName?: string | null;
  reservationExpiresAt: string | null;
  breakExpiresAt: string | null;
  updatedAt: string;
}

export interface Booking {
  id: string;
  seatId: string;
  seatNumber: string;
  floorId: number;
  floorName: string;
  userId: string;
  userName: string;
  studentId: string;
  status: BookingStatus;
  bookedAt: string;
  reservationExpiresAt: string | null;
  checkedInAt: string | null;
  breakStartedAt: string | null;
  breakExpiresAt: string | null;
  breakCount: number;
  breakViolations: number;
  endedAt: string | null;
  endReason: string | null;
}

export interface SeatEvent {
  id: string;
  seatId: string;
  seatNumber: string;
  floorId: number;
  bookingId: string | null;
  userId: string | null;
  eventType:
    | 'booked'
    | 'checked_in'
    | 'break_started'
    | 'break_ended'
    | 'released'
    | 'cancelled'
    | 'reservation_expired'
    | 'break_expired'
    | 'admin_override';
  actorRole: UserRole | 'system';
  note: string;
  createdAt: string;
}

export interface LibrarySettings {
  reservationExpiryMinutes: number;
  breakDurationMinutes: number;
}

export interface PeakHourPoint {
  hour: string;
  hourIndex: number;
  occupancyCount: number;
  occupancyPct: number;
}

export interface FloorUtilizationPoint {
  floorId: number;
  floorName: string;
  totalSeats: number;
  available: number;
  occupied: number;
  reserved: number;
  onBreak: number;
  utilizationPct: number;
}

export interface SeatHoggingFlag {
  seatId: string;
  seatNumber: string;
  floorName: string;
  userId: string;
  userName: string;
  studentId: string;
  durationMinutes: number;
  breakViolations: number;
  totalBreaks: number;
  riskLevel: 'Review Recommended' | 'Elevated' | 'Normal';
  reason: string;
}

export interface AdminAnalytics {
  summary: {
    totalSeats: number;
    availableSeats: number;
    occupiedSeats: number;
    reservedSeats: number;
    onBreakSeats: number;
    totalBookingsToday: number;
    avgOccupancyMinutes: number;
    autoReleasedCount: number;
  };
  floorUtilization: FloorUtilizationPoint[];
  peakHours: PeakHourPoint[];
  hoggingFlags: SeatHoggingFlag[];
  recentBookings: Booking[];
  recentEvents: SeatEvent[];
}

export interface AppNotification {
  id: string;
  type:
    | 'booking_created'
    | 'checkin_success'
    | 'break_started'
    | 'break_warning_5m'
    | 'break_warning_1m'
    | 'auto_released'
    | 'booking_cancelled'
    | 'error'
    | 'info';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface ConcurrencyTestResult {
  seatNumber: string;
  attemptedRequests: number;
  succeededCount: number;
  rejectedCount: number;
  winningUser: string | null;
  durationMs: number;
  outcomes: Array<{
    worker: string;
    success: boolean;
    status: number;
    message: string;
  }>;
}
