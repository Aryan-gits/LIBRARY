import type {
  AdminAnalytics,
  Booking,
  ConcurrencyTestResult,
  LibraryFloor,
  LibrarySettings,
  Seat,
  UserProfile,
} from '../shared/types';

const TOKEN_STORAGE_KEY = 'smart_library_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted iframes
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getLibraryState: () =>
    apiRequest<{ floors: LibraryFloor[]; seats: Seat[]; settings: LibrarySettings }>('/api/library/state'),

  getMe: () => apiRequest<{ user: UserProfile | null }>('/api/auth/me'),

  login: async (email: string, password: string) => {
    const res = await apiRequest<{ user: UserProfile; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.token);
    return res.user;
  },

  register: async (payload: {
    email: string;
    password: string;
    fullName: string;
    studentId: string;
    department: string;
  }) => {
    const res = await apiRequest<{ user: UserProfile; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(res.token);
    return res.user;
  },

  demoLogin: async (role: 'student' | 'admin') => {
    const res = await apiRequest<{ user: UserProfile; token: string }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setStoredToken(res.token);
    return res.user;
  },

  logout: async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
    }
  },

  getMyBookings: () =>
    apiRequest<{ activeBooking: Booking | null; history: Booking[] }>('/api/bookings/me'),

  bookSeat: (seatId: string) =>
    apiRequest<{ booking: Booking }>('/api/bookings/book', {
      method: 'POST',
      body: JSON.stringify({ seatId }),
    }),

  checkInSeat: (bookingId: string, qrToken: string) =>
    apiRequest<{ booking: Booking; resumedFromBreak: boolean }>(`/api/bookings/${bookingId}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ qrToken }),
    }),

  startBreak: (bookingId: string) =>
    apiRequest<{ booking: Booking }>(`/api/bookings/${bookingId}/start-break`, {
      method: 'POST',
    }),

  releaseBooking: (bookingId: string) =>
    apiRequest<{ booking: Booking }>(`/api/bookings/${bookingId}/release`, {
      method: 'POST',
    }),

  accelerateBreakForDemo: (bookingId: string, secondsRemaining = 10) =>
    apiRequest<{ booking: Booking }>('/api/demo/accelerate-break', {
      method: 'POST',
      body: JSON.stringify({ bookingId, secondsRemaining }),
    }),

  runConcurrencyTest: (seatId: string, concurrency = 10) =>
    apiRequest<{ result: ConcurrencyTestResult }>('/api/demo/concurrency-test', {
      method: 'POST',
      body: JSON.stringify({ seatId, concurrency }),
    }),

  getAdminAnalytics: () =>
    apiRequest<{ analytics: AdminAnalytics; seats: Seat[]; settings: LibrarySettings }>(
      '/api/admin/analytics'
    ),

  adminReleaseSeat: (seatId: string) =>
    apiRequest<{ ok: boolean }>(`/api/admin/seats/${seatId}/release`, {
      method: 'POST',
    }),

  updateAdminSettings: (reservationExpiryMinutes: number) =>
    apiRequest<{ settings: LibrarySettings }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ reservationExpiryMinutes }),
    }),
};
