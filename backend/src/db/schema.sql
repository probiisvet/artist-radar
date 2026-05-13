-- Artists known to the system. Single table for both manually-added
-- and auto-discovered artists; `source` distinguishes them.
CREATE TABLE IF NOT EXISTS artists (
  id                TEXT PRIMARY KEY,        -- Spotify artist ID
  name              TEXT NOT NULL,
  image_url         TEXT,
  spotify_url       TEXT,
  genres            TEXT,                    -- JSON array of genre strings
  followers         INTEGER,                 -- nullable on purpose: NULL means "unknown", 0 is a real value
  popularity        INTEGER,                 -- 0-100, same convention as followers
  source            TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'discovered'
  discovery_source  TEXT,                    -- name of playlist that surfaced the artist (if any)
  dismissed         INTEGER NOT NULL DEFAULT 0,     -- 1 = "not interested"
  added_at          TEXT NOT NULL,
  last_refreshed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_artists_dismissed ON artists(dismissed);
CREATE INDEX IF NOT EXISTS idx_artists_source ON artists(source);

-- Daily snapshots used to compute growth rates over time.
CREATE TABLE IF NOT EXISTS artist_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id    TEXT NOT NULL,
  followers    INTEGER NOT NULL,
  popularity   INTEGER NOT NULL,
  recorded_at  TEXT NOT NULL,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_artist_time
  ON artist_snapshots(artist_id, recorded_at);

-- US tour dates pulled from Bandsintown.
CREATE TABLE IF NOT EXISTS tour_dates (
  id           TEXT PRIMARY KEY,            -- Bandsintown event ID
  artist_id    TEXT NOT NULL,
  event_date   TEXT NOT NULL,               -- ISO 8601
  venue_name   TEXT,
  city         TEXT,
  region       TEXT,
  country      TEXT,
  ticket_url   TEXT,
  notified     INTEGER NOT NULL DEFAULT 0,  -- 1 once an alert email has been sent
  created_at   TEXT NOT NULL,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tours_artist_date ON tour_dates(artist_id, event_date);
CREATE INDEX IF NOT EXISTS idx_tours_notified ON tour_dates(notified);

-- Playlist categories the user has explicitly turned off in the UI.
-- The full list of categories comes from config/discoveryPlaylists.js;
-- absence of a row here means the category is enabled (default).
CREATE TABLE IF NOT EXISTS disabled_categories (
  category TEXT PRIMARY KEY
);
