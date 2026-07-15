import { useState, type FormEvent } from 'react';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { sanitizeDisplayName } from '@/lib/identity';
import '@/styles/phase27-secondary.css';

interface HomeScreenProps {
  initialName: string;
  /** True when the platform fixes the room (Discord Activity voice channel). */
  lockedRoom?: boolean;
  onEnterRoom(displayName: string, roomCode: string): void;
}

export function HomeScreen({
  initialName,
  lockedRoom = false,
  onEnterRoom,
}: HomeScreenProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const [joinCode, setJoinCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function validateName(): string | null {
    const clean = sanitizeDisplayName(name);
    if (clean.length === 0) {
      setFormError('Enter a display name first.');
      return null;
    }
    return clean;
  }

  function handleCreate(): void {
    const clean = validateName();
    if (clean !== null) {
      onEnterRoom(clean, generateRoomCode());
    }
  }

  function handleJoin(event: FormEvent): void {
    event.preventDefault();
    const clean = validateName();
    if (clean === null) {
      return;
    }
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setFormError('Room codes are 6 letters/numbers, e.g. KX3F9Q.');
      return;
    }
    onEnterRoom(clean, code);
  }

  return (
    <section className="lobby p27-lobby fade-up" aria-labelledby="home-title">
      <div className="lobby-story">
        <span className="eyebrow hero-eyebrow">Your private screening room</span>
        <h1 id="home-title" className="hero-title">Tonight is better together.</h1>
        <p className="hero-support">Open a room, invite your people, and keep every play, pause, queue pick, and reaction on the same beat.</p>
        <div className="lobby-features" aria-label="NightWatch room features">
          <span><b>Live</b> playback sync</span><span><b>Shared</b> queue and voting</span><span><b>Private</b> room codes</span>
        </div>
      </div>

      <div className="card home-card lobby-card">
        <div className="lobby-card-heading"><span className="eyebrow">Start watching</span><h2>{lockedRoom ? 'Join this watch party' : 'Create or join a room'}</h2><p>Your display name is only shown to people in the room.</p></div>
        <label className="field">
          <span className="field-label">Display name</span>
          <input
            className="input"
            autoComplete="nickname"
            aria-describedby={formError !== null ? 'home-form-error' : undefined}
            value={name}
            maxLength={24}
            placeholder="Your name"
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
          />
        </label>

        <button type="button" className="button button-primary button-lg" onClick={handleCreate}>
          {lockedRoom ? 'Join the watch party' : 'Create a new room'}
        </button>

        {!lockedRoom && (
          <>
            <div className="divider">Have an invite?</div>

            <form className="join-form" onSubmit={handleJoin}>
              <input
                className="input input-code"
                aria-label="Six-character room code"
                aria-describedby={formError !== null ? 'home-form-error' : undefined}
                value={joinCode}
                maxLength={6}
                placeholder="ROOM CODE"
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase());
                  setFormError(null);
                }}
              />
              <button type="submit" className="button">
                Join room
              </button>
            </form>
          </>
        )}

        {formError !== null && (
          <p id="home-form-error" className="form-error" role="alert">
            {formError}
          </p>
        )}
      </div>
    </section>
  );
}
