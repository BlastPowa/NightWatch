import { useCallback, useEffect, useState } from 'react';
import {
  listMyClubs,
  setClubSuspended,
  setClubVisibility,
  type Club,
} from '@/lib/social/CreatorService';

/**
 * TEMPORARY SCAFFOLD — Phase 21. Structure is real; the styling is not.
 *
 * FOR THE FRONTEND LANE: fold this into whatever club-management surface you
 * design and restyle it completely. `useMyClubs` holds every call; rebuild the
 * markup around it and nothing else changes.
 *
 * WHY THIS SCREEN EXISTS AT ALL: clubs are private by default, and this is the
 * only way to make one public. Without it the directory is permanently empty
 * and club discovery looks broken rather than unused.
 *
 * Two rules that are NOT cosmetic:
 *
 *   - **Listing is the owner's call, not a moderator's** (the server enforces
 *     it). Do not show the visibility toggle to a moderator; it will only fail.
 *   - **Suspension is staff, and it is not a soft hide.** A suspended club
 *     leaves the directory AND stops accepting joins, including from people
 *     holding an old invite link. Say that in the UI. A moderator who thinks
 *     they are quietly delisting a club is actually closing its doors.
 */

function useMyClubs(): {
  clubs: Club[];
  loading: boolean;
  busyId: string | null;
  publish: (club: Club, next: 'public' | 'private') => Promise<void>;
  suspend: (club: Club, next: boolean) => Promise<void>;
} {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await listMyClubs();
    setClubs(result.status === 'ok' ? result.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = useCallback(
    async (club: Club, next: 'public' | 'private'): Promise<void> => {
      setBusyId(club.id);
      const result = await setClubVisibility(club.id, next);
      if (result.status === 'ok') {
        setClubs((current) =>
          current.map((item) => (item.id === club.id ? { ...item, visibility: next } : item)),
        );
      }
      setBusyId(null);
    },
    [],
  );

  const suspend = useCallback(async (club: Club, next: boolean): Promise<void> => {
    setBusyId(club.id);
    const result = await setClubSuspended(club.id, next);
    if (result.status === 'ok') {
      setClubs((current) =>
        current.map((item) => (item.id === club.id ? { ...item, suspended: next } : item)),
      );
    }
    setBusyId(null);
  }, []);

  return { clubs, loading, busyId, publish, suspend };
}

export function ClubSettingsPanel(): JSX.Element {
  const { clubs, loading, busyId, publish, suspend } = useMyClubs();

  if (loading) {
    return <p className="club-directory-empty">Loading your clubs…</p>;
  }

  if (clubs.length === 0) {
    return <p className="club-directory-empty">You are not in any clubs yet.</p>;
  }

  return (
    <section className="club-settings">
      <h3 className="settings-heading">Your clubs</h3>

      <ul className="club-directory-list">
        {clubs.map((club) => {
          const isOwner = club.role === 'owner';
          const isStaff = isOwner || club.role === 'moderator';
          const busy = busyId === club.id;

          return (
            <li key={club.id} className="club-directory-item">
              <div className="club-directory-copy">
                <strong>{club.name}</strong>
                <small>
                  {club.memberCount} {club.memberCount === 1 ? 'member' : 'members'} · {club.role}
                  {club.suspended && ' · suspended'}
                </small>

                {isOwner && (
                  <p>
                    {club.visibility === 'public'
                      ? 'Listed in the club directory — anyone can find and join it.'
                      : 'Private. Only people you give the link to can join, and it will not appear in the directory.'}
                  </p>
                )}

                {club.suspended && (
                  <p>
                    Suspended: this club is hidden from the directory and is not accepting new
                    members, including anyone with an existing invite link.
                  </p>
                )}
              </div>

              <div className="club-settings-actions">
                {/* Owner only: the server refuses this from a moderator, so
                    showing it to one would only produce a failure. */}
                {isOwner && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy || club.suspended}
                    onClick={() =>
                      void publish(club, club.visibility === 'public' ? 'private' : 'public')
                    }
                  >
                    {club.visibility === 'public' ? 'Make private' : 'List publicly'}
                  </button>
                )}

                {isStaff && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void suspend(club, !club.suspended)}
                  >
                    {club.suspended ? 'Reinstate' : 'Suspend'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
