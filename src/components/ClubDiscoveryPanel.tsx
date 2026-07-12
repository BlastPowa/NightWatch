import { useCallback, useEffect, useState } from 'react';
import { joinClub, searchClubs, type DirectoryClub } from '@/lib/social/CreatorService';

/**
 * TEMPORARY SCAFFOLD — Phase 21. Structure is real; the styling is not.
 *
 * FOR THE FRONTEND LANE: restyle freely. Everything below the data layer is
 * yours to throw away. What is worth keeping:
 *
 *   - `useClubDirectory` holds the data logic and returns plain state plus a
 *     `join` action. Rebuild the markup around it and no call changes.
 *   - Class names (`club-directory-*`) are placeholders. Rename them.
 *   - `isMember` arrives with every row, so a card shows Open rather than Join
 *     without a second query. Do not re-fetch to work this out.
 *
 * THINGS THAT ARE NOT COSMETIC — please preserve the behaviour:
 *
 *   - **Clubs are private by default.** The directory is empty until owners opt
 *     in, so "no results" is the NORMAL early state, not a failure. An empty
 *     directory that looks broken will make people think the feature is broken.
 *   - Search is server-side and block-aware. Do not filter the returned list
 *     client-side: the server already removed private, suspended, and blocked
 *     clubs, and a client-side filter can only wrongly remove more.
 *   - The owner's public/private toggle and the staff suspend control still have
 *     no UI at all (`setClubVisibility`, `setClubSuspended`). Without the
 *     toggle, nobody can ever list a club and this directory stays empty
 *     forever. That is the most important missing screen here.
 */

interface ClubDirectoryState {
  clubs: DirectoryClub[];
  loading: boolean;
  error: string | null;
}

function useClubDirectory(): ClubDirectoryState & {
  search: (query: string) => Promise<void>;
  join: (clubId: string) => Promise<void>;
} {
  const [state, setState] = useState<ClubDirectoryState>({
    clubs: [],
    loading: true,
    error: null,
  });

  const search = useCallback(async (query: string): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }));
    const result = await searchClubs(query);
    if (result.status === 'ok') {
      setState({ clubs: result.data, loading: false, error: null });
    } else {
      setState({ clubs: [], loading: false, error: 'Clubs could not be loaded.' });
    }
  }, []);

  const join = useCallback(
    async (clubId: string): Promise<void> => {
      const result = await joinClub(clubId);
      if (result.status === 'ok') {
        // Optimistic: the row is already on screen, so flip it rather than
        // re-querying the whole directory.
        setState((current) => ({
          ...current,
          clubs: current.clubs.map((club) =>
            club.id === clubId
              ? { ...club, isMember: true, memberCount: club.memberCount + 1 }
              : club,
          ),
        }));
      }
    },
    [],
  );

  useEffect(() => {
    void search('');
  }, [search]);

  return { ...state, search, join };
}

export function ClubDiscoveryPanel(): JSX.Element {
  const { clubs, loading, error, search, join } = useClubDirectory();
  const [query, setQuery] = useState('');

  return (
    <div className="club-directory">
      <form
        className="club-directory-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search clubs"
          aria-label="Search clubs"
        />
        <button type="submit" className="button button-primary" disabled={loading}>
          Search
        </button>
      </form>

      {loading && <p className="club-directory-empty">Loading clubs…</p>}
      {error !== null && <p className="club-directory-empty">{error}</p>}

      {!loading && error === null && clubs.length === 0 && (
        <p className="club-directory-empty">
          No public clubs yet. Clubs are private until their owner lists them.
        </p>
      )}

      <ul className="club-directory-list">
        {clubs.map((club) => (
          <li key={club.id} className="club-directory-item">
            <div className="club-directory-copy">
              <strong>{club.name}</strong>
              <small>
                {club.memberCount} {club.memberCount === 1 ? 'member' : 'members'}
              </small>
              {club.description !== '' && <p>{club.description}</p>}
            </div>
            {club.isMember ? (
              <span className="club-directory-member">Joined</span>
            ) : (
              <button type="button" className="button" onClick={() => void join(club.id)}>
                Join
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
