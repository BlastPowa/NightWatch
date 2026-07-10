import { useState, type FormEvent } from 'react';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { sanitizeDisplayName } from '@/lib/identity';

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
    <section className="hero fade-up">
      <h1 className="hero-title">NightWatch</h1>
      <p className="hero-tagline">Watch together. Perfectly in sync.</p>

      <div className="card home-card">
        <label className="field">
          <span className="field-label">Display name</span>
          <input
            className="input"
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
          {lockedRoom ? 'Join the Watch Party' : 'Create Room'}
        </button>

        {!lockedRoom && (
          <>
            <div className="divider">or join with a code</div>

            <form className="join-form" onSubmit={handleJoin}>
              <input
                className="input input-code"
                value={joinCode}
                maxLength={6}
                placeholder="ROOM CODE"
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase());
                  setFormError(null);
                }}
              />
              <button type="submit" className="button">
                Join
              </button>
            </form>
          </>
        )}

        {formError !== null && <p className="form-error">{formError}</p>}
      </div>
    </section>
  );
}
