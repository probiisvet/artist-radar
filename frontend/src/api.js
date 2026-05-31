// Thin fetch wrapper. Vite proxies /api -> http://localhost:4000.

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  listArtists: (includeDismissed = false) =>
    request(`/artists${includeDismissed ? '?include_dismissed=true' : ''}`),

  searchArtists: (query) =>
    request(`/artists/search?q=${encodeURIComponent(query)}`),

  addArtist: (id) =>
    request('/artists', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  removeArtist: (id) =>
    request(`/artists/${id}`, { method: 'DELETE' }),

  setDismissed: (id, dismissed) =>
    request(`/artists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ dismissed }),
    }),

  refreshArtist: (id) =>
    request(`/artists/${id}/refresh`, { method: 'POST' }),

  listTours: () => request('/tours'),

  refresh: (skipDiscovery = false) =>
    request('/refresh', {
      method: 'POST',
      body: JSON.stringify({ skipDiscovery }),
    }),

  // Run only selected phases. `phases` is { artists, discovery, tours }.
  refreshPhases: (phases) =>
    request('/refresh', {
      method: 'POST',
      body: JSON.stringify({ phases }),
    }),

  listCategories: () => request('/categories'),

  setCategoryEnabled: (category, enabled) =>
    request(`/categories/${encodeURIComponent(category)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
};
