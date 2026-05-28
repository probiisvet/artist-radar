import { Router } from 'express';
import {
  listArtists,
  getArtist,
  upsertArtist,
  deleteArtist,
  setDismissed,
  recordSnapshot,
  getBaselineSnapshot,
} from '../db/database.js';
import { searchArtists, getArtistById } from '../services/spotify.js';
import { refreshOneArtist } from '../jobs/refresh.js';

const router = Router();

async function withGrowth(artist) {
  const baseline = await getBaselineSnapshot(artist.id, 30);
  let followers_growth_pct = null;
  let popularity_change = null;
  if (baseline && baseline.followers > 0) {
    followers_growth_pct =
      ((artist.followers - baseline.followers) / baseline.followers) * 100;
    popularity_change = artist.popularity - baseline.popularity;
  }
  const maxFollowers = Number(process.env.MAX_FOLLOWERS ?? 1_000_000);
  return {
    ...artist,
    genres: safeParseGenres(artist.genres),
    followers_growth_pct,
    popularity_change,
    baseline_recorded_at: baseline?.recorded_at ?? null,
    // null followers = unknown, treat as potentially emerging
    is_emerging: artist.followers == null || artist.followers < maxFollowers,
  };
}

function safeParseGenres(s) {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return [];
  }
}

// GET /api/artists — list tracked artists (excludes dismissed by default)
router.get('/', async (req, res, next) => {
  try {
    const includeDismissed = req.query.include_dismissed === 'true';
    const raw = await listArtists({ includeDismissed });
    const artists = await Promise.all(raw.map(withGrowth));
    artists.sort((a, b) => {
      if (a.is_emerging !== b.is_emerging) return a.is_emerging ? -1 : 1;
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    });
    res.json({ artists });
  } catch (err) {
    next(err);
  }
});

// GET /api/artists/search?q=... — proxy Spotify search for the "Add" UI
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ results: [] });
    const results = await searchArtists(q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// POST /api/artists — add an artist by Spotify ID
// body: { id: string }
router.post('/', async (req, res, next) => {
  try {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const existing = await getArtist(id);
    if (existing) {
      if (existing.dismissed) await setDismissed(id, false);
      return res.json({ artist: await withGrowth(await getArtist(id)), added: false });
    }

    const fetched = await getArtistById(id);
    const now = new Date().toISOString();
    await upsertArtist({
      ...fetched,
      source: 'manual',
      added_at: now,
      last_refreshed_at: now,
    });
    await recordSnapshot({
      artist_id: fetched.id,
      followers: fetched.followers,
      popularity: fetched.popularity,
    });
    res.status(201).json({ artist: await withGrowth(await getArtist(id)), added: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/artists/:id/refresh — re-fetch a single artist on demand
router.post('/:id/refresh', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!(await getArtist(id))) return res.status(404).json({ error: 'not found' });
    await refreshOneArtist(id);
    res.json({ artist: await withGrowth(await getArtist(id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/artists/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await deleteArtist(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/artists/:id — { dismissed: boolean }
router.patch('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!(await getArtist(id))) return res.status(404).json({ error: 'not found' });
    if (typeof req.body?.dismissed === 'boolean') {
      await setDismissed(id, req.body.dismissed);
    }
    res.json({ artist: await withGrowth(await getArtist(id)) });
  } catch (err) {
    next(err);
  }
});

export default router;
