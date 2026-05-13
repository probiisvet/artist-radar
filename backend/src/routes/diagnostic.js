// Spotify diagnostic endpoint.
// Hit GET /api/diagnostic from the browser; returns a JSON report of which
// Spotify endpoints work for your specific app, and where the search
// `limit` parameter starts being rejected.

import { Router } from 'express';
import { spotifyFetch } from '../services/spotify.js';

const router = Router();

router.get('/', async (_req, res) => {
  const result = {
    timestamp: new Date().toISOString(),
    env: {
      SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID
        ? `set (${process.env.SPOTIFY_CLIENT_ID.slice(0, 6)}…${process.env.SPOTIFY_CLIENT_ID.slice(-2)})`
        : '❌ MISSING',
      SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET
        ? `set (${process.env.SPOTIFY_CLIENT_SECRET.length} chars)`
        : '❌ MISSING',
      BANDSINTOWN_APP_ID: process.env.BANDSINTOWN_APP_ID || '(default)',
      MAX_FOLLOWERS: process.env.MAX_FOLLOWERS || '(default 500000)',
    },
    tests: {},
    summary: { ok: 0, fail: 0 },
  };

  const test = async (name, fn) => {
    const start = Date.now();
    try {
      const value = await fn();
      result.tests[name] = { status: '✅ ok', ms: Date.now() - start, ...value };
      result.summary.ok += 1;
    } catch (err) {
      result.tests[name] = {
        status: '❌ fail',
        ms: Date.now() - start,
        error: err.message?.slice(0, 300),
      };
      result.summary.fail += 1;
    }
  };

  // ---- AUTH ----
  await test('1_auth_token', async () => {
    // spotifyFetch will trigger token refresh if needed
    const data = await spotifyFetch('/artists/3TVXtAsR1Inumwj472S9r4');
    return { note: 'auth ok, fetched a public artist', artist_name: data?.name };
  });

  // ---- KNOWN ARTIST BY ID (Drake) ----
  await test('2_get_artist_by_id', async () => {
    const data = await spotifyFetch('/artists/3TVXtAsR1Inumwj472S9r4');
    return {
      name: data?.name,
      followers: data?.followers?.total,
      popularity: data?.popularity,
    };
  });

  // ---- SEARCH WITH DIFFERENT LIMITS (find the cap) ----
  for (const lim of [1, 5, 10, 15, 20, 30, 50]) {
    await test(`3_search_limit_${lim}`, async () => {
      const data = await spotifyFetch(`/search?q=indie&type=artist&limit=${lim}`);
      return { returned: data.artists?.items?.length ?? 0 };
    });
  }

  // ---- SEARCH WITH MARKET PARAM ----
  await test('4_search_with_market_US', async () => {
    const data = await spotifyFetch('/search?q=indie&type=artist&limit=5&market=US');
    return { returned: data.artists?.items?.length ?? 0 };
  });

  // ---- ADVANCED SEARCH FILTERS ----
  await test('5_search_genre_filter', async () => {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent('genre:indie')}&type=artist&limit=5`,
    );
    return { returned: data.artists?.items?.length ?? 0 };
  });

  await test('6_search_tag_new_albums', async () => {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent('tag:new')}&type=album&limit=5`,
    );
    return { returned: data.albums?.items?.length ?? 0 };
  });

  await test('7_search_year_filter', async () => {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent('year:2025')}&type=track&limit=5`,
    );
    return { returned: data.tracks?.items?.length ?? 0 };
  });

  // ---- DEPRECATED ENDPOINTS (expected to fail for new apps) ----
  await test('8_new_releases', async () => {
    const data = await spotifyFetch('/browse/new-releases?country=US&limit=5');
    return { returned: data.albums?.items?.length ?? 0 };
  });

  await test('9_recommendations', async () => {
    const data = await spotifyFetch('/recommendations?seed_genres=pop&limit=5');
    return { returned: data.tracks?.length ?? 0 };
  });

  await test('10_spotify_owned_playlist', async () => {
    // RapCaviar — Spotify-owned
    const data = await spotifyFetch(
      '/playlists/37i9dQZF1DX0XUsuxWHRQd/tracks?limit=5',
    );
    return { returned: data.items?.length ?? 0 };
  });

  res.json(result);
});

export default router;
