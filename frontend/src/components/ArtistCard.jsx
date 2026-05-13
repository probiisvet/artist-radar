function formatGrowth(pct) {
  if (pct == null) return null;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatPopChange(delta) {
  if (delta == null) return null;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta}`;
}

export default function ArtistCard({ artist, onDismiss, onRemove, onRefresh, refreshing }) {
  const growth = formatGrowth(artist.followers_growth_pct);
  const popDelta = formatPopChange(artist.popularity_change);
  const isPositiveGrowth =
    artist.followers_growth_pct != null && artist.followers_growth_pct > 0;

  return (
    <li className={`artist-card ${artist.dismissed ? 'dismissed' : ''}`}>
      {artist.image_url ? (
        <img src={artist.image_url} alt="" className="avatar" />
      ) : (
        <div className="avatar img-placeholder" />
      )}

      <div className="body">
        <div className="row">
          <a
            className="name"
            href={artist.spotify_url}
            target="_blank"
            rel="noreferrer"
          >
            {artist.name}
          </a>
          <span className="badges">
            {artist.is_emerging && <span className="badge emerging">Emerging</span>}
            {artist.source === 'discovered' && (
              <span className="badge discovered">Auto-discovered</span>
            )}
          </span>
        </div>

        {artist.discovery_source && (
          <div className="discovery-source muted">
            Surfaced via <strong>{artist.discovery_source}</strong>
          </div>
        )}

        {artist.genres?.length > 0 && (
          <div className="genres">{artist.genres.slice(0, 4).join(' · ')}</div>
        )}

        <div className="stats">
          <span>
            <strong>{(artist.followers ?? 0).toLocaleString()}</strong> followers
          </span>
          <span>
            popularity <strong>{artist.popularity ?? 0}</strong>
          </span>
          {growth ? (
            <span className={isPositiveGrowth ? 'pos' : 'neg'}>
              {growth} (30d)
            </span>
          ) : (
            <span className="muted">no growth data yet</span>
          )}
          {popDelta && popDelta !== '+0' && (
            <span className={artist.popularity_change > 0 ? 'pos' : 'neg'}>
              pop {popDelta}
            </span>
          )}
        </div>
      </div>

      <div className="actions">
        <button
          className="btn"
          onClick={() => onRefresh(artist.id)}
          disabled={refreshing}
        >
          {refreshing ? '…' : 'Refresh'}
        </button>
        {artist.dismissed ? (
          <button className="btn" onClick={() => onDismiss(artist.id, false)}>
            Restore
          </button>
        ) : (
          <button className="btn ghost" onClick={() => onDismiss(artist.id, true)}>
            Not interested
          </button>
        )}
        <button className="btn danger" onClick={() => onRemove(artist.id)}>
          Remove
        </button>
      </div>
    </li>
  );
}
