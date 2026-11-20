import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type AuthenticatedRequest,
  createAuthMiddleware,
  requireAdmin,
  requireAuth,
  signSessionToken,
} from './server/auth.ts';
import {
  AppError,
  accelerateBreakForDemoAtomic,
  adminForceReleaseSeatAtomic,
  authenticateUser,
  bookSeatAtomic,
  checkInSeatAtomic,
  expireStaleBookingsAtomic,
  getActiveBookingForUser,
  getAdminAnalytics,
  getAllSeats,
  getBookingHistoryForUser,
  getFloors,
  getSettings,
  getUserById,
  initDatabaseSchema,
  registerStudent,
  releaseBookingAtomic,
  runSeatConcurrencyStressTest,
  startBreakAtomic,
  updateSettings,
} from './server/db.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  initDatabaseSchema();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(createAuthMiddleware(getUserById));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function sanitizeSeatsForPublic(includeNames = false) {
    const seats = getAllSeats(includeNames);
    if (includeNames) return seats;
    return seats.map(({ currentUserName: _hidden, ...rest }) => rest);
  }

  function broadcastEvent(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  function broadcastSeatsSync(reason: string, extra?: Record<string, unknown>) {
    broadcastEvent('seats:updated', {
      reason,
      seats: sanitizeSeatsForPublic(false),
      ...extra,
    });
  }

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'seats:sync',
        payload: {
          seats: sanitizeSeatsForPublic(false),
          floors: getFloors(),
          settings: getSettings(),
        },
        timestamp: new Date().toISOString(),
      })
    );
  });

  // Server-side authoritative expiry sweeper (runs every 2 seconds, independent of client browsers)
  const expiryTimer = setInterval(() => {
    try {
      const released = expireStaleBookingsAtomic();
      if (released.length > 0) {
        broadcastSeatsSync('auto_expiry', { expiredReleases: released });
      }
    } catch (err) {
      console.error('Expiry sweep error:', err);
    }
  }, 2000);

  // Clean shutdown
  process.on('SIGTERM', () => {
    clearInterval(expiryTimer);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });

  // Helper to set session cookie (works both locally on HTTP and over HTTPS shared URLs/iframes)
  function setSessionCookie(req: Request, res: Response, token: string) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('sl_session', token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });
  }

  // --- Health ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'express-sqlite-realtime', timestamp: new Date().toISOString() });
  });

  // --- Auth Endpoints ---
  app.post('/api/auth/register', (req, res, next) => {
    try {
      const { email, password, fullName, studentId, department } = req.body ?? {};
      const user = registerStudent({ email, password, fullName, studentId, department });
      const token = signSessionToken(user.id, user.role);
      setSessionCookie(req, res, token);
      res.status(201).json({ user, token });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        throw new AppError(400, 'Email and password are required.');
      }
      const user = authenticateUser(String(email), String(password));
      const token = signSessionToken(user.id, user.role);
      setSessionCookie(req, res, token);
      res.json({ user, token });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/demo-login', (req, res, next) => {
    try {
      const role = req.body?.role === 'admin' ? 'admin' : 'student';
      const userId = role === 'admin' ? 'user-demo-admin' : 'user-demo-student';
      const user = getUserById(userId);
      if (!user) {
        throw new AppError(404, 'Demo account is not seeded.');
      }
      const token = signSessionToken(user.id, user.role);
      setSessionCookie(req, res, token);
      res.json({ user, token });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('sl_session', {
      path: '/',
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
    });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser ?? null });
  });

  // --- Public Read / Live Library State ---
  app.get('/api/library/state', (req: AuthenticatedRequest, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    res.json({
      floors: getFloors(),
      seats: sanitizeSeatsForPublic(isAdmin),
      settings: getSettings(),
    });
  });

  // --- Student Protected Booking Operations ---
  app.get('/api/bookings/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    res.json({
      activeBooking: getActiveBookingForUser(userId),
      history: getBookingHistoryForUser(userId),
    });
  });

  app.post('/api/bookings/book', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const seatId = String(req.body?.seatId || '').trim();
      if (!seatId) {
        throw new AppError(400, 'seatId is required.');
      }
      const booking = bookSeatAtomic(req.authUser!.id, seatId);
      broadcastSeatsSync('seat_booked', { seatId, bookingId: booking.id });
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/bookings/:id/checkin', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const bookingId = String(req.params.id);
      const qrToken = String(req.body?.qrToken || '');
      const result = checkInSeatAtomic(req.authUser!.id, bookingId, qrToken);
      broadcastSeatsSync(result.resumedFromBreak ? 'break_ended' : 'checked_in', {
        bookingId: result.booking.id,
        seatId: result.booking.seatId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/bookings/:id/start-break', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const bookingId = String(req.params.id);
      const booking = startBreakAtomic(req.authUser!.id, bookingId);
      broadcastSeatsSync('break_started', { bookingId: booking.id, seatId: booking.seatId });
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/bookings/:id/release', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const bookingId = String(req.params.id);
      const booking = releaseBookingAtomic(req.authUser!.id, bookingId, false);
      broadcastSeatsSync('seat_released', { bookingId: booking.id, seatId: booking.seatId });
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  // --- Demo / Developer Verification Endpoints ---
  app.post('/api/demo/accelerate-break', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const bookingId = String(req.body?.bookingId || '');
      const secondsRemaining = Number(req.body?.secondsRemaining ?? 10);
      const booking = accelerateBreakForDemoAtomic(req.authUser!.id, bookingId, secondsRemaining);
      broadcastSeatsSync('demo_break_accelerated', { bookingId: booking.id, seatId: booking.seatId });
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/demo/concurrency-test', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const seatId = String(req.body?.seatId || '').trim();
      const concurrency = Number(req.body?.concurrency ?? 10);
      if (!seatId) {
        throw new AppError(400, 'Please select an available seat for the concurrency test.');
      }
      const result = await runSeatConcurrencyStressTest(seatId, concurrency);
      broadcastSeatsSync('concurrency_test_completed', { seatId });
      res.json({ result });
    } catch (err) {
      next(err);
    }
  });

  // --- Admin Protected Endpoints ---
  app.get('/api/admin/analytics', requireAdmin, (_req, res) => {
    res.json({
      analytics: getAdminAnalytics(),
      seats: getAllSeats(true),
      settings: getSettings(),
    });
  });

  app.post('/api/admin/seats/:seatId/release', requireAdmin, (req, res, next) => {
    try {
      const seatId = String(req.params.seatId);
      adminForceReleaseSeatAtomic(seatId);
      broadcastSeatsSync('admin_override_release', { seatId });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/settings', requireAdmin, (req, res, next) => {
    try {
      const mins = Number(req.body?.reservationExpiryMinutes);
      if (!Number.isFinite(mins)) {
        throw new AppError(400, 'Valid reservationExpiryMinutes is required.');
      }
      const settings = updateSettings(mins);
      broadcastSeatsSync('settings_updated', { settings });
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  // --- Error Handler ---
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // --- Vite Dev Middleware or Static Production Build ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Library server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
