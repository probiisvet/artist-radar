import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import AddArtist from './components/AddArtist.jsx';
import ArtistList from './components/ArtistList.jsx';
import TourList from './components/TourList.jsx';
import Categories from './components/Categories.jsx';

const TABS = [
  { id: 'emerging', label: 'Emerging' },
  { id: 'tracked', label: 'All tracked' },
  { id: 'tours', label: 'US tour dates' },
  { id: 'dismissed', label: 'Not interested' },
  { id: 'discovery', label: 'Discovery sources' },
];

export default function App() {
  const [tab, setTab] = useState('emerging');
  const [sortBy, setSortBy] = useState('growth');
  const [artists, setArtists] = useState([]);
  const [tours, setTours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [refreshSummary, setRefreshSummary] = useState(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [a, t] = await Promise.all([api.listArtists(true), api.listTours()]);
      setArtists(a.artists);
      setTours(t.tours);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // `phases` null = full refresh (everything). Otherwise only the named phases.
  const runRefresh = async (phases) => {
    setRefreshing(true);
    setError(null);
    setRefreshSummary(null);
    try {
      const summary = phases ? await api.refreshPhases(phases) : await api.refresh();
      setRefreshSummary(summary);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const onRefreshAll = () => runRefresh(null);
  const onRefreshArtists = () => runRefresh({ artists: true });
  const onDiscoverNew = () => runRefresh({ discovery: true });
  const onRefreshTours = () => runRefresh({ tours: true });

  const onRefreshArtist = async (id) => {
    setRefreshingIds((s) => new Set(s).add(id));
    setError(null);
    try {
      await api.refreshArtist(id);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const onAdd = async (id) => {
    await api.addArtist(id);
    await loadAll();
  };

  const onDismiss = async (id, dismissed) => {
    await api.setDismissed(id, dismissed);
    await loadAll();
  };

  const onRemove = async (id) => {
    await api.removeArtist(id);
    await loadAll();
  };

  const filtered = useMemo(() => {
    if (tab === 'dismissed') return artists.filter((a) => a.dismissed);
    if (tab === 'emerging')
      return artists.filter((a) => !a.dismissed && a.is_emerging);
    if (tab === 'tracked') return artists.filter((a) => !a.dismissed);
    return [];
  }, [tab, artists]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const num = (v) => (v == null ? null : Number(v));
    // Push null/missing values to the bottom regardless of sort direction.
    const nullsLast = (a, b, cmp) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return cmp;
    };
    switch (sortBy) {
      case 'growth':
        list.sort((a, b) => {
          const ga = num(a.followers_growth_pct);
          const gb = num(b.followers_growth_pct);
          return nullsLast(ga, gb, gb - ga); // highest growth first
        });
        break;
      case 'listeners_desc':
        list.sort((a, b) => nullsLast(num(a.followers), num(b.followers), num(b.followers) - num(a.followers)));
        break;
      case 'listeners_asc':
        list.sort((a, b) => nullsLast(num(a.followers), num(b.followers), num(a.followers) - num(b.followers)));
        break;
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        break;
      case 'added':
      default:
        // API already returns newest-added first; keep that order.
        break;
    }
    return list;
  }, [filtered, sortBy]);

  const tourCount = tours.length;
  const emergingCount = artists.filter((a) => !a.dismissed && a.is_emerging).length;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Artist Radar</h1>
          <p className="tagline">
            Catch emerging artists before they blow up — and never miss a US tour announcement.
          </p>
        </div>
        <div className="refresh-actions">
          <button className="btn primary" onClick={onRefreshAll} disabled={refreshing}>
            {refreshing ? 'Working…' : 'Run full refresh'}
          </button>
          <button className="btn" onClick={onRefreshArtists} disabled={refreshing} title="Update listener counts & growth for tracked artists">
            Refresh artists
          </button>
          <button className="btn" onClick={onDiscoverNew} disabled={refreshing} title="Discover new emerging artists from playlists">
            Find new
          </button>
          <button className="btn" onClick={onRefreshTours} disabled={refreshing} title="Search tour/ticket news for tracked artists">
            Refresh tours
          </button>
        </div>
      </header>

      {refreshSummary && (
        <div className="banner success">
          {(() => {
            const ran = refreshSummary.ran ?? { artists: true, discovery: true, tours: true };
            const parts = [];
            if (ran.artists) {
              parts.push(`Refreshed ${refreshSummary.artists_refreshed} tracked artists`);
              if (refreshSummary.pruned) parts.push(`removed ${refreshSummary.pruned} not-growing`);
            }
            if (ran.discovery && refreshSummary.discovery) {
              const d = refreshSummary.discovery;
              parts.push(
                `discovery: +${d.artists_added} new (from ${d.playlists_attempted - d.playlists_failed}/${d.playlists_attempted} playlists)`,
              );
            }
            if (ran.tours) {
              parts.push(
                `searched ${refreshSummary.tours_searched} artists for tours · +${refreshSummary.tours_added} new tour links`,
              );
              if (refreshSummary.tours_quota_hit)
                parts.push('Google daily search quota reached — try again tomorrow');
              parts.push(`emails sent: ${refreshSummary.emails_sent}`);
            }
            return parts.join(' · ');
          })()}
          {refreshSummary.errors?.length ? (
            <div className="errors">
              {refreshSummary.errors.length} error(s) – check the server logs.
            </div>
          ) : null}
        </div>
      )}
      {error && <div className="banner error">Error: {error}</div>}

      <AddArtist onAdd={onAdd} />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'emerging' && emergingCount > 0 ? (
              <span className="count">{emergingCount}</span>
            ) : null}
            {t.id === 'tours' && tourCount > 0 ? (
              <span className="count">{tourCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <main>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : tab === 'tours' ? (
          <TourList tours={tours} />
        ) : tab === 'discovery' ? (
          <Categories />
        ) : (
          <>
            {sorted.length > 0 && (
              <div className="list-toolbar">
                <span className="muted">{sorted.length} artist{sorted.length === 1 ? '' : 's'}</span>
                <label className="sort-control">
                  Sort by{' '}
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="growth">Growth (high → low)</option>
                    <option value="listeners_desc">Listeners (high → low)</option>
                    <option value="listeners_asc">Listeners (low → high)</option>
                    <option value="name">Name (A → Z)</option>
                    <option value="added">Recently added</option>
                  </select>
                </label>
              </div>
            )}
            <ArtistList
              artists={sorted}
              onDismiss={onDismiss}
              onRemove={onRemove}
              onRefresh={onRefreshArtist}
              refreshingIds={refreshingIds}
              view={tab}
            />
          </>
        )}
      </main>

      <footer className="app-footer">
        <small>
          Data: Spotify Web API (search, /artists, /playlists/&#123;id&#125;/tracks) and Bandsintown public API.
          Spotify's official API does not expose monthly listeners — growth is tracked
          via daily snapshots.
        </small>
      </footer>
    </div>
  );
}
