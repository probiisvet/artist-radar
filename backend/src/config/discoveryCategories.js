// Discovery categories.
//
// For new (post-Nov-2024) Spotify apps, the only search endpoint that
// works reliably is `/v1/search?type=artist` — the same one the manual
// "Add" UI uses. The following endpoints all return 400/403 for new apps:
//   - /v1/browse/new-releases (403)
//   - /v1/recommendations (404)
//   - /v1/search?type=album with tag:new (400)
//   - /v1/search?type=track with year:... (400)
//   - /v1/playlists/<spotify-owned-id>/tracks (403)
//
// So discovery is a plain free-text artist search per genre. Spotify
// returns up to 20 artists ranked by relevance; we filter the result set
// to MAX_FOLLOWERS to keep only the under-the-radar ones.

export const DISCOVERY_CATEGORIES = [
  { category: 'Pop',           description: 'Pop',                       genres: ['pop'] },
  { category: 'Indie',         description: 'Indie, indie pop, bedroom pop', genres: ['indie', 'indie pop', 'bedroom pop'] },
  { category: 'Hip-Hop / Rap', description: 'Hip-hop and rap',           genres: ['hip hop', 'rap', 'trap'] },
  { category: 'R&B',           description: 'R&B and soul',              genres: ['r&b', 'rnb', 'soul'] },
  { category: 'Electronic',    description: 'Electronic, dance, house',  genres: ['electronic', 'dance', 'house', 'edm'] },
  { category: 'Country',       description: 'Country',                   genres: ['country', 'americana'] },
  { category: 'Rock',          description: 'Rock and alternative',      genres: ['rock', 'alternative', 'indie rock'] },
  { category: 'Latin',         description: 'Latin and reggaeton',       genres: ['latin', 'reggaeton', 'latin pop'] },
  { category: 'K-Pop',         description: 'K-Pop',                     genres: ['k-pop', 'kpop'] },
];

export function listCategories() {
  return DISCOVERY_CATEGORIES.map((c) => c.category);
}
