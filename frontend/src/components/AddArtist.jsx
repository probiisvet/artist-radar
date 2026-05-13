import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function AddArtist({ onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchArtists(query);
        setResults(data.results);
        setError(null);
      } catch (err) {
        setError(err.message);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleAdd = async (id) => {
    setBusy(true);
    try {
      await onAdd(id);
      setQuery('');
      setResults([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="add-artist">
      <input
        type="text"
        placeholder="Search Spotify for an artist to track…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
      />
      {error && <div className="muted error-text">{error}</div>}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              {r.image_url ? (
                <img src={r.image_url} alt="" />
              ) : (
                <div className="img-placeholder" />
              )}
              <div className="info">
                <div className="name">{r.name}</div>
                <div className="meta">
                  {(r.followers ?? 0).toLocaleString()} followers · popularity {r.popularity ?? '?'}
                </div>
              </div>
              <button
                className="btn"
                onClick={() => handleAdd(r.id)}
                disabled={busy}
              >
                Track
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
