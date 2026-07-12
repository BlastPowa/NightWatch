import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import { InsightsPanel } from '@/components/InsightsPanel';
import { RoomMilestones } from '@/components/RoomMilestones';
import { useAuthError } from '@/hooks/useAuth';
import { signInWithDiscord, signOut, type AuthUser } from '@/lib/auth';
import {
  createRoom,
  deleteRoom,
  listMyRooms,
  setRoomSchedule,
  updateRoomSettings,
  type PersistentRoom,
} from '@/lib/rooms/PersistentRoomService';

interface MyRoomsScreenProps {
  user: AuthUser | null;
  onJoinRoom(code: string): void;
}

function formatSchedule(iso: string | null): string {
  if (iso === null) {
    return 'No schedule';
  }
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Persistent community rooms (Phase 14, ADR-012). Requires Discord login. */
export function MyRoomsScreen({ user, onJoinRoom }: MyRoomsScreenProps): JSX.Element {
  const [rooms, setRooms] = useState<PersistentRoom[]>([]);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editSchedule, setEditSchedule] = useState('');
  const [premiereCode, setPremiereCode] = useState<string | null>(null);
  const [premiereLink, setPremiereLink] = useState('');
  const [insightsCode, setInsightsCode] = useState<string | null>(null);
  const authError = useAuthError();

  async function handleToggleInsights(room: PersistentRoom): Promise<void> {
    try {
      await updateRoomSettings(room.code, { insightsEnabled: !room.insightsEnabled });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update insights.');
    }
  }

  async function handleSavePremiere(code: string): Promise<void> {
    const videoId = extractVideoId(premiereLink);
    if (videoId === null) {
      setError('That does not look like a YouTube link.');
      return;
    }
    try {
      await updateRoomSettings(code, { premiereVideoId: videoId });
      setPremiereCode(null);
      setPremiereLink('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the premiere.');
    }
  }

  async function handleClearPremiere(code: string): Promise<void> {
    try {
      await updateRoomSettings(code, { premiereVideoId: null });
      setPremiereCode(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the premiere.');
    }
  }

  const refresh = useCallback((): void => {
    listMyRooms()
      .then(setRooms)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load rooms.'));
  }, []);

  useEffect(() => {
    if (user !== null) {
      refresh();
    } else {
      setRooms([]);
    }
  }, [user, refresh]);

  function toIso(localValue: string): string | null {
    return localValue === '' ? null : new Date(localValue).toISOString();
  }

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRoom(name, toIso(schedule));
      setName('');
      setSchedule('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the room.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule(code: string): Promise<void> {
    try {
      await setRoomSchedule(code, toIso(editSchedule));
      setEditingCode(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the schedule.');
    }
  }

  async function handleDelete(code: string): Promise<void> {
    try {
      await deleteRoom(code);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the room.');
    }
  }

  if (user === null) {
    return (
      <div className="settings-page fade-up">
        <h1 className="page-title">My Rooms</h1>
        <section className="card settings-card">
          <p className="user-sub">
            Persistent rooms keep the same code forever and can be scheduled — sign in with
            Discord to create yours. Joining rooms never requires an account.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              signInWithDiscord().catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Sign-in failed.'),
              );
            }}
          >
            Sign in with Discord
          </button>
          {authError !== null && <p className="form-error">Sign-in failed: {authError}</p>}
          {error !== null && <p className="form-error">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="settings-page fade-up">
      <h1 className="page-title">My Rooms</h1>

      <section className="card settings-card">
        <div className="about-header">
          {user.avatarUrl !== null && <img className="auth-avatar" src={user.avatarUrl} alt="" />}
          <div>
            <p className="user-name">{user.name}</p>
            <p className="user-sub">{rooms.length}/10 persistent rooms</p>
          </div>
          <button
            type="button"
            className="button auth-signout"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Create a room</h2>
        <form className="room-create-form" onSubmit={(e) => void handleCreate(e)}>
          <input
            className="input"
            value={name}
            maxLength={50}
            placeholder="Room name (e.g. Anime Night)"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field">
            <span className="field-label">Scheduled for (optional)</span>
            <input
              type="datetime-local"
              className="input"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
          </label>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create persistent room'}
          </button>
        </form>
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Your rooms</h2>
        {rooms.length === 0 && <p className="user-sub">No persistent rooms yet.</p>}
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.code} className="room-row">
              <div className="room-row-info">
                <span className="room-row-name">{room.name}</span>
                <span className="room-row-meta">
                  <span className="side-code">{room.code}</span> · {formatSchedule(room.scheduledAt)}
                </span>
                <RoomMilestones roomCode={room.code} />
              </div>
              {editingCode === room.code ? (
                <span className="room-row-actions">
                  <input
                    type="datetime-local"
                    className="input"
                    value={editSchedule}
                    onChange={(e) => setEditSchedule(e.target.value)}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => void handleSaveSchedule(room.code)}
                  >
                    Save
                  </button>
                  <button type="button" className="button" onClick={() => setEditingCode(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="room-row-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => onJoinRoom(room.code)}
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setEditingCode(room.code);
                      setEditSchedule('');
                    }}
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void handleToggleInsights(room)}
                    title="Anonymous session insights (viewer counts, reaction timing) — members see a notice when on"
                  >
                    Insights {room.insightsEnabled ? 'ON' : 'off'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setPremiereCode(premiereCode === room.code ? null : room.code);
                      setPremiereLink('');
                    }}
                  >
                    Premiere
                  </button>
                  {room.insightsEnabled && (
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        setInsightsCode(insightsCode === room.code ? null : room.code)
                      }
                    >
                      View insights
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void handleDelete(room.code)}
                  >
                    Delete
                  </button>
                </span>
              )}
              {premiereCode === room.code && (
                <span className="room-row-actions room-row-premiere">
                  <input
                    className="input"
                    value={premiereLink}
                    placeholder={
                      room.premiereVideoId !== null
                        ? `Premiere set (youtu.be/${room.premiereVideoId}) — paste to replace`
                        : 'Paste the premiere video link…'
                    }
                    onChange={(e) => setPremiereLink(e.target.value)}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => void handleSavePremiere(room.code)}
                  >
                    Save
                  </button>
                  {room.premiereVideoId !== null && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void handleClearPremiere(room.code)}
                    >
                      Clear
                    </button>
                  )}
                </span>
              )}
              {insightsCode === room.code && <InsightsPanel roomCode={room.code} />}
            </li>
          ))}
        </ul>
        {error !== null && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
