import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

export function initDb(databasePath) {
  const resolved = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();

  return db;
}

// Bring older databases up to the current schema. SQLite's CREATE TABLE
// IF NOT EXISTS leaves existing tables untouched, so column additions
// have to be done with ALTER TABLE.
function migrate() {
  const cols = db.prepare("PRAGMA table_info(artists)").all();
  if (!cols.find((c) => c.name === 'discovery_source')) {
    db.exec('ALTER TABLE artists ADD COLUMN discovery_source TEXT');
  }
}

export function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

// ---------- Artists ----------

export function upsertArtist(artist) {
  // followers / popularity can legitimately be null for some Spotify artists
  // (the API simply omits them). We store them as NULL and display "?" in the UI.
  getDb()
    .prepare(`
      INSERT INTO artists (
        id, name, image_url, spotify_url, genres,
        followers, popularity, source, discovery_source,
        added_at, last_refreshed_at
      ) VALUES (
        @id, @name, @image_url, @spotify_url, @genres,
        @followers, @popularity, @source, @discovery_source,
        @added_at, @last_refreshed_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name              = excluded.name,
        image_url         = excluded.image_url,
        spotify_url       = excluded.spotify_url,
        genres            = excluded.genres,
        followers         = excluded.followers,
        popularity        = excluded.popularity,
        last_refreshed_at = excluded.last_refreshed_at
    `)
    .run({
      id: artist.id,
      name: artist.name,
      image_url: artist.image_url ?? null,
      spotify_url: artist.spotify_url ?? null,
      genres: artist.genres ?? '[]',
      followers: artist.followers,
      popularity: artist.popularity,
      source: artist.source ?? 'manual',
      discovery_source: artist.discovery_source ?? null,
      added_at: artist.added_at,
      last_refreshed_at: artist.last_refreshed_at ?? null,
    });
}

export function listArtists({ includeDismissed = false } = {}) {
  const where = includeDismissed ? '' : 'WHERE dismissed = 0';
  return getDb().prepare(`SELECT * FROM artists ${where} ORDER BY added_at DESC`).all();
}

export function getArtist(id) {
  return getDb().prepare('SELECT * FROM artists WHERE id = ?').get(id);
}

export function deleteArtist(id) {
  getDb().prepare('DELETE FROM artists WHERE id = ?').run(id);
}

export function setDismissed(id, dismissed) {
  getDb()
    .prepare('UPDATE artists SET dismissed = ? WHERE id = ?')
    .run(dismissed ? 1 : 0, id);
}

// ---------- Snapshots ----------

export function recordSnapshot({ artist_id, followers, popularity }) {
  if (followers == null || popularity == null) return; // never snapshot bogus values
  getDb()
    .prepare(`
      INSERT INTO artist_snapshots (artist_id, followers, popularity, recorded_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(artist_id, followers, popularity, new Date().toISOString());
}

export function getBaselineSnapshot(artist_id, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return getDb()
    .prepare(`
      SELECT followers, popularity, recorded_at
      FROM artist_snapshots
      WHERE artist_id = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
      LIMIT 1
    `)
    .get(artist_id, since);
}

// ---------- Tours ----------

export function upsertTourDate(tour) {
  getDb()
    .prepare(`
      INSERT INTO tour_dates (
        id, artist_id, event_date, venue_name, city, region, country,
        ticket_url, created_at
      ) VALUES (
        @id, @artist_id, @event_date, @venue_name, @city, @region, @country,
        @ticket_url, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        event_date  = excluded.event_date,
        venue_name  = excluded.venue_name,
        city        = excluded.city,
        region      = excluded.region,
        country     = excluded.country,
        ticket_url  = excluded.ticket_url
    `)
    .run({
      id: tour.id,
      artist_id: tour.artist_id,
      event_date: tour.event_date,
      venue_name: tour.venue_name ?? null,
      city: tour.city ?? null,
      region: tour.region ?? null,
      country: tour.country ?? null,
      ticket_url: tour.ticket_url ?? null,
      created_at: tour.created_at,
    });
}

export function listUpcomingTours({ artist_id } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (artist_id) {
    return getDb()
      .prepare(`
        SELECT t.*, a.name AS artist_name, a.image_url AS artist_image
        FROM tour_dates t
        JOIN artists a ON a.id = t.artist_id
        WHERE t.artist_id = ? AND substr(t.event_date, 1, 10) >= ?
        ORDER BY t.event_date ASC
      `)
      .all(artist_id, today);
  }
  return getDb()
    .prepare(`
      SELECT t.*, a.name AS artist_name, a.image_url AS artist_image
      FROM tour_dates t
      JOIN artists a ON a.id = t.artist_id
      WHERE substr(t.event_date, 1, 10) >= ? AND a.dismissed = 0
      ORDER BY t.event_date ASC
    `)
    .all(today);
}

export function listUnnotifiedTours() {
  return getDb()
    .prepare(`
      SELECT t.*, a.name AS artist_name
      FROM tour_dates t
      JOIN artists a ON a.id = t.artist_id
      WHERE t.notified = 0 AND a.dismissed = 0
      ORDER BY t.artist_id, t.event_date
    `)
    .all();
}

export function markToursNotified(tourIds) {
  if (!tourIds.length) return;
  const placeholders = tourIds.map(() => '?').join(',');
  getDb()
    .prepare(`UPDATE tour_dates SET notified = 1 WHERE id IN (${placeholders})`)
    .run(...tourIds);
}

// ---------- Disabled categories ----------

export function getDisabledCategories() {
  return getDb()
    .prepare('SELECT category FROM disabled_categories')
    .all()
    .map((r) => r.category);
}

export function setCategoryEnabled(category, enabled) {
  if (enabled) {
    getDb().prepare('DELETE FROM disabled_categories WHERE category = ?').run(category);
  } else {
    getDb()
      .prepare('INSERT OR IGNORE INTO disabled_categories (category) VALUES (?)')
      .run(category);
  }
}
