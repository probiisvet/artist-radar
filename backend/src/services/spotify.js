// Spotify Web API client using the Client Credentials flow.
//
// Endpoints used here are all available to new (post-Nov-2024) apps:
//   POST /api/token                       (auth)
//   GET  /v1/search?type=artist           (manual add + per-artist refresh)
//   GET  /v1/artists/{id}                 (single artist by ID)
//   GET  /v1/artists?ids=...              (batch artist lookup, up to 50)
//   GET  /v1/playlists/{id}/tracks        (playlist-based discovery)
//
// Endpoints intentionally NOT used (deprecated for new apps):
//   GET /v1/recommendations               (404 for new apps)
//   GET /v1/audio-features                (deprecated)
//   GET /v1/artists/{id}/related-artists  (deprecated)
//   GET /v1/browse/featured-playlists     (deprecated)
//   GET /v1/browse/categories/{id}/playlists (deprecated)
//
// Note on "monthly listeners": the official API does not expose this.
// We use followers.total and popularity (0-100) and snapshot daily.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
  }

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[spotify] auth failed: ${res.status} ${body}`);
    throw new Error(`Spotify auth failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// Exported so the discovery service can hit playlist endpoints without
// duplicating auth logic.
export async function spotifyFetch(pathAndQuery) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 1);
    // Cap the wait at 60s. Spotify sometimes returns retry-after values
    // in the tens-of-thousands of seconds, which would freeze the whole
    // refresh. Bail out fast and let the caller decide what to do.
    if (retryAfter > 60) {
      const body = await res.text();
      console.error(
        `[spotify] 429 on ${pathAndQuery} with retry-after=${retryAfter}s (>60s cap) — failing fast`,
      );
      const err = new Error(
        `Spotify rate limit: retry-after=${retryAfter}s. Body: ${body}`,
      );
      err.status = 429;
      err.retryAfter = retryAfter;
      throw err;
    }
    console.warn(`[spotify] 429 on ${pathAndQuery}; retrying in ${retryAfter}s`);
    await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
    return spotifyFetch(pathAndQuery);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`[spotify] ${res.status} on ${pathAndQuery} → ${body}`);
    const err = new Error(`Spotify API ${res.status} on ${pathAndQuery}: ${body}`);
    err.status = res.status;
    err.responseBody = body;
    throw err;
  }
  return res.json();
}

// Lenient normaliser — returns an object as long as id+name are present.
// Followers / popularity may end up null; callers that *write to DB* must
// validate explicitly (see ensureStats below). This way the Add UI can
// still display every search hit, even if a particular artist's payload
// is missing one of the stats fields.
function normaliseArtist(a) {
  if (!a?.id || !a?.name) return null;
  return {
    id: a.id,
    name: a.name,
    image_url: a.images?.[0]?.url ?? null,
    spotify_url: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
    genres: JSON.stringify(a.genres ?? []),
    followers: a.followers?.total ?? null,
    popularity: a.popularity ?? null,
  };
}

function ensureStats(artist, where) {
  if (artist.followers == null || artist.popularity == null) {
    throw new Error(
      `${where} for "${artist.name}" (${artist.id}) is missing followers/popularity — refusing to use this payload`,
    );
  }
  return artist;
}

export async function searchArtists(query, { limit = 5, offset = 0, market } = {}) {
  const q = encodeURIComponent(query);
  let url = `/search?q=${q}&type=artist&limit=${limit}`;
  if (offset > 0) url += `&offset=${offset}`;
  if (market) url += `&market=${encodeURIComponent(market)}`;
  const data = await spotifyFetch(url);
  return (data.artists?.items ?? []).map(normaliseArtist).filter(Boolean);
}

// Used by the daily refresh and the per-artist Refresh button.
// Search returns full artist objects with followers + popularity.
export async function searchTopArtist(name) {
  const q = encodeURIComponent(name);
  const data = await spotifyFetch(`/search?q=${q}&type=artist&limit=1`);
  const item = data.artists?.items?.[0];
  if (!item) return null;
  const norm = normaliseArtist(item);
  if (!norm) {
    throw new Error(
      `Spotify search for "${name}" returned a malformed artist payload: ${JSON.stringify(item).slice(0, 200)}`,
    );
  }
  return ensureStats(norm, `search "${name}"`);
}

export async function getArtistById(id) {
  const data = await spotifyFetch(`/artists/${id}`);
  const norm = normaliseArtist(data);
  if (!norm) {
    throw new Error(
      `Spotify /artists/${id} returned invalid payload: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return ensureStats(norm, `/v1/artists/${id}`);
}

export async function getArtistsByIds(ids) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const results = [];
  for (const chunk of chunks) {
    const data = await spotifyFetch(`/artists?ids=${chunk.join(',')}`);
    for (const a of data.artists ?? []) {
      const norm = normaliseArtist(a);
      if (norm) results.push(norm);
      else if (a) {
        console.warn(
          `[spotify] dropped malformed artist in batch (id=${a?.id}, name=${a?.name})`,
        );
      }
    }
  }
  return results;
}

// Fetch tracks from a Spotify playlist. Spotify-owned editorial playlists
// return 403 for new apps; user-created playlists work fine.
export async function fetchPlaylistTracks(playlistId, { limit = 100 } = {}) {
  const fields = encodeURIComponent('items(track(id,name,artists(id,name)))');
  const data = await spotifyFetch(
    `/playlists/${playlistId}/tracks?fields=${fields}&limit=${limit}`,
  );
  return (data.items ?? []).map((it) => it?.track).filter(Boolean);
}

// Album search — the discovery primary. Combine with `tag:new` for albums
// released in the past 2 weeks (Spotify's own "new releases" filter).
// limit defaults to 20 — new apps appear to cap search limit below 50.
export async function searchAlbums(query, { limit = 20, market = 'US' } = {}) {
  const q = encodeURIComponent(query);
  const data = await spotifyFetch(
    `/search?q=${q}&type=album&limit=${limit}&market=${encodeURIComponent(market)}`,
  );
  return data.albums?.items ?? [];
}
