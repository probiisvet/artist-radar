// Emerging-artist discovery via Spotify artist search with offset pagination.
//
// What we learned from /api/diagnostic:
//   - search limit caps at 10 for new apps
//   - `genre:"X"` filter WORKS on artist search
//   - /recommendations, /browse/new-releases, Spotify-owned playlists blocked
//   - /v1/artists?ids= batch endpoint returns 403 for new apps
//   - /v1/artists/{id} works but too many calls risks rate-limiting
//
// Strategy:
//   Search genre:"X" at multiple offsets. Only keep artists where the
//   search result ITSELF includes followers + popularity. Null values mean
//   Spotify omitted the data — we can't distinguish a tiny unknown act from
//   a huge star (Zara Larsson, Ed Sheeran return null followers in search).

import { searchArtists } from './spotify.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

const PAGE_OFFSETS = [10, 20];

const REQUEST_DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxFollowers } = {}) {
  const cap = Number(maxFollowers ?? process.env.MAX_FOLLOWERS ?? 1_000_000);
  // Skip artists with popularity above this — they're established stars.
  const MAX_POPULARITY = Number(process.env.MAX_POPULARITY ?? 65);
  const disabled = new Set(await getDisabledCategories());
  const enabled = DISCOVERY_CATEGORIES.filter((c) => !disabled.has(c.category));

  const result = {
    playlists_attempted: 0,
    playlists_failed: 0,
    artists_seen: 0,
    artists_emerging: [],
    errors: [],
  };

  const seen = new Map(); // artist.id -> { artist, category }

  for (const cat of enabled) {
    for (const genre of cat.genres) {
      if (!genre) continue;
      for (const offset of PAGE_OFFSETS) {
        result.playlists_attempted += 1;
        const label = `${cat.category} / ${genre} @offset=${offset}`;
        try {
          const artists = await searchArtists(`genre:"${genre}"`, { limit: 10, offset });
          if (!artists.length) {
            console.warn(`[discovery] no results for ${label}`);
          } else {
            for (const a of artists) {
              if (!seen.has(a.id)) {
                seen.set(a.id, { artist: a, category: cat.category });
              }
            }
          }
        } catch (err) {
          result.playlists_failed += 1;
          const msg = `${label}: ${err.message}`;
          result.errors.push(msg);
          console.warn(`[discovery] skipping ${msg}`);
          if (err.status === 429 && err.retryAfter > 60) {
            console.error(
              `[discovery] aborting: Spotify rate-limited for ${err.retryAfter}s. Try again later.`,
            );
            return result;
          }
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  result.artists_seen = seen.size;

  const buckets = { lt_100k: 0, lt_500k: 0, lt_1m: 0, lt_5m: 0, gte_5m: 0 };
  let skippedNull = 0;
  const sampleSmall = [];

  for (const { artist, category } of seen.values()) {
    // REQUIRE real followers + popularity data from search.
    // Artists missing either field can't be reliably classified —
    // Spotify omits these fields for both tiny unknowns AND huge stars.
    if (artist.followers == null || artist.popularity == null) {
      skippedNull += 1;
      continue;
    }

    if (artist.followers < 100_000) {
      buckets.lt_100k += 1;
      if (sampleSmall.length < 5) sampleSmall.push(`${artist.name} (${artist.followers.toLocaleString()})`);
    } else if (artist.followers < 500_000) {
      buckets.lt_500k += 1;
      if (sampleSmall.length < 5) sampleSmall.push(`${artist.name} (${artist.followers.toLocaleString()})`);
    } else if (artist.followers < 1_000_000) buckets.lt_1m += 1;
    else if (artist.followers < 5_000_000) buckets.lt_5m += 1;
    else buckets.gte_5m += 1;

    if (artist.followers > cap) continue;
    if (artist.popularity > MAX_POPULARITY) continue;

    result.artists_emerging.push({ ...artist, discovery_source: category });
  }

  console.log(
    `[discovery] done: ${result.playlists_attempted - result.playlists_failed}/${result.playlists_attempted} searches ok, ${result.artists_seen} unique artists (${skippedNull} skipped — null data)`,
  );
  console.log(`[discovery] follower distribution:`, buckets);
  if (sampleSmall.length) {
    console.log(`[discovery] sample small artists:`, sampleSmall.join(', '));
  }
  console.log(`[discovery] emerging (followers<${cap.toLocaleString()} & popularity<=${MAX_POPULARITY}): ${result.artists_emerging.length}`);
  return result;
}
