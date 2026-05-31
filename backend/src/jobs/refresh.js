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

  // Spotify (Development Mode) systematically returns null followers. When that
  // happens, fall back to the LIVE Last.fm listener count so manually-tracked
  // artists also get a real number and day-over-day growth — otherwise they'd
  // be stuck on "0 listeners / no growth data yet" forever.
  let followers = fresh.followers;
  if (followers == null) {
    try {
      const info = await getArtistInfo(stored.name);
      if (info.listeners > 0) followers = info.listeners;
    } catch (err) {
      console.warn(`[refresh] Last.fm fallback failed for "${stored.name}": ${err.message}`);
    }
  }

  const now = new Date().toISOString();
  await upsertArtist({
    ...fresh,
    id: stored.id,
    followers,
    source: stored.source,
    discovery_source: stored.discovery_source,
    added_at: stored.added_at,
    last_refreshed_at: now,
  });
  await recordSnapshot({
    artist_id: stored.id,
    followers,
    popularity: fresh.popularity,
  });

  return await getArtist(stored.id);
}

// Single 24h refresh cycle. Each phase is isolated so a failure in
// discovery or tour-fetch does NOT prevent existing tracked artists
// from being refreshed.
// `phases` lets the caller run only part of the cycle (used by the separate
// dashboard buttons): { artists, discovery, tours }. When omitted, the full
// cycle runs (daily cron + the main "Run full refresh" button). `skipDiscovery`
// is kept for backward compatibility and just turns the discovery phase off.
export async function runRefresh({ skipDiscovery = false, phases } = {}) {
  const run = phases ?? {
    artists: true,
    discovery: !skipDiscovery,
    tours: true,
  };

  const summary = {
    ran: run,
    artists_refreshed: 0,
    snapshots_recorded: 0,
    pruned: 0,
    discovery: null,
    tours_searched: 0,
    tours_added: 0,
    tours_quota_hit: false,
    emails_sent: 0,
    errors: [],
  };

  // ---- Phase 1: refresh stats for every tracked artist -----------------
  if (run.artists) {
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

    // ---- Phase 1.5: prune auto-discovered artists that aren't growing ---
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
  }

  // ---- Phase 2: playlist-based discovery -------------------------------
  if (run.discovery) {
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
  // Google search surfaces links from ticketing sites (Ticketmaster, Songkick…)
  // when an artist starts touring. We store only brand-new links. Runs for ALL
  // tracked artists (manual + discovered alike).
  if (run.tours) {
    let searchBlocked = false;
    for (const a of await listArtists({ includeDismissed: false })) {
      if (searchBlocked) break;
      try {
        const leads = await searchTourNews(a);
        summary.tours_searched += 1;
        for (const lead of leads) {
          if (await insertTourLead(lead)) summary.tours_added += 1;
        }
      } catch (err) {
        if (/429|quota|rate limit/i.test(err.message)) {
          searchBlocked = true;
          summary.tours_quota_hit = true;
          console.warn('[refresh] Search quota hit — stopping tour-news scan for this run');
        } else {
          console.warn(`[refresh] tour-news search failed for "${a.name}": ${err.message}`);
        }
      }
      // Gentle pacing between searches.
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- Phase 4: email any unnotified tour-news leads -----------------
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
  }

  return summary;
}
