// Tour "news" discovery via the Google Programmable Search (Custom Search JSON)
// API. Docs: https://developers.google.com/custom-search/v1/overview
//
// Why this and not Bandsintown / Ticketmaster / Brave:
//   - Bandsintown blocks third-party app_ids (artists only)
//   - Ticketmaster needs a developer key the user can't create
//   - Brave's free tier needs a credit card and only covers ~1k req/mo
// Google Custom Search gives 100 queries/DAY truly free, no card required.
//
// We web-search each tracked artist and surface links from known ticketing /
// tour sites, so the user gets an alert to investigate when an artist tours.

import crypto from 'node:crypto';

const CSE_BASE = 'https://www.googleapis.com/customsearch/v1';

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

function creds() {
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) throw new Error('GOOGLE_API_KEY and GOOGLE_CSE_ID not set');
  return { key, cx };
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
  const { key, cx } = creds();
  const query = `${artist.name} tour tickets concert`;
  const url =
    `${CSE_BASE}?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(query)}&num=10&gl=us`;

  const res = await fetch(url);
  if (res.status === 429) throw new Error('Google Search daily quota exceeded (429)');
  if (!res.ok) throw new Error(`Google Search ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const results = data.items ?? [];

  const leads = [];
  const seen = new Set();
  for (const r of results) {
    const link = r.link;
    if (!link) continue;
    const site = matchedSite(link);
    if (!site) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    const hash = crypto.createHash('sha1').update(link).digest('hex').slice(0, 12);
    leads.push({
      id: `news:${artist.id}:${hash}`,
      artist_id: artist.id,
      title: r.title ?? null,
      url: link,
      source_site: site,
    });
  }
  return leads;
}
