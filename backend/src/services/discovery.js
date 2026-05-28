// Emerging-artist discovery via Spotify artist search with offset pagination.
//
// What we learned from /api/diagnostic:
//   - search limit caps at 10 for new apps
//   - `genre:"X"` filter WORKS on artist search
//   - `tag:new` and `year:` filters work
//   - /recommendations, /browse/new-releases, Spotify-owned playlists all blocked
//
// Strategy:
//   For each genre, fetch 3 pages of artist results at increasing offsets
//   using `q=genre:"X"`. Spotify ranks by popularity descending, so
//   higher offsets surface less-famous artists — exactly what we want for
//   "emerging" discovery. We skip offset=0 entirely (top-10 are always
//   household names like Drake / Taylor Swift) and start at offset=10.

import { searchArtists } from './spotify.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

// Pagination offsets. Spotify returns 10 per page; these probe deeper
// into the long-tail where smaller, emerging artists live.
// Niche genres have shallow catalogues, so offset=10 already surfaces
// emerging artists. We also grab offset=20 for extra coverage.
const PAGE_OFFSETS = [10, 20];

// Polite delay between search requests to avoid Spotify rate-limiting
// (429). 200 ms × ~50 calls = ~10s overhead, well worth it.
const REQUEST_DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxFollowers } = {}) {
  const cap = Number(maxFollowers ?? process.env.MAX_FOLLOWERS ?? 1_000_000);
  const disabled = new Set(getDisabledCategories());
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
      if (!genre) continue; // skip null genres
      for (const offset of PAGE_OFFSETS) {
        result.playlists_attempted += 1;
        const label = `${cat.category} / ${genre} @offset=${offset}`;
        try {
          const artists = await searchArtists(`genre:"${genre}"`, {
            limit: 10,
            offset,
          });
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
          // If Spotify is rate-limiting us hard, stop the whole discovery
          // pass — there's no point hammering further calls that will all
          // 429. Existing tracked-artist refresh in refresh.js continues
          // independently.
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

  // Followers distribution — tells us at a glance whether the cap is too
  // tight or whether the search is returning few artists.
  const buckets = { lt_100k: 0, lt_500k: 0, lt_1m: 0, lt_5m: 0, gte_5m: 0 };
  let nullFollowers = 0;
  let minSeen = Infinity;
  let maxSeen = 0;
  const sampleSmall = [];

  for (const { artist, category } of seen.values()) {
    if (artist.followers == null) {
      nullFollowers += 1;
      continue;
    }
    if (artist.followers < minSeen) minSeen = artist.followers;
    if (artist.followers > maxSeen) maxSeen = artist.followers;
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
    result.artists_emerging.push({
      ...artist,
      discovery_source: category,
    });
  }

  console.log(
    `[discovery] done: ${result.playlists_attempted - result.playlists_failed}/${result.playlists_attempted} searches ok, ${result.artists_seen} unique artists`,
  );
  console.log(`[discovery] follower distribution:`, buckets, `(null: ${nullFollowers})`);
  if (seen.size > 0) {
    console.log(`[discovery] followers range: ${minSeen.toLocaleString()} – ${maxSeen.toLocaleString()}`);
  }
  if (sampleSmall.length) {
    console.log(`[discovery] smallest artists sample:`, sampleSmall.join(', '));
  }
  console.log(`[discovery] emerging (< ${cap.toLocaleString()}): ${result.artists_emerging.length}`);
  return result;
}
