// Emerging-artist discovery using Last.fm for listener data + Spotify for IDs.
//
// Why Last.fm instead of Spotify for filtering?
//   Spotify's API (Development Mode) does not return followers/popularity —
//   making it impossible to distinguish Nirvana from a nobody. Last.fm
//   reliably returns listener counts for every artist.
//
// Flow:
//   1. For each genre, fetch top artists from Last.fm at pages 2-4
//      (page 1 = household names; deeper pages = emerging acts)
//   2. Filter: listeners between MIN_LISTENERS and cap (default 500k)
//   3. Cross-reference with Spotify to get Spotify IDs for tracking
//   4. Save with Last.fm listener count stored as `followers`

import { searchArtists } from './spotify.js';
import { getTagArtists } from './lastfm.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

// Pages to fetch per genre. Page 1 included — the listener filter
// handles excluding superstars. For niche genres page 1 already has emerging acts.
const PAGES = [1, 2, 3];
// Minimum listeners — filters out dead/empty profiles
const MIN_LISTENERS = 1_000;

const REQUEST_DELAY_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxFollowers } = {}) {
  const cap = Number(maxFollowers ?? process.env.MAX_FOLLOWERS ?? 500_000);
  const disabled = new Set(await getDisabledCategories());
  const enabled = DISCOVERY_CATEGORIES.filter((c) => !disabled.has(c.category));

  const result = {
    playlists_attempted: 0,
    playlists_failed: 0,
    artists_seen: 0,
    artists_emerging: [],
    errors: [],
  };

  // Step 1: collect emerging candidates from Last.fm
  const candidates = new Map(); // name.toLowerCase() -> { name, listeners, category }

  for (const cat of enabled) {
    for (const genre of cat.genres) {
      if (!genre) continue;
      for (const page of PAGES) {
        result.playlists_attempted += 1;
        const label = `${cat.category} / ${genre} p${page}`;
        try {
          const artists = await getTagArtists(genre, { page, limit: 50 });
          if (artists.length > 0 && page === 1) {
            const sample = artists.slice(0, 3).map(a => `${a.name}(${a.listeners.toLocaleString()})`).join(', ');
            console.log(`[discovery] ${label} sample: ${sample}`);
          }
          for (const a of artists) {
            if (a.listeners >= MIN_LISTENERS && a.listeners <= cap) {
              const key = a.name.toLowerCase();
              if (!candidates.has(key)) {
                candidates.set(key, { name: a.name, listeners: a.listeners, category: cat.category });
              }
            }
          }
        } catch (err) {
          result.playlists_failed += 1;
          result.errors.push(`${label}: ${err.message}`);
          console.warn(`[discovery] skipping ${label}: ${err.message}`);
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  result.artists_seen = candidates.size;
  console.log(
    `[discovery] Last.fm: ${candidates.size} candidates with ${MIN_LISTENERS.toLocaleString()}–${cap.toLocaleString()} listeners`,
  );

  // Step 2: cross-reference with Spotify to get Spotify IDs
  for (const { name, listeners, category } of candidates.values()) {
    try {
      const results = await searchArtists(name, { limit: 1 });
      const match = results[0];
      if (!match) { await sleep(REQUEST_DELAY_MS); continue; }

      // Require exact name match (case-insensitive) to avoid false matches
      if (match.name.toLowerCase() !== name.toLowerCase()) {
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      result.artists_emerging.push({
        ...match,
        followers: listeners, // Last.fm listeners as proxy for Spotify followers
        discovery_source: category,
      });
    } catch (err) {
      console.warn(`[discovery] Spotify lookup failed for "${name}": ${err.message}`);
      result.errors.push(`spotify lookup "${name}": ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[discovery] emerging: ${result.artists_emerging.length}`);
  return result;
}
