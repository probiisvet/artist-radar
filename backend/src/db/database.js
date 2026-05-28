import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client;

export async function initDb() {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:./data/radar.db';
  const authToken = process.env.TURSO_AUTH_TOKEN ?? undefined;

  // Ensure local data directory exists for file-based databases
  if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '');
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }

  client = createClient(authToken ? { url, authToken } : { url });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await client.executeMultiple(schema);

  await migrate();
  console.log('[db] ready:', url.startsWith('file:') ? 'local file' : 'turso cloud');
}

async function migrate() {
  const result = await client.execute('PRAGMA table_info(artists)');
  if (!result.rows.find((r) => r.name === 'discovery_source')) {
    await client.execute('ALTER TABLE artists ADD COLUMN discovery_source TEXT');
  }
}

// ---------- Artists ----------

export async function upsertArtist(artist) {
  await client.execute({
    sql: `
      INSERT INTO artists (
        id, name, image_url, spotify_url, genres,
        followers, popularity, source, discovery_source,
        added_at, last_refreshed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name              = excluded.name,
        image_url         = excluded.image_url,
        spotify_url       = excluded.spotify_url,
        genres            = excluded.genres,
        followers         = excluded.followers,
        popularity        = excluded.popularity,
        last_refreshed_at = excluded.last_refreshed_at
    `,
    args: [
      artist.id,
      artist.name,
      artist.image_url ?? null,
      artist.spotify_url ?? null,
      artist.genres ?? '[]',
      artist.followers ?? null,
      artist.popularity ?? null,
      artist.source ?? 'manual',
      artist.discovery_source ?? null,
      artist.added_at,
      artist.last_refreshed_at ?? null,
    ],
  });
}

export async function listArtists({ includeDismissed = false } = {}) {
  const sql = includeDismissed
    ? 'SELECT * FROM artists ORDER BY added_at DESC'
    : 'SELECT * FROM artists WHERE dismissed = 0 ORDER BY added_at DESC';
  const result = await client.execute(sql);
  return result.rows;
}

export async function getArtist(id) {
  const result = await client.execute({
    sql: 'SELECT * FROM artists WHERE id = ?',
    args: [id],
  });
  return result.rows[0] ?? null;
}

export async function deleteArtist(id) {
  await client.execute({ sql: 'DELETE FROM artists WHERE id = ?', args: [id] });
}

export async function setDismissed(id, dismissed) {
  await client.execute({
    sql: 'UPDATE artists SET dismissed = ? WHERE id = ?',
    args: [dismissed ? 1 : 0, id],
  });
}

// ---------- Snapshots ----------

export async function recordSnapshot({ artist_id, followers, popularity }) {
  if (followers == null || popularity == null) return;
  await client.execute({
    sql: `INSERT INTO artist_snapshots (artist_id, followers, popularity, recorded_at)
          VALUES (?, ?, ?, ?)`,
    args: [artist_id, followers, popularity, new Date().toISOString()],
  });
}

export async function getBaselineSnapshot(artist_id, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT followers, popularity, recorded_at
          FROM artist_snapshots
          WHERE artist_id = ? AND recorded_at >= ?
          ORDER BY recorded_at ASC
          LIMIT 1`,
    args: [artist_id, since],
  });
  return result.rows[0] ?? null;
}

// ---------- Tours ----------

export async function upsertTourDate(tour) {
  await client.execute({
    sql: `
      INSERT INTO tour_dates (
        id, artist_id, event_date, venue_name, city, region, country,
        ticket_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_date  = excluded.event_date,
        venue_name  = excluded.venue_name,
        city        = excluded.city,
        region      = excluded.region,
        country     = excluded.country,
        ticket_url  = excluded.ticket_url
    `,
    args: [
      tour.id,
      tour.artist_id,
      tour.event_date,
      tour.venue_name ?? null,
      tour.city ?? null,
      tour.region ?? null,
      tour.country ?? null,
      tour.ticket_url ?? null,
      tour.created_at,
    ],
  });
}

export async function listUpcomingTours({ artist_id } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (artist_id) {
    const result = await client.execute({
      sql: `SELECT t.*, a.name AS artist_name, a.image_url AS artist_image
            FROM tour_dates t
            JOIN artists a ON a.id = t.artist_id
            WHERE t.artist_id = ? AND substr(t.event_date, 1, 10) >= ?
            ORDER BY t.event_date ASC`,
      args: [artist_id, today],
    });
    return result.rows;
  }
  const result = await client.execute({
    sql: `SELECT t.*, a.name AS artist_name, a.image_url AS artist_image
          FROM tour_dates t
          JOIN artists a ON a.id = t.artist_id
          WHERE substr(t.event_date, 1, 10) >= ? AND a.dismissed = 0
          ORDER BY t.event_date ASC`,
    args: [today],
  });
  return result.rows;
}

export async function listUnnotifiedTours() {
  const result = await client.execute(`
    SELECT t.*, a.name AS artist_name
    FROM tour_dates t
    JOIN artists a ON a.id = t.artist_id
    WHERE t.notified = 0 AND a.dismissed = 0
    ORDER BY t.artist_id, t.event_date
  `);
  return result.rows;
}

export async function markToursNotified(tourIds) {
  if (!tourIds.length) return;
  const placeholders = tourIds.map(() => '?').join(',');
  await client.execute({
    sql: `UPDATE tour_dates SET notified = 1 WHERE id IN (${placeholders})`,
    args: tourIds,
  });
}

// ---------- Disabled categories ----------

export async function getDisabledCategories() {
  const result = await client.execute('SELECT category FROM disabled_categories');
  return result.rows.map((r) => r.category);
}

export async function setCategoryEnabled(category, enabled) {
  if (enabled) {
    await client.execute({
      sql: 'DELETE FROM disabled_categories WHERE category = ?',
      args: [category],
    });
  } else {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO disabled_categories (category) VALUES (?)',
      args: [category],
    });
  }
}
