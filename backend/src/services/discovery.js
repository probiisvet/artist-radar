// Emerging-artist discovery via Spotify artist search with offset pagination.
//
// Spotify API constraints for new apps (post-Nov-2024):
//   - genre search results return null followers/popularity — useless for filtering
//   - /v1/artists?ids= batch endpoint returns 403 — blocked for new apps
//   - /v1/artists/{id} individual endpoint WORKS
//   - /recommendations, /browse/new-releases, editorial playlists — all blocked
//
// Strategy:
//   1. Search genre:"X" at multiple offsets to collect candidate IDs
//   2. Individually fetch /v1/artists/{id} for up to MAX_FETCHES candidates
//      — this is the only way to get real followers + popularity
//   3. Filter by followers < cap AND popularity <= MAX_POPULARITY

import { searchArtists, getArtistById } from './spotify.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

const PAGE_OFFSETS = [10, 20];
const REQUEST_DELAY_MS = 300;
// Max individual /v1/artists/{id} calls per discovery run.
// Each call costs 1 API request; 50 calls × 300ms = ~15s overhead.
const MAX_FETCHES = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxFollowers } = {}) {
  const cap = Number(maxFollowers ?? process.env.MAX_FOLLOWERS ?? 1_000_000);
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

  // Step 1: collect unique candidate IDs from genre searches
  const candidateIds = new Map(); // id -> category

  for (const cat of enabled) {
    for (const genre of cat.genres) {
      if (!genre) continue;
      for (const offset of PAGE_OFFSETS) {
        result.playlists_attempted += 1;
        const label = `${cat.category} / ${genre} @offset=${offset}`;
        try {
          const artists = await searchArtists(`genre:"${genre}"`, { limit: 10, offset });
          for (const a of artists) {
            if (!candidateIds.has(a.id)) {
              candidateIds.set(a.id, cat.category);
            }
          }
        } catch (err) {
          result.playlists_failed += 1;
          const msg = `${label}: ${err.message}`;
          result.errors.push(msg);
          console.warn(`[discovery] skipping ${msg}`);
          if (err.status === 429 && err.retryAfter > 60) {
            console.error(`[discovery] aborting: rate-limited for ${err.retryAfter}s.`);
            return result;
          }
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  result.artists_seen = candidateIds.size;
  console.log(`[discovery] collected ${candidateIds.size} candidate IDs — fetching up to ${MAX_FETCHES} individually`);

  // Step 2: individually fetch real data (only way to get accurate followers/popularity)
  const ids = [...candidateIds.keys()].slice(0, MAX_FETCHES);
  const buckets = { lt_100k: 0, lt_500k: 0, lt_1m: 0, lt_5m: 0, gte_5m: 0 };
  let nullCount = 0;
  const sampleSmall = [];

  for (const id of ids) {
    const category = candidateIds.get(id);
    try {
      const artist = await getArtistById(id);

      if (artist.followers == null || artist.popularity == null) {
        nullCount += 1;
        await sleep(REQUEST_DELAY_MS);
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

      // Filter
      if (artist.followers > cap) { await sleep(REQUEST_DELAY_MS); continue; }
      if (artist.popularity > MAX_POPULARITY) { await sleep(REQUEST_DELAY_MS); continue; }

      result.artists_emerging.push({ ...artist, discovery_source: category });
    } catch (err) {
      if (err.status === 429 && err.retryAfter > 60) {
        console.error(`[discovery] rate-limited during individual fetch — aborting`);
        return result;
      }
      console.warn(`[discovery] fetch failed for ${id}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[discovery] follower distribution:`, buckets, `(null: ${nullCount})`);
  if (sampleSmall.length) console.log(`[discovery] sample:`, sampleSmall.join(', '));
  console.log(`[discovery] emerging: ${result.artists_emerging.length}`);
  return result;
}
