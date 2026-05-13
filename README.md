# Artist Radar

A self-hosted full-stack app that helps you discover emerging music artists
*before* they blow up — and emails you the moment any tracked artist
announces US tour dates.

- **Backend:** Node.js + Express + SQLite (Node's built-in `node:sqlite`)
- **Frontend:** React + Vite
- **Data:** Spotify Web API (search, /artists, /playlists/{id}/tracks) and the Bandsintown public API
- **Alerts:** Nodemailer (any SMTP server)
- **Scheduling:** node-cron, runs once every 24h by default

## Features

- 🎯 **Playlist-based discovery** — pulls tracks from a curated list of Spotify discovery playlists (Fresh Finds, Pop Rising, Lorem, RapCaviar, Viral 50, New Music Friday, etc.) and auto-tracks any artist under 500k followers (configurable).
- 🔄 **Per-artist Refresh button** — re-fetch a single artist's stats on demand, no full job needed.
- 📈 **Growth tracking** — daily snapshots of follower count and Spotify popularity, with 30-day deltas surfaced in the dashboard.
- 🎟 **US tour alerts** — Bandsintown integration with strict `country == "United States"` filtering.
- 📬 **Email** — one rolled-up email per refresh cycle when new US dates appear.
- 🎛 **Category toggles** — enable/disable whole playlist categories (Pop, Indie, Hip-Hop / Rap, Country, etc.) from the UI.
- ✋ **Manual controls** — search Spotify and add any artist by hand; mark "not interested"; restore later.
- 🛡 **Resilient discovery** — if Spotify returns 404 for a playlist, it's logged and skipped, never aborts the rest of the refresh.

## Two important honesty notes

### 1. Spotify deprecated several endpoints in November 2024

The following endpoints return **404 for new developer apps** and are **not used** by Artist Radar:
- `/v1/recommendations`
- `/v1/audio-features` and `/v1/audio-analysis`
- `/v1/artists/{id}/related-artists`
- `/v1/browse/featured-playlists` and `/v1/browse/categories/{id}/playlists`
- 30-second preview URLs

Discovery is therefore **playlist-based**, not recommendations-based.

### 2. "Monthly listeners" is not in the official API

Spotify's Web API doesn't expose monthly listener counts (those only appear on the public web player). Artist Radar uses Spotify's two official emerging-artist signals:
- `followers.total` — absolute follower count
- `popularity` — 0–100 score, weighted by recent stream activity

Both values are snapshotted every 24 hours and the 30-day delta is shown on each artist card. The **popularity score** is the better leading indicator for "about to blow up" anyway.

---

## Project structure

```
artist-radar/
├── backend/
│   ├── package.json
│   └── src/
│       ├── server.js             # Express entry; starts cron on boot
│       ├── db/
│       │   ├── schema.sql
│       │   └── database.js       # node:sqlite access layer + JS migrations
│       ├── config/
│       │   └── discoveryPlaylists.js   # 🟢 EDIT ME to curate discovery playlists
│       ├── services/
│       │   ├── spotify.js        # Auth + search + /artists + /playlists/{id}/tracks
│       │   ├── discovery.js      # Playlist fan-out + emerging filter
│       │   ├── bandsintown.js    # US-only tour-date fetcher
│       │   └── email.js          # Nodemailer rolled-up alerts
│       ├── routes/
│       │   ├── artists.js        # CRUD, search, dismiss, /:id/refresh
│       │   ├── tours.js
│       │   └── categories.js     # Enable/disable playlist categories
│       └── jobs/
│           ├── refresh.js        # The 24h cycle + refreshOneArtist()
│           ├── scheduler.js      # node-cron wrapper
│           └── runOnce.js        # `npm run refresh` CLI
├── frontend/
│   ├── package.json
│   ├── vite.config.js            # proxies /api -> :4000
│   ├── index.html
│   └── src/
│       ├── main.jsx, App.jsx, api.js, styles.css
│       └── components/
│           ├── AddArtist.jsx
│           ├── ArtistList.jsx
│           ├── ArtistCard.jsx    # includes per-artist Refresh button
│           ├── Categories.jsx    # toggle UI for discovery categories
│           └── TourList.jsx
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Prerequisites

**Node.js 22.5+** is required — Artist Radar uses Node's built-in `node:sqlite` module, which means **no native compilation, no Visual Studio Build Tools, no Python**. The npm scripts pass `--experimental-sqlite` so it works on every version that ships the module.

Check your version:
```bash
node --version   # must be >= v22.5
```

---

## Step-by-step setup

### 1. Install

```bash
cd "artist-radar"
npm run install:all
```

### 2. Get your API keys

#### a. Spotify (required)

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. Click **Create app**.
3. Any name + description; redirect URI can be `http://localhost:4000/callback` (unused by this app).
4. Agree to the developer terms → **Save**.
5. Open the app → **Settings**.
6. Copy **Client ID** → `SPOTIFY_CLIENT_ID`.
7. Click **View client secret** → copy → `SPOTIFY_CLIENT_SECRET`.

> No user authorization is needed — Artist Radar uses the **Client Credentials** flow which only sees public catalog data.

#### b. Bandsintown (required, no signup)

The public API needs only an arbitrary `app_id`. Pick any unique string (`artist-radar` is the default). Reference: <https://artists.bandsintown.com/support/public-api>.

#### c. Email / SMTP (optional)

The app works fine without email — the dashboard still shows tour dates. To get email alerts, see the section in `.env.example`. Quick options:

- **Gmail:** enable 2-Step Verification, then create an app password at <https://myaccount.google.com/apppasswords>.
- **SendGrid:** API key with `SMTP_USER=apikey`.
- **Anything else:** any SMTP server works.

### 3. Configure `.env`

```bash
cp .env.example .env
# fill in the values you collected above
```

### 4. Run it

```bash
npm run dev
```

This starts:
- **Backend** on <http://localhost:4000> (also boots the cron job)
- **Frontend** on <http://localhost:5173>

Open <http://localhost:5173>.

### 5. First refresh

The cron only fires once a day (default `0 9 * * *`). To populate the dashboard immediately, click **Run refresh now** in the header.

The first run will:

1. Refresh stats for any artists you've manually added.
2. Pull tracks from every enabled discovery playlist; collect unique artist IDs; batch-fetch their followers/popularity; auto-track everyone under `MAX_FOLLOWERS`.
3. Take an initial snapshot for every artist (so growth deltas only show up after the *second* refresh — that's by design).
4. Pull US-only tour dates from Bandsintown.
5. Email the rolled-up list of any *new* US dates.

> **Note:** Spotify-owned editorial playlists may return 404 for new developer apps. The discovery loop logs those and continues. If you want a guaranteed-working source, replace any failing entry in `backend/src/config/discoveryPlaylists.js` with a public user-created playlist — paste any `open.spotify.com/playlist/<ID>` URL and use the `<ID>` portion.

### Curating your discovery playlists

Open **`backend/src/config/discoveryPlaylists.js`** and add, remove, or reclassify entries. The Categories tab in the UI lets you toggle whole categories off without editing the file.

The default list seeds:
**New Music Friday · Fresh Finds · Pop · Indie · Hip-Hop / Rap · R&B · Electronic · Country · Rock · Latin · Viral**

---

## Useful commands

```bash
npm run install:all          # install all three workspaces
npm run dev                  # backend + frontend together
npm run dev:backend
npm run dev:frontend
npm run refresh --prefix backend   # one-shot refresh from the CLI (no server)
npm run build                # production frontend build
npm start                    # production backend
```

## API surface

```
GET    /api/health
GET    /api/artists?include_dismissed=true
GET    /api/artists/search?q=<query>
POST   /api/artists                       { "id": "<spotify_artist_id>" }
POST   /api/artists/:id/refresh           # re-fetch one artist
PATCH  /api/artists/:id                   { "dismissed": true|false }
DELETE /api/artists/:id
GET    /api/tours
GET    /api/tours?artist_id=<id>
GET    /api/categories
PATCH  /api/categories/:category          { "enabled": true|false }
POST   /api/refresh                       { "skipDiscovery": true|false }
```

## Troubleshooting

- **`Spotify auth failed: 400 invalid_client`** — Client ID/Secret are wrong, or there's whitespace in your `.env`. Re-copy from the Spotify dashboard.
- **`Spotify API 404 on /v1/recommendations…`** — should never happen; that endpoint is no longer used.
- **`Spotify API 404 on /v1/playlists/<id>/tracks`** — that specific playlist isn't accessible to your app. The discovery loop logs it and moves on. Replace the ID in `discoveryPlaylists.js` with any public user-created playlist if you want guaranteed access.
- **`SyntaxError: ... node:sqlite`** — your Node is older than 22.5. Update Node.
- **`bad option: --experimental-sqlite`** — your Node is *much* newer and the flag was removed. Edit `backend/package.json` and drop the flag from the `start`/`dev`/`refresh` scripts.
- **Dashboard shows 0 followers / popularity** — should now never happen; the backend refuses to write `null` and logs the full Spotify response body. Check the server logs.
- **No tour dates show up** — Bandsintown only has shows for artists who've claimed their page. Try a popular tracked artist first to confirm the integration.
- **No email arrives** — the server logs `[email] SMTP not configured` if vars are missing, or prints the SMTP error if auth fails. Gmail requires an **app password**, not your regular password.
- **Growth deltas are empty** — at least two snapshots are needed; deltas appear on the *second* refresh.

## License

MIT — do whatever you want.
