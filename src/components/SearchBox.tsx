import { useState, type FormEvent } from 'react';
import { searchYouTube, type SearchResult } from '@/lib/search/SearchService';

interface SearchBoxProps {
  callerId: string;
  onSelect(videoId: string): void;
}

const OUTCOME_MESSAGE: Record<string, string> = {
  'not-configured': 'Search is not set up yet (Edge Function not deployed).',
  'rate-limited': 'Daily search limit reached — try again tomorrow.',
  error: 'Search failed. Check your connection and try again.',
};

export function SearchBox({ callerId, onSelect }: SearchBoxProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (searching || query.trim().length === 0) {
      return;
    }
    setSearching(true);
    setMessage(null);
    const outcome = await searchYouTube(query, callerId);
    setSearching(false);

    if (outcome.status === 'ok') {
      setResults(outcome.results);
      setMessage(outcome.results.length === 0 ? 'No results.' : null);
    } else {
      setResults([]);
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'Search failed.');
    }
  }

  return (
    <div className="search-box">
      <form className="player-form" onSubmit={(e) => void handleSearch(e)}>
        <input
          className="input"
          value={query}
          placeholder="Search YouTube…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="button" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {message !== null && <p className="player-viewer-note">{message}</p>}

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((result) => (
            <li key={result.videoId}>
              <button
                type="button"
                className="search-result"
                onClick={() => {
                  onSelect(result.videoId);
                  setResults([]);
                }}
              >
                {result.thumbnailUrl !== '' && (
                  <img className="search-thumb" src={result.thumbnailUrl} alt="" />
                )}
                <span className="search-title">{result.title}</span>
                {result.durationText !== '' && (
                  <span className="search-duration">{result.durationText}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
