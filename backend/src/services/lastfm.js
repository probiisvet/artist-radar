// Last.fm API client for genre-based artist discovery.
// Unlike Spotify, Last.fm reliably returns listener counts for all artists —
// making it suitable for "emerging artist" filtering (Spotify's API omits
// followers/popularity for Development Mode apps).

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

// Fetch top artists for a genre tag from Last.fm.
// Page 1 = most popular (skip). Pages 2-4 = emerging territory.
export async function getTagArtists(tag, { page = 1, limit = 50 } = {}) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error('LASTFM_API_KEY not set');

  const url =
    `${LASTFM_BASE}?method=tag.gettopartists` +
    `&tag=${encodeURIComponent(tag)}` +
    `&api_key=${key}` +
    `&format=json` +
    `&limit=${limit}` +
    `&page=${page}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm API ${res.status} for tag "${tag}"`);

  const data = await res.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);

  const artists = data.topartists?.artist ?? [];
  return artists.map((a) => ({
    name: a.name,
    listeners: parseInt(a.listeners ?? '0', 10),
    lastfm_url: a.url ?? null,
  }));
}
