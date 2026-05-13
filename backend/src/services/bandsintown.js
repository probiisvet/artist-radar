// Bandsintown public API — no API key, just an arbitrary `app_id`.
// Docs: https://artists.bandsintown.com/support/public-api

const API_BASE = 'https://rest.bandsintown.com';

function appId() {
  const id = process.env.BANDSINTOWN_APP_ID;
  if (!id) throw new Error('BANDSINTOWN_APP_ID must be set in .env');
  return id;
}

// Bandsintown looks up artists by URL-encoded name. Special chars need
// double-encoding per their docs (e.g. "/" -> "%252F"). For most artist
// names this works fine.
function encodeArtistName(name) {
  return encodeURIComponent(name).replace(/%2F/gi, '%252F');
}

export async function fetchArtistEvents(artistName) {
  const url = `${API_BASE}/artists/${encodeArtistName(artistName)}/events?app_id=${encodeURIComponent(appId())}`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`Bandsintown ${res.status}: ${await res.text()}`);
  }
  // Bandsintown sometimes returns "{warn=Not found}" with status 200.
  const text = await res.text();
  if (!text || text.startsWith('{warn')) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

// Returns only US shows, normalised to our DB shape.
export async function fetchUsTourDates(artist) {
  const events = await fetchArtistEvents(artist.name);
  return events
    .filter((e) => e?.venue?.country === 'United States')
    .map((e) => ({
      id: String(e.id),
      artist_id: artist.id,
      event_date: e.datetime,
      venue_name: e.venue?.name ?? null,
      city: e.venue?.city ?? null,
      region: e.venue?.region ?? null,
      country: e.venue?.country ?? null,
      ticket_url: e.offers?.find((o) => o.type === 'Tickets')?.url ?? e.url ?? null,
      created_at: new Date().toISOString(),
    }));
}
