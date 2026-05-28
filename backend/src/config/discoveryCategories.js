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
// Strategy: use NICHE sub-genres rather than broad ones ("bedroom pop"
// instead of "pop"). Broad genres return superstars at every offset; niche
// genres have a shallower catalogue so even offset=10 surfaces small acts.

export const DISCOVERY_CATEGORIES = [
  {
    category: 'Indie',
    description: 'Indie, bedroom pop, lo-fi, dream pop',
    genres: ['bedroom pop', 'lo-fi indie', 'dream pop', 'indie folk', 'shoegaze', 'indie pop'],
  },
  {
    category: 'Hip-Hop / Rap',
    description: 'Underground and alternative rap',
    genres: ['underground hip hop', 'alternative hip hop', 'lo-fi hip hop', 'cloud rap', 'emo rap'],
  },
  {
    category: 'R&B',
    description: 'Alternative R&B and neo-soul',
    genres: ['alternative r&b', 'neo soul', 'indie r&b', 'soul', 'funk'],
  },
  {
    category: 'Electronic',
    description: 'Underground electronic sub-genres',
    genres: ['ambient', 'chillwave', 'synthwave', 'lo-fi beats', 'hyperpop', 'bedroom electronic'],
  },
  {
    category: 'Country',
    description: 'Americana, folk, alt-country',
    genres: ['americana', 'folk', 'alt-country', 'bluegrass', 'country folk'],
  },
  {
    category: 'Rock',
    description: 'Alternative, emo, post-punk',
    genres: ['post-punk', 'emo', 'math rock', 'indie rock', 'garage rock', 'noise pop'],
  },
  {
    category: 'Latin',
    description: 'Latin underground and regional',
    genres: ['latin alternative', 'regional mexicano', 'latin indie', 'cumbia'],
  },
  {
    category: 'Pop',
    description: 'Art pop, indie pop, sophisti-pop',
    genres: ['art pop', 'chamber pop', 'electropop', 'indie pop', 'chillpop'],
  },
  {
    category: 'K-Pop',
    description: 'K-Pop and K-indie',
    genres: ['k-pop', 'k-indie', 'korean indie'],
  },
];

export function listCategories() {
  return DISCOVERY_CATEGORIES.map((c) => c.category);
}
