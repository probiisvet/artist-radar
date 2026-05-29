// Emerging-artist discovery via Spotify artist search with offset pagination.
//
// What we learned from /api/diagnostic:
//   - search limit caps at 10 for new apps
//   - `genre:"X"` filter WORKS on artist search
//   - `tag:new` and `year:` filters work
//   - /recommendations, /browse/new-releases, Spotify-owned playlists all blocked
//
// Strategy:
//   1. Search genre:"X" at multiple offsets to collect candidate artist IDs
//   2. Batch-fetch REAL artist data via /v1/artists?ids= (up to 50 per call)
//      — search results often return null followers/popularity even for huge
//        stars, making them indistinguishable from tiny unknown acts.
//      — the batch endpoint always returns accurate followers + popularity.
//   3. Filter by followers < cap AND popularity < MAX_POPULARITY.

import { searchArtists, getArtistsByIds } from './spotify.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

const PAGE_OFFSETS = [10, 20];

const REQUEST_DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxFollowers } = {}) {
  const cap = Number(maxFollowers ?? process.env.MAX_FOLLOWERS ?? 1_000_000);
  // Artists with popularity above this are established stars, not emerging.
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

  // Step 1: collect candidate IDs from genre searches
  const candidateIds = new Map(); // id -> category

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
              if (!candidateIds.has(a.id)) {
                candidateIds.set(a.id, cat.category);
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

  result.artists_seen = candidateIds.size;
  console.log(`[discovery] collected ${candidateIds.size} unique candidate IDs`);

  // Step 2: batch-fetch REAL artist data (followers + popularity are accurate here)
  const ids = [...candidateIds.keys()];
  let realArtists = [];
  try {
    realArtists = await getArtistsByIds(ids);
    console.log(`[discovery] fetched real data for ${realArtists.length}/${ids.length} artists`);
  } catch (err) {
    if (err.status === 429 && err.retryAfter > 60) {
      console.error(`[discovery] batch fetch rate-limited for ${err.retryAfter}s — aborting`);
      return result;
    }
    console.error(`[discovery] batch fetch failed: ${err.message}`);
    result.errors.push(`batch fetch: ${err.message}`);
    return result;
  }

  // Step 3: filter by real followers + popularity
  const buckets = { lt_100k: 0, lt_500k: 0, lt_1m: 0, lt_5m: 0, gte_5m: 0 };
  let nullCount = 0;
  const sampleSmall = [];

  for (const artist of realArtists) {
    const category = candidateIds.get(artist.id) ?? 'Unknown';

    // Skip artists where we still can't get data
    if (artist.followers == null || artist.popularity == null) {
      nullCount += 1;
      continue;
    }

    // Track distribution
    if (artist.followers < 100_000) {
      buckets.lt_100k += 1;
      if (sampleSmall.length < 5) sampleSmall.push(`${artist.name} (${artist.followers.toLocaleString()})`);
    } else if (artist.followers < 500_000) {
      buckets.lt_500k += 1;
      if (sampleSmall.length < 5) sampleSmall.push(`${artist.name} (${artist.followers.toLocaleString()})`);
    } else if (artist.followers < 1_000_000) buckets.lt_1m += 1;
    else if (artist.followers < 5_000_000) buckets.lt_5m += 1;
    else buckets.gte_5m += 1;

    // Apply emerging filters
    if (artist.followers > cap) continue;
    if (artist.popularity > MAX_POPULARITY) continue;

    result.artists_emerging.push({ ...artist, discovery_source: category });
  }

  console.log(`[discovery] follower distribution:`, buckets, `(null: ${nullCount})`);
  if (sampleSmall.length) {
    console.log(`[discovery] smallest artists sample:`, sampleSmall.join(', '));
  }
  console.log(`[discovery] emerging (followers<${cap.toLocaleString()} & popularity<=${MAX_POPULARITY}): ${result.artists_emerging.length}`);
  return result;
}
