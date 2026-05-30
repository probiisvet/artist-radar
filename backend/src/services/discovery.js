// Emerging-artist discovery using Last.fm + Spotify.
//
// Last.fm tag.gettopartists gives us artist names by genre.
// Last.fm artist.getinfo gives us real listener counts per artist.
// Spotify search gives us the Spotify ID for tracking.
//
// Flow:
//   1. Collect unique artist names from Last.fm genre tags (pages 4-7)
//   2. For up to MAX_LOOKUPS candidates, fetch real listener counts
//   3. Keep artists with listeners between MIN and cap (default 500k)
//   4. Cross-reference with Spotify to get Spotify IDs

import { searchArtists } from './spotify.js';
import { getTagArtists, getArtistInfo } from './lastfm.js';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories } from '../db/database.js';

// Higher pages = smaller/less known artists per genre. Pages 4-7 still return
// the top ~350 artists of a genre (way above the emerging range), so we reach
// deeper where the genuinely small artists live.
const PAGES = [12, 16, 20, 24];
// How many artists to verify with artist.getinfo (each = 1 API call)
const MAX_LOOKUPS = 150;
// "Emerging" window, in Last.fm listeners. Decoupled from MAX_FOLLOWERS on
// purpose: Last.fm has far fewer users than Spotify, so a genuinely emerging
// artist sits around 1k–80k listeners. Famous acts (Zendaya, Zac Efron…)
// have 700k+ Last.fm listeners and must be excluded.
// Override with LASTFM_MAX_LISTENERS / LASTFM_MIN_LISTENERS env vars.
const MIN_LISTENERS = Number(process.env.LASTFM_MIN_LISTENERS ?? 1_000);
const MAX_LISTENERS = Number(process.env.LASTFM_MAX_LISTENERS ?? 80_000);

const REQUEST_DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discoverFromPlaylists({ maxListeners } = {}) {
  // Use the dedicated emerging cap, NOT MAX_FOLLOWERS (which is a Spotify-scale
  // number and lets famous artists slip through on the Last.fm scale).
  const cap = Number(maxListeners ?? MAX_LISTENERS);
  const disabled = new Set(await getDisabledCategories());
  const enabled = DISCOVERY_CATEGORIES.filter((c) => !disabled.has(c.category));

  const result = {
    playlists_attempted: 0,
    playlists_failed: 0,
    artists_seen: 0,
    artists_emerging: [],
    errors: [],
  };

  // Step 1: collect candidate names from Last.fm genre tags
  const candidates = new Map(); // name.toLowerCase() -> { name, category }

  for (const cat of enabled) {
    for (const genre of cat.genres) {
      if (!genre) continue;
      for (const page of PAGES) {
        result.playlists_attempted += 1;
        const label = `${cat.category} / ${genre} p${page}`;
        try {
          const artists = await getTagArtists(genre, { page, limit: 50 });
          for (const a of artists) {
            if (a.name && !candidates.has(a.name.toLowerCase())) {
              candidates.set(a.name.toLowerCase(), { name: a.name, category: cat.category });
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
  // Shuffle so the MAX_LOOKUPS sample spans ALL genres and page depths, instead
  // of just the first genre's top results (which are never emerging).
  const pool = [...candidates.values()];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const toCheck = pool.slice(0, MAX_LOOKUPS);
  console.log(`[discovery] ${candidates.size} unique candidates — checking ${toCheck.length} via artist.getinfo`);

  // Step 2: get real listener counts from Last.fm
  const qualified = [];
  for (const { name, category } of toCheck) {
    try {
      const info = await getArtistInfo(name);
      if (info.listeners >= MIN_LISTENERS && info.listeners <= cap) {
        qualified.push({ name: info.name, listeners: info.listeners, category });
        console.log(`[discovery] ✓ ${info.name} — ${info.listeners.toLocaleString()} listeners`);
      }
    } catch (err) {
      console.warn(`[discovery] getinfo failed for "${name}": ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[discovery] ${qualified.length} artists in ${MIN_LISTENERS.toLocaleString()}–${cap.toLocaleString()} listener range`);

  // Step 3: build emerging records. Spotify is OPTIONAL enrichment (image +
  // link). We never REQUIRE a Spotify match — that used to drop artists and,
  // worse, 80+ searches per run got the app rate-limited for hours. Once we
  // hit a 429 we stop calling Spotify entirely and fall back to Last.fm data
  // for the rest, so discovery always returns every qualified artist.
  let spotifyBlocked = false;
  for (const { name, listeners, category } of qualified) {
    const base = lastfmArtistRecord(name, listeners, category);
    let record = base;

    if (!spotifyBlocked) {
      try {
        const results = await searchArtists(name, { limit: 1 });
        const match = results[0];
        if (match && match.name.toLowerCase() === name.toLowerCase()) {
          // Keep our stable Last.fm id (so dedupe works whether or not Spotify
          // is reachable) and just borrow Spotify's image + link.
          record = {
            ...base,
            image_url: match.image_url ?? null,
            spotify_url: match.spotify_url ?? base.spotify_url,
            genres: match.genres ?? base.genres,
          };
        }
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        if (err.status === 429) {
          spotifyBlocked = true;
          console.warn('[discovery] Spotify rate-limited — using Last.fm-only records for the rest');
        } else {
          console.warn(`[discovery] Spotify lookup failed for "${name}": ${err.message}`);
        }
      }
    }

    result.artists_emerging.push(record);
  }

  console.log(`[discovery] emerging: ${result.artists_emerging.length} (spotify enrichment: ${spotifyBlocked ? 'partial — rate-limited' : 'ok'})`);
  return result;
}

// Build a self-contained emerging-artist record from Last.fm data alone, with
// a stable id derived from the name so re-runs dedupe correctly without Spotify.
function lastfmArtistRecord(name, listeners, category) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: `lastfm:${slug}`,
    name,
    image_url: null,
    spotify_url: `https://www.last.fm/music/${encodeURIComponent(name)}`,
    genres: JSON.stringify([]),
    followers: listeners, // Last.fm listeners as our follower proxy
    popularity: null,
    discovery_source: category,
  };
}
