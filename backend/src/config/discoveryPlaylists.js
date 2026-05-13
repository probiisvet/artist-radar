// Curated list of Spotify playlists used for emerging-artist discovery.
//
// Each entry: { id, name, category }
//   - id:       the playlist ID from the open.spotify.com URL
//               (e.g. open.spotify.com/playlist/<THIS_PART>)
//   - name:     display name (used in emails / dashboard / discovery_source)
//   - category: groups playlists in the UI; the user can disable a whole
//               category in one click via the Categories panel.
//
// CAVEAT: Spotify periodically restricts third-party access to its own
// editorial / algorithmic playlists. Some IDs below may return 404 for new
// developer apps — the discovery loop logs and skips those gracefully, so
// it's safe to leave them in the list. If a playlist consistently fails for
// you, replace its ID with one of your own (any public playlist works) or
// delete the entry.
//
// To add a playlist: open it on open.spotify.com, copy the URL, take the
// part after /playlist/ (and before the ? if present), and add a new entry.

export const DISCOVERY_PLAYLISTS = [
  // ---------- New Music Friday ----------
  { id: '37i9dQZF1DX4JAvHpjipBk', name: 'New Music Friday',           category: 'New Music Friday' },
  { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'New Music Friday Hip-Hop',   category: 'New Music Friday' },

  // ---------- Fresh Finds (Spotify's flagship discovery family) ----------
  { id: '37i9dQZF1DWWBHeXOYZf74', name: 'Fresh Finds',                category: 'Fresh Finds' },
  { id: '37i9dQZF1DXa0LhGGSXq2N', name: 'Fresh Finds Pop',            category: 'Fresh Finds' },
  { id: '37i9dQZF1DX7Ku6cgJPhh5', name: 'Fresh Finds Indie',          category: 'Fresh Finds' },

  // ---------- Pop ----------
  { id: '37i9dQZF1DWUa8ZRTfalHk', name: 'Pop Rising',                 category: 'Pop' },
  { id: '37i9dQZF1DXcBWIGoYBM5M', name: "Today's Top Hits",           category: 'Pop' },

  // ---------- Indie ----------
  { id: '37i9dQZF1DXcRXFNfZr7Tp', name: 'Lorem',                      category: 'Indie' },
  { id: '37i9dQZF1DWWEcRhUVtL8n', name: 'Indie Pop',                  category: 'Indie' },
  { id: '37i9dQZF1DX2sUQwD7tbmL', name: 'Bedroom Pop',                category: 'Indie' },

  // ---------- Hip-Hop / Rap ----------
  { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'RapCaviar',                  category: 'Hip-Hop / Rap' },
  { id: '37i9dQZF1DX2RxBh64BHjQ', name: 'Most Necessary',             category: 'Hip-Hop / Rap' },
  { id: '37i9dQZF1DWY4xHQp97fN6', name: 'Get Turnt',                  category: 'Hip-Hop / Rap' },

  // ---------- R&B ----------
  { id: '37i9dQZF1DX4SBhb3fqCJd', name: 'Are & Be',                   category: 'R&B' },
  { id: '37i9dQZF1DWXbLOeOIhbc5', name: 'R&B Rising',                 category: 'R&B' },

  // ---------- Electronic ----------
  { id: '37i9dQZF1DX4dyzvuaRJ0n', name: 'mint',                       category: 'Electronic' },
  { id: '37i9dQZF1DX6J5NfMJS675', name: 'Dance Rising',               category: 'Electronic' },

  // ---------- Country ----------
  { id: '37i9dQZF1DX1lVhptIYRda', name: 'Hot Country',                category: 'Country' },

  // ---------- Rock / Alt ----------
  { id: '37i9dQZF1DXcF6B6QPhFDv', name: 'Rock This',                  category: 'Rock' },
  { id: '37i9dQZF1DX9wC1KY45plY', name: 'Alternative Beats',          category: 'Rock' },

  // ---------- Latin ----------
  { id: '37i9dQZF1DX10zKzsJ2jva', name: 'Viva Latino',                category: 'Latin' },

  // ---------- Viral / TikTok ----------
  { id: '37i9dQZEVXbKuaTI1Z1Afx', name: 'Viral 50 — USA',             category: 'Viral' },
  { id: '37i9dQZEVXbLiRSasKsNU9', name: 'Viral 50 — Global',          category: 'Viral' },
  { id: '37i9dQZF1DX2L0iB23Enbq', name: 'Viral Hits',                 category: 'Viral' },
];

// Distinct categories in the order they first appear above.
export function listCategories() {
  const seen = new Set();
  const out = [];
  for (const p of DISCOVERY_PLAYLISTS) {
    if (!seen.has(p.category)) {
      seen.add(p.category);
      out.push(p.category);
    }
  }
  return out;
}
