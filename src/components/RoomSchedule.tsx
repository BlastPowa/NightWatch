import { useCallback, useEffect, useState } from 'react';
import {
  listUpcomingRooms,
  RSVP_OPTIONS,
  setRsvp,
  type Rsvp,
  type UpcomingRoom,
} from '@/lib/room/InviteService';
import { getPlatformBridge } from '@/platform/PlatformBridge';

interface RoomScheduleProps {
  onJoinRoom(code: string): void;
}

const POLL_MS = 60_000;
/** How close to the start time a party counts as "starting soon". */
const SOON_MS = 5 * 60 * 1000;
const NOTIFIED_KEY = 'nightwatch.notifiedParties';

/** Rooms we have already alerted for, so a restart cannot re-alert. */
function loadNotified(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveNotified(ids: Set<string>): void {
  try {
    // Bounded: only the most recent parties matter.
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids].slice(-50)));
  } catch {
    // Storage unavailable — we simply may re-notify next launch.
  }
}

function startsIn(room: UpcomingRoom): number {
  return new Date(room.scheduledAt).getTime() - Date.now();
}

function formatCountdown(room: UpcomingRoom): string {
  const ms = startsIn(room);
  if (ms <= 0) {
    return 'Live now';
  }
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `in ${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `in ${hours}h`;
  }
  return new Date(room.scheduledAt).toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Upcoming watch parties (Phase 19): the rooms you own or RSVP'd to, with a
 * desktop alert when one is about to start. Alerts fire only for parties you
 * have not declined, and only once each.
 */
export function RoomSchedule({ onJoinRoom }: RoomScheduleProps): JSX.Element | null {
  const [rooms, setRooms] = useState<UpcomingRoom[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void listUpcomingRooms().then(setRooms);
  }, []);

  // Poll rather than subscribe: a schedule changes rarely, and this also
  // re-renders the countdown without a second timer.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Alert on parties about to start.
  useEffect(() => {
    const notified = loadNotified();
    let changed = false;

    for (const room of rooms) {
      const ms = startsIn(room);
      const key = `${room.code}:${room.scheduledAt}`;
      if (room.rsvp === 'declined' || notified.has(key) || ms > SOON_MS || ms < -SOON_MS) {
        continue;
      }
      getPlatformBridge().notify({
        title: 'Watch party starting',
        body: `${room.name} is starting now — ${room.code}`,
      });
      notified.add(key);
      changed = true;
    }

    if (changed) {
      saveNotified(notified);
    }
  }, [rooms]);

  async function handleRsvp(room: UpcomingRoom, rsvp: Rsvp): Promise<void> {
    setError(null);
    try {
      await setRsvp(room.code, rsvp);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your RSVP.');
    }
  }

  if (rooms.length === 0) {
    return null;
  }

  return (
    <section className="card settings-card">
      <h2 className="settings-heading">Upcoming watch parties</h2>
      <ul className="room-list">
        {rooms.map((room) => {
          const soon = startsIn(room) <= SOON_MS;
          return (
            <li key={room.code} className="room-row">
              <div className="room-row-info">
                <span className="room-row-name">
                  {room.name}
                  {soon && <span className="party-live"> ● {formatCountdown(room)}</span>}
                </span>
                <span className="room-row-meta">
                  <span className="side-code">{room.code}</span>
                  {!soon && ` · ${formatCountdown(room)}`}
                  {room.isOwner && ' · you host'}
                </span>
              </div>
              <span className="room-row-actions">
                {RSVP_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`source-tab${room.rsvp === option.id ? ' source-tab-active' : ''}`}
                    onClick={() => void handleRsvp(room, option.id)}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => onJoinRoom(room.code)}
                >
                  Join
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {error !== null && <p className="form-error">{error}</p>}
    </section>
  );
}
