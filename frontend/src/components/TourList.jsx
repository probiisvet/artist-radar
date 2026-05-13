function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function TourList({ tours }) {
  if (!tours.length) {
    return (
      <p className="muted">
        No upcoming US tour dates for tracked artists. Background refresh
        runs daily — or click "Run refresh now" above to check immediately.
      </p>
    );
  }

  // Group by artist for nicer display
  const grouped = new Map();
  for (const t of tours) {
    if (!grouped.has(t.artist_id)) {
      grouped.set(t.artist_id, {
        name: t.artist_name,
        image: t.artist_image,
        dates: [],
      });
    }
    grouped.get(t.artist_id).dates.push(t);
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
            <span className="count">{group.dates.length} show{group.dates.length === 1 ? '' : 's'}</span>
          </header>
          <ul>
            {group.dates.map((d) => (
              <li key={d.id}>
                <div className="when">{formatDate(d.event_date)}</div>
                <div className="where">
                  <strong>{[d.city, d.region].filter(Boolean).join(', ')}</strong>
                  {d.venue_name ? ` — ${d.venue_name}` : ''}
                </div>
                {d.ticket_url && (
                  <a
                    href={d.ticket_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn small"
                  >
                    Tickets
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
