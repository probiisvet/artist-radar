function formatFound(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function TourList({ tours }) {
  if (!tours.length) {
    return (
      <p className="muted">
        No tour news yet for tracked artists. The daily refresh web-searches
        each artist for tour/ticket links — or click "Run refresh now" above to
        check immediately.
      </p>
    );
  }

  // Group leads by artist
  const grouped = new Map();
  for (const t of tours) {
    if (!grouped.has(t.artist_id)) {
      grouped.set(t.artist_id, {
        name: t.artist_name,
        image: t.artist_image,
        leads: [],
      });
    }
    grouped.get(t.artist_id).leads.push(t);
  }

  return (
    <div className="tour-list">
      {[...grouped.values()].map((group) => (
        <section key={group.name} className="tour-group">
          <header>
            {group.image ? (
              <img src={group.image} alt="" className="avatar small" />
            ) : (
              <div className="avatar small img-placeholder" />
            )}
            <h2>{group.name}</h2>
            <span className="count">
              {group.leads.length} link{group.leads.length === 1 ? '' : 's'}
            </span>
          </header>
          <ul>
            {group.leads.map((d) => (
              <li key={d.id}>
                <div className="where">
                  <a href={d.url} target="_blank" rel="noreferrer">
                    <strong>{d.title || d.url}</strong>
                  </a>
                </div>
                <div className="when muted">
                  {d.source_site} · found {formatFound(d.found_at)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
