import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import type { Seat } from '../shared/types';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

interface ExpiredReleasePayload {
  bookingId: string;
  userId: string;
  seatId: string;
  seatNumber: string;
  kind: 'reservation_expired' | 'break_expired';
}

interface RealtimeCallbacks {
  onSeatsUpdated: (seats: Seat[], reason?: string, expiredReleases?: ExpiredReleasePayload[]) => void;
  onSyncNeeded: () => void;
}

export function useLibraryRealtime({ onSeatsUpdated, onSyncNeeded }: RealtimeCallbacks) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const callbacksRef = useRef({ onSeatsUpdated, onSyncNeeded });
  callbacksRef.current = { onSeatsUpdated, onSyncNeeded };

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    // Optional Supabase Realtime bridge if user configured external Supabase env vars
    const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
    const sbChannel = supabase
      ? supabase
          .channel('smart-library-seats')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'seats' }, () => {
            callbacksRef.current.onSyncNeeded();
          })
          .subscribe()
      : null;

    function connect() {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      setConnectionState(retryCount > 0 ? 'reconnecting' : 'connecting');

      ws = new WebSocket(url);

      ws.onopen = () => {
        if (closed) return;
        const wasReconnect = retryCount > 0;
        retryCount = 0;
        setConnectionState('connected');
        setLastSyncedAt(new Date().toISOString());
        if (wasReconnect) {
          // Resynchronize full state after reconnection
          callbacksRef.current.onSyncNeeded();
        }
      };

      ws.onmessage = (event) => {
        if (closed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'seats:sync' || msg.type === 'seats:updated') {
            setLastSyncedAt(msg.timestamp || new Date().toISOString());
            if (Array.isArray(msg.payload?.seats)) {
              callbacksRef.current.onSeatsUpdated(
                msg.payload.seats,
                msg.payload.reason,
                msg.payload.expiredReleases
              );
            } else {
              callbacksRef.current.onSyncNeeded();
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (closed) return;
        setConnectionState('reconnecting');
        retryCount += 1;
        const delayMs = Math.min(5000, 500 * Math.pow(1.6, retryCount));
        reconnectTimer = setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    // Also resync when browser tab regains visibility
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        callbacksRef.current.onSyncNeeded();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      if (sbChannel && supabase) {
        supabase.removeChannel(sbChannel);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return { connectionState, lastSyncedAt };
}
