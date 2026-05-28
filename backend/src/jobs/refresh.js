import {
  listArtists,
  upsertArtist,
  recordSnapshot,
  upsertTourDate,
  listUnnotifiedTours,
  markToursNotified,
  getArtist,
} from '../db/database.js';
import { searchTopArtist, getArtistById } from '../services/spotify.js';
import { fetchUsTourDates } from '../services/bandsintown.js';
import { discoverFromPlaylists } from '../services/discovery.js';
import { sendTourAlertEmail } from '../services/email.js';

// Resolve fresh artist data using Spotify Search (per user request).
// Falls back to /v1/artists/{id} if the search result's ID doesn't match
// our stored ID — that prevents overwriting an artist's row with stats
// from a different artist who happens to share their name.
async function fetchFreshArtistData(stored) {
  try {
    const fresh = await searchTopArtist(stored.name);
    if (fresh && fresh.id === stored.id) return fresh;
    if (fresh) {
      console.warn(
        `[refresh] search for "${stored.name}" returned ${fresh.id} (stored is ${stored.id}); falling back to /artists/{id}`,
      );
    } else {
      console.warn(
        `[refresh] search for "${stored.name}" returned no match; falling back to /artists/{id}`,
      );
    }
  } catch (err) {
    console.warn(
      `[refresh] search failed for "${stored.name}": ${err.message}; falling back to /artists/{id}`,
    );
  }
  return await getArtistById(stored.id);
}

// Refresh a single artist's stats and record a snapshot. Used by both the
// daily job and the per-artist Refresh button on the dashboard.
export async function refreshOneArtist(artistId) {
  const stored = await getArtist(artistId);
  if (!stored) throw new Error(`Artist ${artistId} not found`);

  const fresh = await fetchFreshArtistData(stored);

  const now = new Date().toISOString();
  await upsertArtist({
    ...fresh,
    id: stored.id,
    source: stored.source,
    discovery_source: stored.discovery_source,
    added_at: stored.added_at,
    last_refreshed_at: now,
  });
  await recordSnapshot({
    artist_id: stored.id,
    followers: fresh.followers,
    popularity: fresh.popularity,
  });

  return await getArtist(stored.id);
}

// Single 24h refresh cycle. Each phase is isolated so a failure in
// discovery or tour-fetch does NOT prevent existing tracked artists
// from being refreshed.
export async function runRefresh({ skipDiscovery = false } = {}) {
  const summary = {
    artists_refreshed: 0,
    snapshots_recorded: 0,
    discovery: null,
    tours_added: 0,
    emails_sent: 0,
    errors: [],
  };

  // ---- Phase 1: refresh stats for every tracked artist -----------------
  const tracked = await listArtists({ includeDismissed: false });
  for (const a of tracked) {
    try {
      await refreshOneArtist(a.id);
      summary.artists_refreshed += 1;
      summary.snapshots_recorded += 1;
    } catch (err) {
      const msg = `refresh "${a.name}" (${a.id}): ${err.message}`;
      summary.errors.push(msg);
      console.error('[refresh]', msg);
    }
  }

  // ---- Phase 2: playlist-based discovery -------------------------------
  if (!skipDiscovery) {
    try {
      const disc = await discoverFromPlaylists();
      summary.discovery = {
        playlists_attempted: disc.playlists_attempted,
        playlists_failed: disc.playlists_failed,
        artists_seen: disc.artists_seen,
        artists_added: 0,
      };
      const now = new Date().toISOString();
      for (const candidate of disc.artists_emerging) {
        if (await getArtist(candidate.id)) continue;
        await upsertArtist({
          ...candidate,
          source: 'discovered',
          discovery_source: candidate.discovery_source,
          added_at: now,
          last_refreshed_at: now,
        });
        await recordSnapshot({
          artist_id: candidate.id,
          followers: candidate.followers,
          popularity: candidate.popularity,
        });
        summary.discovery.artists_added += 1;
      }
      if (disc.errors.length) summary.errors.push(...disc.errors);
    } catch (err) {
      summary.errors.push(`discovery: ${err.message}`);
      console.error('[discovery]', err);
    }
  }

  // ---- Phase 3: tour dates for every (now-current) tracked artist ------
  for (const a of await listArtists({ includeDismissed: false })) {
    try {
      const tours = await fetchUsTourDates(a);
      for (const t of tours) await upsertTourDate(t);
      summary.tours_added += tours.length;
    } catch (err) {
      summary.errors.push(`tours for ${a.name}: ${err.message}`);
    }
  }

  // ---- Phase 4: email any unnotified tour dates ------------------------
  try {
    const unnotified = await listUnnotifiedTours();
    if (unnotified.length) {
      const sentIds = await sendTourAlertEmail(unnotified);
      if (sentIds.length) {
        await markToursNotified(sentIds);
        summary.emails_sent = 1;
      }
    }
  } catch (err) {
    summary.errors.push(`email: ${err.message}`);
  }

  return summary;
}
