import {
  listArtists,
  upsertArtist,
  recordSnapshot,
  getArtist,
  getPriorDaySnapshot,
  deleteArtist,
  insertTourLead,
  listUnnotifiedLeads,
  markLeadsNotified,
} from '../db/database.js';
import { searchTopArtist, getArtistById } from '../services/spotify.js';
import { searchTourNews } from '../services/tourNews.js';
import { discoverFromPlaylists } from '../services/discovery.js';
import { getArtistInfo } from '../services/lastfm.js';
import { sendTourLeadEmail } from '../services/email.js';

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

  // Auto-discovered artists carry Last.fm listener counts as their "followers".
  // Spotify (Development Mode) returns null, so we re-fetch the LIVE Last.fm
  // listener count instead — that's what lets us see growth day over day.
  if (stored.source === 'discovered') {
    let followers = stored.followers;
    try {
      const info = await getArtistInfo(stored.name);
      if (info.listeners > 0) followers = info.listeners;
    } catch (err) {
      console.warn(`[refresh] Last.fm getinfo failed for "${stored.name}": ${err.message} — keeping previous count`);
    }
    await upsertArtist({ ...stored, followers, last_refreshed_at: new Date().toISOString() });
    await recordSnapshot({ artist_id: stored.id, followers, popularity: null });
    return await getArtist(stored.id);
  }

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
    pruned: 0,
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

  // ---- Phase 1.5: prune auto-discovered artists that aren't growing -----
  // Keep only artists whose Last.fm listeners went UP versus a previous day.
  // Those that dropped or stayed flat are removed automatically. We never
  // touch manually-tracked artists — the user added those on purpose.
  for (const a of await listArtists({ includeDismissed: false })) {
    if (a.source !== 'discovered') continue;
    if (a.followers == null) continue;
    const prior = await getPriorDaySnapshot(a.id);
    if (!prior) continue; // discovered today — give it at least one day
    if (a.followers <= prior.followers) {
      await deleteArtist(a.id);
      summary.pruned += 1;
      console.log(`[refresh] pruned "${a.name}" — ${prior.followers} → ${a.followers} listeners (not growing)`);
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

  // ---- Phase 3: web-search each artist for tour news -------------------
  // Brave Search surfaces links from ticketing sites (Ticketmaster, Songkick…)
  // when an artist starts touring. We store only brand-new links.
  let braveBlocked = false;
  for (const a of await listArtists({ includeDismissed: false })) {
    if (braveBlocked) break;
    try {
      const leads = await searchTourNews(a);
      for (const lead of leads) {
        if (await insertTourLead(lead)) summary.tours_added += 1;
      }
    } catch (err) {
      if (/429|rate limit/i.test(err.message)) {
        braveBlocked = true;
        console.warn('[refresh] Brave Search rate-limited — stopping tour-news scan for this run');
      } else {
        console.warn(`[refresh] tour-news search failed for "${a.name}": ${err.message}`);
      }
    }
    // Brave free tier allows ~1 req/s — pace ourselves.
    await new Promise((r) => setTimeout(r, 1100));
  }

  // ---- Phase 4: email any unnotified tour-news leads -------------------
  try {
    const unnotified = await listUnnotifiedLeads();
    if (unnotified.length) {
      const sentIds = await sendTourLeadEmail(unnotified);
      if (sentIds.length) {
        await markLeadsNotified(sentIds);
        summary.emails_sent = 1;
      }
    }
  } catch (err) {
    summary.errors.push(`email: ${err.message}`);
  }

  return summary;
}
