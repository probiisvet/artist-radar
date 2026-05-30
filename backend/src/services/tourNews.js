// Tour "news" discovery via Brave Search API.
// Docs: https://brave.com/search/api/  (free tier: single key, ~2k queries/mo)
//
// We can't get exact tour dates without an artists-only API (Bandsintown) or a
// developer key the user can't create (Ticketmaster). Instead we web-search
// each tracked artist and surface links from known ticketing / tour sites, so
// the user gets an alert to investigate when an artist starts touring.

import crypto from 'node:crypto';

const BRAVE_BASE = 'https://api.search.brave.com/res/v1/web/search';

// Only treat results from these domains as real tour leads — keeps random
// blogs / lyric sites out and avoids false "tour" alerts.
const TOUR_SITES = [
  'ticketmaster.com',
  'livenation.com',
  'bandsintown.com',
  'songkick.com',
  'seatgeek.com',
  'axs.com',
  'eventbrite.com',
  'stubhub.com',
  'dice.fm',
];

function apiKey() {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY not set');
  return key;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchedSite(url) {
  const host = hostOf(url);
  return TOUR_SITES.find((s) => host === s || host.endsWith(`.${s}`)) ?? null;
}

// Returns an array of { id, artist_id, title, url, source_site } leads for an
// artist — only links that live on a known ticketing / tour-listing site.
export async function searchTourNews(artist) {
  const query = `${artist.name} tour tickets concert`;
  const url = `${BRAVE_BASE}?q=${encodeURIComponent(query)}&count=10&country=us`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey(),
    },
  });
  if (res.status === 429) throw new Error('Brave Search rate limit (429)');
  if (!res.ok) throw new Error(`Brave Search ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const results = data.web?.results ?? [];

  const leads = [];
  const seen = new Set();
  for (const r of results) {
    const site = matchedSite(r.url);
    if (!site) continue;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const hash = crypto.createHash('sha1').update(r.url).digest('hex').slice(0, 12);
    leads.push({
      id: `news:${artist.id}:${hash}`,
      artist_id: artist.id,
      title: r.title ?? null,
      url: r.url,
      source_site: site,
    });
  }
  return leads;
}
