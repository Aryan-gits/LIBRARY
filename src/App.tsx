import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  FileText,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Moon,
  QrCode,
  ShieldCheck,
  Sun,
  User as UserIcon,
  Wifi,
  X,
} from 'lucide-react';
import { ActiveBookingPanel } from './components/ActiveBookingPanel';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal } from './components/AuthModal';
import { FloorMap } from './components/FloorMap';
import { MyBookingsView } from './components/MyBookingsView';
import { QrPrintSheet } from './components/QrPrintSheet';
import { QrScannerModal } from './components/QrScannerModal';
import { SeatDetailPanel } from './components/SeatDetailPanel';
import { SetupDocsView } from './components/SetupDocsView';
import { ToastContainer } from './components/ToastContainer';
import { useLibraryRealtime } from './hooks/useLibraryRealtime';
import { api } from './lib/api';
import { FLOOR_DEFINITIONS } from './shared/libraryRules';
import type {
  AppNotification,
  Booking,
  ConcurrencyTestResult,
  LibraryFloor,
  LibrarySettings,
  Seat,
  UserProfile,
} from './shared/types';

type NavView = 'map' | 'bookings' | 'admin' | 'qr' | 'docs';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sl_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [activeView, setActiveView] = useState<NavView>('map');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [floors, setFloors] = useState<LibraryFloor[]>(FLOOR_DEFINITIONS);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [settings, setSettings] = useState<LibrarySettings>({
    reservationExpiryMinutes: 10,
    breakDurationMinutes: 20,
  });
  const [activeFloorId, setActiveFloorId] = useState<number>(1);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [bookingHistory, setBookingHistory] = useState<Booking[]>([]);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);

  const userRef = useRef<UserProfile | null>(null);
  userRef.current = user;
  const activeBookingRef = useRef<Booking | null>(null);
  activeBookingRef.current = activeBooking;

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('sl_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore
    }
  }, [darkMode]);

  const pushNotification = useCallback(
    (type: AppNotification['type'], title: string, message: string) => {
      const item: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        title,
        message,
        createdAt: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [item, ...prev].slice(0, 30));
      setToasts((prev) => [item, ...prev].slice(0, 4));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 6000);
    },
    []
  );

  const fetchMyBookings = useCallback(async () => {
    if (!userRef.current) {
      setActiveBooking(null);
      setBookingHistory([]);
      return;
    }
    try {
      const data = await api.getMyBookings();
      setActiveBooking(data.activeBooking);
      setBookingHistory(data.history);
    } catch {
      // Ignore if session expired
    }
  }, []);

  const syncFullLibraryState = useCallback(async () => {
    try {
      const data = await api.getLibraryState();
      setFloors(data.floors);
      setSeats(data.seats);
      setSettings(data.settings);
      if (userRef.current) {
        await fetchMyBookings();
      }
    } catch {
      // Ignore transient error
    }
  }, [fetchMyBookings]);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        const [libRes, meRes] = await Promise.all([api.getLibraryState(), api.getMe()]);
        if (!mounted) return;
        setFloors(libRes.floors);
        setSeats(libRes.seats);
        setSettings(libRes.settings);
        setUser(meRes.user);
        userRef.current = meRes.user;

        // Default select the first available seat on Ground Floor
        const firstAvail = libRes.seats.find((s) => s.floorId === 1 && s.status === 'available');
        if (firstAvail) setSelectedSeatId(firstAvail.id);

        if (meRes.user) {
          const mine = await api.getMyBookings();
          if (!mounted) return;
          setActiveBooking(mine.activeBooking);
          setBookingHistory(mine.history);
          if (mine.activeBooking) {
            setActiveFloorId(mine.activeBooking.floorId);
            setSelectedSeatId(mine.activeBooking.seatId);
          }
        }
      } finally {
        if (mounted) setLoadingInitial(false);
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, []);

  const { connectionState } = useLibraryRealtime({
    onSeatsUpdated: (updatedSeats, reason, expiredReleases) => {
      setSeats(updatedSeats);
      const currentUser = userRef.current;
      const currentBooking = activeBookingRef.current;

      if (reason === 'auto_expiry' && Array.isArray(expiredReleases) && currentUser) {
        const mineExpired = expiredReleases.filter((e) => e.userId === currentUser.id);
        for (const exp of mineExpired) {
          pushNotification(
            'auto_released',
            `Seat ${exp.seatNumber} automatically released`,
            exp.kind === 'break_expired'
              ? 'Your 20-minute break timer expired and the seat was returned to Available.'
              : 'Your reservation check-in window expired before QR scan.'
          );
        }
      }

      if (currentUser && (reason === 'auto_expiry' || currentBooking)) {
        fetchMyBookings();
      }
    },
    onSyncNeeded: () => {
      syncFullLibraryState();
    },
  });

  const libraryTotals = useMemo(() => {
    const total = seats.length || 72;
    const available = seats.filter((s) => s.status === 'available').length;
    const occupancyPct = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
    return { total, available, occupancyPct };
  }, [seats]);

  const selectedSeat = useMemo(
    () => seats.find((s) => s.id === selectedSeatId) || null,
    [seats, selectedSeatId]
  );

  async function handleAuthenticated(loggedInUser: UserProfile) {
    setUser(loggedInUser);
    userRef.current = loggedInUser;
    await fetchMyBookings();
    await syncFullLibraryState();
    pushNotification(
      'info',
      `Signed in as ${loggedInUser.fullName}`,
      loggedInUser.role === 'admin'
        ? 'Administrator privileges active.'
        : `Student ID ${loggedInUser.studentId} ready for booking.`
    );
  }

  async function handleDemoSwitch(role: 'student' | 'admin') {
    try {
      const loggedIn = await api.demoLogin(role);
      await handleAuthenticated(loggedIn);
      if (role === 'admin' && activeView === 'bookings') {
        setActiveView('admin');
      }
    } catch (err) {
      pushNotification('error', 'Demo login failed', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
    userRef.current = null;
    setActiveBooking(null);
    setBookingHistory([]);
    if (activeView === 'admin') {
      setActiveView('map');
    }
    pushNotification('info', 'Signed out', 'Your session has been closed.');
  }

  async function handleBookSeat(seat: Seat) {
    try {
      const { booking } = await api.bookSeat(seat.id);
      setActiveBooking(booking);
      await fetchMyBookings();
      await syncFullLibraryState();
      pushNotification(
        'booking_created',
        `Seat ${booking.seatNumber} booked`,
        `Reserved on ${booking.floorName}. Please scan the seat QR code within ${settings.reservationExpiryMinutes} minutes.`
      );
    } catch (err) {
      pushNotification(
        'error',
        'Could not book seat',
        err instanceof Error ? err.message : 'Seat unavailable'
      );
      await syncFullLibraryState();
    }
  }

  async function handleCheckInQr(qrToken: string) {
    if (!activeBooking) return;
    const { booking, resumedFromBreak } = await api.checkInSeat(activeBooking.id, qrToken);
    setActiveBooking(booking);
    await fetchMyBookings();
    await syncFullLibraryState();
    pushNotification(
      'checkin_success',
      resumedFromBreak ? `Resumed Seat ${booking.seatNumber}` : `Checked in to Seat ${booking.seatNumber}`,
      resumedFromBreak
        ? 'Break ended cleanly. Your seat remains occupied.'
        : 'QR check-in verified. Seat status is now Occupied.'
    );
  }

  async function handleStartBreak() {
    if (!activeBooking) return;
    try {
      const { booking } = await api.startBreak(activeBooking.id);
      setActiveBooking(booking);
      await syncFullLibraryState();
      pushNotification(
        'break_started',
        `20-minute break started (${booking.seatNumber})`,
        'Scan the seat QR code again before 20:00 expires to keep your seat.'
      );
    } catch (err) {
      pushNotification('error', 'Unable to start break', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleReleaseBooking() {
    if (!activeBooking) return;
    try {
      const wasReserved = activeBooking.status === 'reserved';
      const seatNum = activeBooking.seatNumber;
      await api.releaseBooking(activeBooking.id);
      setActiveBooking(null);
      await fetchMyBookings();
      await syncFullLibraryState();
      pushNotification(
        'booking_cancelled',
        wasReserved ? `Booking cancelled (${seatNum})` : `Seat ${seatNum} released`,
        'The seat is now available for other students.'
      );
    } catch (err) {
      pushNotification('error', 'Release failed', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleAccelerateBreakDemo() {
    if (!activeBooking) return;
    try {
      const { booking } = await api.accelerateBreakForDemo(activeBooking.id, 10);
      setActiveBooking(booking);
      pushNotification(
        'info',
        'Demo timer accelerated to 10s',
        'Even if you refresh or close this tab, the server sweeper will auto-release this seat in 10 seconds.'
      );
    } catch (err) {
      pushNotification('error', 'Demo timer error', err instanceof Error ? err.message : 'Error');
    }
  }

  const handleBreakWarning = useCallback(
    (level: 'five_min' | 'one_min', seatNumber: string) => {
      if (level === 'five_min') {
        pushNotification(
          'break_warning_5m',
          `5 minutes remaining (${seatNumber})`,
          'Please return to your desk and scan the seat QR code within 5 minutes.'
        );
      } else {
        pushNotification(
          'break_warning_1m',
          `1 minute remaining (${seatNumber})`,
          'Final warning: your seat will automatically release when the timer reaches 00:00.'
        );
      }
    },
    [pushNotification]
  );

  function handleConcurrencyCompleted(result: ConcurrencyTestResult) {
    pushNotification(
      'info',
      `Concurrency test passed (${result.seatNumber})`,
      `${result.attemptedRequests} simultaneous requests: ${result.succeededCount} succeeded, ${result.rejectedCount} atomically rejected in ${result.durationMs}ms.`
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  const navItems: Array<{ id: NavView; label: string; icon: typeof MapPin }> = [
    { id: 'map', label: 'Floor Map', icon: MapPin },
    { id: 'bookings', label: 'My Bookings', icon: CalendarClock },
    { id: 'admin', label: 'Admin Analytics', icon: BarChart3 },
    { id: 'qr', label: 'QR Codes', icon: QrCode },
    { id: 'docs', label: 'Setup & Docs', icon: FileText },
  ];

  const viewTitles: Record<NavView, string> = {
    map: 'Live Library Floor Map',
    bookings: 'Student Bookings & Profile',
    admin: 'Administrator Analytics',
    qr: 'Printable Seat QR Registry',
    docs: 'Architecture & Setup Guide',
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Workspace Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveView('map')}
            className="flex items-center gap-2.5 text-left"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap dark:text-slate-100">
              Smart Library
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation drawer"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Account & Demo Role Switcher */}
        <div className="border-t border-slate-200 p-4 space-y-3 dark:border-slate-800">
          {user ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                  {user.fullName}
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                  {user.role}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {user.studentId}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Student / Admin Sign In
            </button>
          )}

          {/* Clearly Labeled Demo Mode Switcher */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Demo Mode Quick Switch
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleDemoSwitch('student')}
                className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  user?.id === 'user-demo-student'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <UserIcon className="h-3 w-3" aria-hidden="true" />
                Student
              </button>
              <button
                type="button"
                onClick={() => handleDemoSwitch('admin')}
                className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  user?.id === 'user-demo-admin'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Admin
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar (Clean 3-zone header) */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
          {/* Zone 1: View Context */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-slate-900 sm:text-base dark:text-slate-100">
                {viewTitles[activeView]}
              </h1>
              <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
                <span className="font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                  {libraryTotals.available}/{libraryTotals.total}
                </span>{' '}
                seats available ·{' '}
                <span className="font-mono tabular-nums">{libraryTotals.occupancyPct}%</span> occupied
              </p>
            </div>
          </div>

          {/* Zone 2: Live Sync Telemetry */}
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Wifi
              className={`h-3.5 w-3.5 ${
                connectionState === 'connected'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-500'
              }`}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">
              {connectionState === 'connected' ? 'Realtime Sync Active' : 'Synchronizing...'}
            </span>
          </div>

          {/* Zone 3: Primary Controls */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                aria-label={`Notifications (${unreadCount} unread)`}
                onClick={() => {
                  setNotificationsOpen((prev) => !prev);
                  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                }}
                className="relative rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 font-mono text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifications([])}
                      className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        No notifications yet.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="p-3.5 text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {n.title}
                          </div>
                          <div className="mt-0.5 text-slate-600 dark:text-slate-400">
                            {n.message}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">
                            {new Date(n.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Light / Dark Toggle */}
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Primary CTA */}
            {activeBooking && (activeBooking.status === 'reserved' || activeBooking.status === 'on_break') ? (
              <button
                type="button"
                onClick={() => setQrModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 whitespace-nowrap shrink-0"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                {activeBooking.status === 'on_break' ? 'Resume QR' : 'Check In QR'}
              </button>
            ) : !user ? (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 whitespace-nowrap shrink-0"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign In
              </button>
            ) : null}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-5 p-4 sm:p-6">
          {/* Active Student Booking Banner (visible across views when holding a seat) */}
          {activeBooking && (
            <ActiveBookingPanel
              booking={activeBooking}
              onOpenQrCheckIn={() => setQrModalOpen(true)}
              onStartBreak={handleStartBreak}
              onReleaseBooking={handleReleaseBooking}
              onAccelerateBreakDemo={handleAccelerateBreakDemo}
              onBreakWarning={handleBreakWarning}
            />
          )}

          {loadingInitial ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="h-[540px] animate-pulse rounded-2xl border border-slate-200 bg-white lg:col-span-8 dark:border-slate-800 dark:bg-slate-900" />
              <div className="h-[420px] animate-pulse rounded-2xl border border-slate-200 bg-white lg:col-span-4 dark:border-slate-800 dark:bg-slate-900" />
            </div>
          ) : activeView === 'map' ? (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
              <div className="xl:col-span-8">
                <FloorMap
                  floors={floors}
                  seats={seats}
                  activeFloorId={activeFloorId}
                  selectedSeatId={selectedSeatId}
                  currentUserId={user?.id || null}
                  onSelectFloor={(fid) => {
                    setActiveFloorId(fid);
                    const firstOnFloor = seats.find((s) => s.floorId === fid);
                    if (firstOnFloor) setSelectedSeatId(firstOnFloor.id);
                  }}
                  onSelectSeat={(sid) => setSelectedSeatId(sid)}
                />
              </div>

              <div className="xl:col-span-4 xl:sticky xl:top-22">
                <SeatDetailPanel
                  seat={selectedSeat}
                  floor={floors.find((f) => f.id === selectedSeat?.floorId)}
                  user={user}
                  activeBooking={activeBooking}
                  onBookSeat={handleBookSeat}
                  onOpenAuth={() => setAuthModalOpen(true)}
                  onOpenQrCheckIn={() => setQrModalOpen(true)}
                  onConcurrencyCompleted={handleConcurrencyCompleted}
                />
              </div>
            </div>
          ) : activeView === 'bookings' ? (
            <MyBookingsView
              user={user}
              activeBooking={activeBooking}
              history={bookingHistory}
              onOpenAuth={() => setAuthModalOpen(true)}
              onGoToFloorMap={() => setActiveView('map')}
            />
          ) : activeView === 'admin' ? (
            <AdminDashboard
              user={user}
              onOpenAuth={() => setAuthModalOpen(true)}
              onSwitchToDemoAdmin={() => handleDemoSwitch('admin')}
              onSeatsChanged={syncFullLibraryState}
              onNotify={(t, title, msg) => pushNotification(t, title, msg)}
            />
          ) : activeView === 'qr' ? (
            <QrPrintSheet floors={floors} seats={seats} />
          ) : (
            <SetupDocsView />
          )}
        </main>
      </div>

      {/* Modals & Toasts */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      <QrScannerModal
        open={qrModalOpen}
        booking={activeBooking}
        seats={seats}
        onClose={() => setQrModalOpen(false)}
        onSubmitQr={handleCheckInQr}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
