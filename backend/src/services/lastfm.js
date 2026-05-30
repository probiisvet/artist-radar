// Last.fm API client for genre-based artist discovery.
//
// tag.gettopartists  — returns artist names for a genre tag (no listener counts)
// artist.getinfo     — returns real listener + playcount stats for one artist

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

function apiKey() {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error('LASTFM_API_KEY not set');
  return key;
}

// Get top artist NAMES for a genre tag.
// Does NOT return listener counts — use getArtistInfo() for that.
export async function getTagArtists(tag, { page = 1, limit = 50 } = {}) {
  const url =
    `${LASTFM_BASE}?method=tag.gettopartists` +
    `&tag=${encodeURIComponent(tag)}` +
    `&api_key=${apiKey()}` +
    `&format=json` +
    `&limit=${limit}` +
    `&page=${page}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm ${res.status} for tag "${tag}"`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);

  const artists = data.topartists?.artist ?? [];
  // Normalize — may be a single object if only one result
  const list = Array.isArray(artists) ? artists : [artists];
  return list.map((a) => ({ name: a.name, mbid: a.mbid ?? null }));
}

// Get real listener count for a single artist by name.
export async function getArtistInfo(name) {
  const url =
    `${LASTFM_BASE}?method=artist.getinfo` +
    `&artist=${encodeURIComponent(name)}` +
    `&api_key=${apiKey()}` +
    `&format=json` +
    `&autocorrect=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm ${res.status} for artist "${name}"`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);

  return {
    name: data.artist?.name ?? name,
    listeners: parseInt(data.artist?.stats?.listeners ?? '0', 10),
    playcount: parseInt(data.artist?.stats?.playcount ?? '0', 10),
  };
}
