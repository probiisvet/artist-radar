// Ticketmaster Discovery API — free US tour-date lookup for any artist.
// Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
//
// Unlike Bandsintown (artists-only, blocks third-party app_ids), Ticketmaster's
// Discovery API gives a free key to anyone and works for arbitrary artists.
//
// Flow per artist:
//   1. attractions search by name → get the attraction id (most precise match)
//   2. events by attractionId + countryCode=US → upcoming US shows
// Falls back to a keyword event search if the artist has no attraction entry.

const API_BASE = 'https://app.ticketmaster.com/discovery/v2';

function apiKey() {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error('TICKETMASTER_API_KEY not set');
  return key;
}

async function tmFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API_BASE}${path}${sep}apikey=${encodeURIComponent(apiKey())}`);
  if (res.status === 429) throw new Error('Ticketmaster rate limit (429)');
  if (!res.ok) throw new Error(`Ticketmaster ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Find the best-matching Ticketmaster attraction id for an artist name.
async function findAttractionId(name) {
  const data = await tmFetch(
    `/attractions.json?keyword=${encodeURIComponent(name)}&classificationName=Music&size=5`,
  );
  const list = data._embedded?.attractions ?? [];
  // Prefer an exact (case-insensitive) name match; otherwise take the top hit.
  const exact = list.find((a) => a.name?.toLowerCase() === name.toLowerCase());
  return (exact ?? list[0])?.id ?? null;
}

// Normalise one Ticketmaster event into our DB tour shape.
function mapEvent(ev, artist) {
  const venue = ev._embedded?.venues?.[0];
  const localDate = ev.dates?.start?.localDate;
  const localTime = ev.dates?.start?.localTime;
  const eventDate = localDate
    ? (localTime ? `${localDate}T${localTime}` : localDate)
    : ev.dates?.start?.dateTime ?? null;

  return {
    id: `tm:${ev.id}`,
    artist_id: artist.id,
    event_date: eventDate,
    venue_name: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    region: venue?.state?.stateCode ?? venue?.state?.name ?? null,
    country: venue?.country?.name ?? 'United States',
    ticket_url: ev.url ?? null,
    created_at: new Date().toISOString(),
  };
}

// Returns upcoming US shows for an artist, normalised to our DB shape.
// Drop-in replacement for the old Bandsintown fetchUsTourDates(artist).
export async function fetchUsTourDates(artist) {
  let events = [];

  const attractionId = await findAttractionId(artist.name);
  if (attractionId) {
    const data = await tmFetch(
      `/events.json?attractionId=${encodeURIComponent(attractionId)}&countryCode=US&size=50&sort=date,asc`,
    );
    events = data._embedded?.events ?? [];
  } else {
    // No attraction entry — fall back to a direct keyword event search.
    const data = await tmFetch(
      `/events.json?keyword=${encodeURIComponent(artist.name)}&classificationName=Music&countryCode=US&size=20&sort=date,asc`,
    );
    events = data._embedded?.events ?? [];
  }

  return events.map((ev) => mapEvent(ev, artist)).filter((t) => t.event_date);
}
