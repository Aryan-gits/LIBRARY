-- ============================================================================
-- Smart Library — Intelligent Seat Finder & Booking System
-- Supabase PostgreSQL Initial Schema, Constraints, RLS & Atomic RPC Functions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. User Profiles & Roles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  student_id TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL DEFAULT 'Computer Science',
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Library Floors
CREATE TABLE IF NOT EXISTS public.library_floors (
  id INT PRIMARY KEY,
  floor_number INT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  total_seats INT NOT NULL DEFAULT 24,
  quiet_level TEXT NOT NULL CHECK (quiet_level IN ('Silent', 'Moderate', 'Collaborative'))
);

-- 3. Physical Library Seats (72 seats across 3 floors)
CREATE TABLE IF NOT EXISTS public.seats (
  id TEXT PRIMARY KEY,
  floor_id INT NOT NULL REFERENCES public.library_floors(id) ON DELETE CASCADE,
  seat_number TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('Quiet Study', 'Collaborative Pod', 'Window Desk', 'Computer Carrel')),
  has_power BOOLEAN NOT NULL DEFAULT true,
  has_monitor BOOLEAN NOT NULL DEFAULT false,
  is_accessible BOOLEAN NOT NULL DEFAULT false,
  row_index INT NOT NULL,
  col_index INT NOT NULL,
  desk_group TEXT NOT NULL,
  qr_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'occupied', 'on_break')),
  current_booking_id UUID NULL,
  current_user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  reservation_expires_at TIMESTAMPTZ NULL,
  break_expires_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seats_floor_status ON public.seats(floor_id, status);

-- 4. Bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id TEXT NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'occupied', 'on_break', 'completed', 'cancelled', 'expired')),
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reservation_expires_at TIMESTAMPTZ NULL,
  checked_in_at TIMESTAMPTZ NULL,
  break_started_at TIMESTAMPTZ NULL,
  break_expires_at TIMESTAMPTZ NULL,
  break_count INT NOT NULL DEFAULT 0,
  break_violations INT NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ NULL,
  end_reason TEXT NULL
);

-- CRITICAL CONCURRENCY CONSTRAINTS:
-- Guarantee at most ONE active booking per seat AND at most ONE active booking per student
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking_per_seat
  ON public.bookings(seat_id)
  WHERE status IN ('reserved', 'occupied', 'on_break');

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking_per_user
  ON public.bookings(user_id)
  WHERE status IN ('reserved', 'occupied', 'on_break');

CREATE INDEX IF NOT EXISTS idx_bookings_user_booked_at ON public.bookings(user_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_expiry ON public.bookings(status, reservation_expires_at, break_expires_at);

-- 5. Check-In Events
CREATE TABLE IF NOT EXISTS public.check_in_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qr_token_submitted TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('initial_checkin', 'break_resume')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Break Sessions
CREATE TABLE IF NOT EXISTS public.break_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resumed_at TIMESTAMPTZ NULL,
  outcome TEXT NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'resumed', 'expired', 'cancelled'))
);

-- 7. Seat Status & Audit History Events
CREATE TABLE IF NOT EXISTS public.seat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id TEXT NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  booking_id UUID NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'booked', 'checked_in', 'break_started', 'break_ended',
    'released', 'cancelled', 'reservation_expired', 'break_expired', 'admin_override'
  )),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('student', 'admin', 'system')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper: Check Admin Role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_in_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.break_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users read own profile or admin reads all" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users update own non-role profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Anyone authenticated reads floors" ON public.library_floors
  FOR SELECT USING (true);

CREATE POLICY "Anyone reads live seat map" ON public.seats
  FOR SELECT USING (true);

CREATE POLICY "Students read own bookings; admins read all" ON public.bookings
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Students read own check-ins; admins read all" ON public.check_in_events
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Students read own breaks; admins read all" ON public.break_sessions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Admins read audit seat events" ON public.seat_events
  FOR SELECT USING (public.is_admin());

