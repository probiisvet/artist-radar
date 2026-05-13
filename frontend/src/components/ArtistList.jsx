import ArtistCard from './ArtistCard.jsx';

export default function ArtistList({
  artists,
  onDismiss,
  onRemove,
  onRefresh,
  refreshingIds,
  view,
}) {
  if (!artists.length) {
    return (
      <p className="muted">
        {view === 'dismissed'
          ? 'Nothing here. Artists you mark as "not interested" will show up on this tab.'
          : view === 'emerging'
            ? 'No emerging artists yet. Click "Run refresh now" to scan, or add some artists manually.'
            : 'No artists tracked yet. Use the search bar above to add some.'}
      </p>
    );
  }
  return (
    <ul className="artist-list">
      {artists.map((a) => (
        <ArtistCard
          key={a.id}
          artist={a}
          onDismiss={onDismiss}
          onRemove={onRemove}
          onRefresh={onRefresh}
          refreshing={refreshingIds.has(a.id)}
        />
      ))}
    </ul>
  );
}
