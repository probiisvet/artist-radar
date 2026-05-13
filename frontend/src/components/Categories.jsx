import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { categories } = await api.listCategories();
        if (!cancelled) setCategories(categories);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (category, enabled) => {
    setPending((p) => new Set(p).add(category));
    setError(null);
    try {
      await api.setCategoryEnabled(category, enabled);
      setCategories((cats) =>
        cats.map((c) => (c.category === category ? { ...c, enabled } : c)),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(category);
        return next;
      });
    }
  };

  if (loading) return <p className="muted">Loading categories…</p>;

  return (
    <section className="categories">
      <p className="muted">
        Toggle which playlist categories the discovery scan pulls from.
        Disabled categories are skipped on the next refresh.
      </p>
      {error && <div className="banner error">{error}</div>}
      <ul className="category-list">
        {categories.map((c) => (
          <li key={c.category} className={`category ${c.enabled ? 'on' : 'off'}`}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={c.enabled}
                disabled={pending.has(c.category)}
                onChange={(e) => toggle(c.category, e.target.checked)}
              />
              <span className="slider" />
            </label>
            <div className="category-body">
              <div className="category-name">{c.category}</div>
              {c.description && (
                <div className="category-description">{c.description}</div>
              )}
              <div className="category-playlists muted">
                {c.sources.join(' · ')}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