-- ============================================================================
-- ATOMIC POSTGRESQL BOOKING RPC FUNCTIONS (Row-level locking with FOR UPDATE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.book_seat(p_seat_id TEXT, p_reservation_minutes INT DEFAULT 10)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_seat public.seats%ROWTYPE;
  v_existing_booking public.bookings%ROWTYPE;
  v_new_booking public.bookings%ROWTYPE;
  v_expires TIMESTAMPTZ := now() + make_interval(mins => p_reservation_minutes);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Lock the seat row exclusively to eliminate concurrent double-bookings
  SELECT * INTO v_seat FROM public.seats WHERE id = p_seat_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seat not found';
  END IF;

  IF v_seat.status <> 'available' THEN
    RAISE EXCEPTION 'Seat % is currently % and cannot be booked', v_seat.seat_number, v_seat.status;
  END IF;

  -- Verify student does not already hold an active booking
  SELECT * INTO v_existing_booking
  FROM public.bookings
  WHERE user_id = v_user_id AND status IN ('reserved', 'occupied', 'on_break')
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'You already have an active booking on seat %', v_existing_booking.seat_id;
  END IF;

  INSERT INTO public.bookings (seat_id, user_id, status, booked_at, reservation_expires_at)
  VALUES (p_seat_id, v_user_id, 'reserved', now(), v_expires)
  RETURNING * INTO v_new_booking;

  UPDATE public.seats
  SET status = 'reserved',
      current_booking_id = v_new_booking.id,
      current_user_id = v_user_id,
      reservation_expires_at = v_expires,
      break_expires_at = NULL,
      updated_at = now()
  WHERE id = p_seat_id;

  INSERT INTO public.seat_events (seat_id, booking_id, user_id, event_type, actor_role, note)
  VALUES (p_seat_id, v_new_booking.id, v_user_id, 'booked', 'student', 'Seat reserved pending QR check-in');

  RETURN v_new_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in_seat(p_booking_id UUID, p_qr_token TEXT)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_seat public.seats%ROWTYPE;
  v_kind TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active booking not found for this student';
  END IF;

  IF v_booking.status NOT IN ('reserved', 'on_break') THEN
    RAISE EXCEPTION 'Booking status % does not allow QR check-in', v_booking.status;
  END IF;

  SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id FOR UPDATE;
  IF upper(trim(p_qr_token)) <> upper(v_seat.qr_token) THEN
    RAISE EXCEPTION 'Invalid QR code for seat %', v_seat.seat_number;
  END IF;

  IF v_booking.status = 'reserved' THEN
    IF v_booking.reservation_expires_at IS NOT NULL AND now() > v_booking.reservation_expires_at THEN
      RAISE EXCEPTION 'Reservation expired before check-in';
    END IF;
    v_kind := 'initial_checkin';
  ELSE
    IF v_booking.break_expires_at IS NOT NULL AND now() > v_booking.break_expires_at THEN
      RAISE EXCEPTION '20-minute break has already expired';
    END IF;
    v_kind := 'break_resume';
    UPDATE public.break_sessions
    SET resumed_at = now(), outcome = 'resumed'
    WHERE booking_id = v_booking.id AND outcome = 'active';
  END IF;

  UPDATE public.bookings
  SET status = 'occupied',
      checked_in_at = COALESCE(checked_in_at, now()),
      reservation_expires_at = NULL,
      break_expires_at = NULL
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  UPDATE public.seats
  SET status = 'occupied',
      reservation_expires_at = NULL,
      break_expires_at = NULL,
      updated_at = now()
  WHERE id = v_booking.seat_id;

  INSERT INTO public.check_in_events (booking_id, seat_id, user_id, qr_token_submitted, event_kind)
  VALUES (v_booking.id, v_booking.seat_id, v_user_id, upper(trim(p_qr_token)), v_kind);

  INSERT INTO public.seat_events (seat_id, booking_id, user_id, event_type, actor_role, note)
  VALUES (
    v_booking.seat_id,
    v_booking.id,
    v_user_id,
    CASE WHEN v_kind = 'initial_checkin' THEN 'checked_in' ELSE 'break_ended' END,
    'student',
    'Verified via physical seat QR token'
  );

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_break(p_booking_id UUID, p_break_minutes INT DEFAULT 20)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_expires TIMESTAMPTZ := now() + make_interval(mins => p_break_minutes);
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status <> 'occupied' THEN
    RAISE EXCEPTION 'Only checked-in occupied bookings can start a break';
  END IF;

  UPDATE public.bookings
  SET status = 'on_break',
      break_started_at = now(),
      break_expires_at = v_expires,
      break_count = break_count + 1
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  UPDATE public.seats
  SET status = 'on_break',
      break_expires_at = v_expires,
      updated_at = now()
  WHERE id = v_booking.seat_id;

  INSERT INTO public.break_sessions (booking_id, seat_id, user_id, started_at, expires_at)
  VALUES (v_booking.id, v_booking.seat_id, v_user_id, now(), v_expires);

  INSERT INTO public.seat_events (seat_id, booking_id, user_id, event_type, actor_role, note)
  VALUES (v_booking.seat_id, v_booking.id, v_user_id, 'break_started', 'student', '20-minute break started');

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_bookings()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.bookings
    WHERE (status = 'reserved' AND reservation_expires_at < now())
       OR (status = 'on_break' AND break_expires_at < now())
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET status = 'expired',
        ended_at = now(),
        break_violations = CASE WHEN v_rec.status = 'on_break' THEN break_violations + 1 ELSE break_violations END,
        end_reason = CASE WHEN v_rec.status = 'on_break' THEN 'Break timer expired (20m limit exceeded)' ELSE 'Reservation check-in window expired' END
    WHERE id = v_rec.id;

    IF v_rec.status = 'on_break' THEN
      UPDATE public.break_sessions SET outcome = 'expired'
      WHERE booking_id = v_rec.id AND outcome = 'active';
    END IF;

    UPDATE public.seats
    SET status = 'available',
        current_booking_id = NULL,
        current_user_id = NULL,
        reservation_expires_at = NULL,
        break_expires_at = NULL,
        updated_at = now()
    WHERE id = v_rec.seat_id;

    INSERT INTO public.seat_events (seat_id, booking_id, user_id, event_type, actor_role, note)
    VALUES (
      v_rec.seat_id,
      v_rec.id,
      v_rec.user_id,
      CASE WHEN v_rec.status = 'on_break' THEN 'break_expired' ELSE 'reservation_expired' END,
      'system',
      'Automatically released by server-side expiry sweep'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Enable Supabase Realtime for live seat map updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.seats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;

-- Optional pg_cron schedule (run in Supabase SQL Editor if pg_cron extension is enabled)
-- SELECT cron.schedule('release-expired-library-seats', '* * * * *', $$SELECT public.release_expired_bookings();$$);

-- Seed 3 Library Floors
INSERT INTO public.library_floors (id, floor_number, name, subtitle, total_seats, quiet_level) VALUES
  (1, 0, 'Ground Floor', 'Collaborative Commons & Express Terminals', 24, 'Collaborative'),
  (2, 1, 'First Floor', 'General Reading Hall & Window Carrels', 24, 'Moderate'),
  (3, 2, 'Second Floor', 'Deep Focus Silent Research Wing', 24, 'Silent')
ON CONFLICT (id) DO NOTHING;
