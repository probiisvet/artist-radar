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
    category: 'Pop',
    description: 'Pop — broad and niche sub-genres',
    genres: ['pop', 'art pop', 'electropop', 'indie pop', 'bedroom pop', 'chamber pop', 'chillpop'],
  },
  {
    category: 'Indie',
    description: 'Indie, lo-fi, dream pop, shoegaze',
    genres: ['indie', 'lo-fi indie', 'dream pop', 'indie folk', 'shoegaze', 'lo-fi'],
  },
  {
    category: 'Hip-Hop / Rap',
    description: 'Hip-hop, rap, and underground sub-genres',
    genres: ['hip hop', 'rap', 'trap', 'underground hip hop', 'alternative hip hop', 'cloud rap', 'emo rap'],
  },
  {
    category: 'R&B',
    description: 'R&B, soul, neo-soul',
    genres: ['r&b', 'soul', 'alternative r&b', 'neo soul', 'indie r&b', 'funk'],
  },
  {
    category: 'Electronic',
    description: 'Electronic, dance, house and underground sub-genres',
    genres: ['electronic', 'dance', 'house', 'edm', 'ambient', 'synthwave', 'chillwave', 'hyperpop'],
  },
  {
    category: 'Country',
    description: 'Country, folk, americana',
    genres: ['country', 'folk', 'americana', 'alt-country', 'bluegrass', 'country folk'],
  },
  {
    category: 'Rock',
    description: 'Rock, alternative, punk and sub-genres',
    genres: ['rock', 'alternative', 'indie rock', 'post-punk', 'emo', 'garage rock', 'math rock'],
  },
  {
    category: 'Latin',
    description: 'Latin, reggaeton, and regional',
    genres: ['latin', 'reggaeton', 'latin pop', 'latin alternative', 'regional mexicano', 'cumbia'],
  },
  {
    category: 'K-Pop',
    description: 'K-Pop and K-indie',
    genres: ['k-pop', 'kpop', 'k-indie', 'korean indie'],
  },
];

export function listCategories() {
  return DISCOVERY_CATEGORIES.map((c) => c.category);
}
