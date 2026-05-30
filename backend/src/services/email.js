import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // email disabled
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function formatEventDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function buildEmailBody(toursByArtist) {
  const lines = [];
  const html = ['<h2>New US tour announcements</h2>'];

  for (const [artistName, tours] of toursByArtist) {
    lines.push(`\n${artistName}`);
    lines.push('-'.repeat(artistName.length));
    html.push(`<h3 style="margin-bottom:4px;">${escapeHtml(artistName)}</h3><ul>`);
    for (const t of tours) {
      const where = [t.city, t.region].filter(Boolean).join(', ');
      const when = formatEventDate(t.event_date);
      const venue = t.venue_name ? ` @ ${t.venue_name}` : '';
      const link = t.ticket_url ? ` — Tickets: ${t.ticket_url}` : '';
      lines.push(`  • ${when} — ${where}${venue}${link}`);

      const linkHtml = t.ticket_url
        ? ` — <a href="${escapeHtml(t.ticket_url)}">Tickets</a>`
        : '';
      html.push(
        `<li><strong>${escapeHtml(when)}</strong> — ${escapeHtml(where)}${escapeHtml(venue)}${linkHtml}</li>`,
      );
    }
    html.push('</ul>');
  }

  return { text: lines.join('\n').trim(), html: html.join('') };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// `tours` is an array of tour rows joined with artist_name.
// Returns the list of tour IDs that were successfully notified.
export async function sendTourAlertEmail(tours) {
  if (!tours.length) return [];

  const t = getTransporter();
  if (!t) {
    console.warn('[email] SMTP not configured – skipping email; tours will remain unnotified.');
    return [];
  }
  const to = process.env.EMAIL_TO;
  if (!to) {
    console.warn('[email] EMAIL_TO not set – skipping email.');
    return [];
  }

  const grouped = new Map();
  for (const tour of tours) {
    if (!grouped.has(tour.artist_name)) grouped.set(tour.artist_name, []);
    grouped.get(tour.artist_name).push(tour);
  }

  const { text, html } = buildEmailBody(grouped);
  const subject =
    grouped.size === 1
      ? `🎤 ${[...grouped.keys()][0]} announced US tour dates`
      : `🎤 ${grouped.size} tracked artists announced US tour dates`;

  await t.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });

  return tours.map((x) => x.id);
}

// `leads` is an array of tour_leads rows joined with artist_name.
// These are web-search hits (links), not exact dates. Returns notified IDs.
export async function sendTourLeadEmail(leads) {
  if (!leads.length) return [];

  const t = getTransporter();
  if (!t) {
    console.warn('[email] SMTP not configured – skipping email; leads remain unnotified.');
    return [];
  }
  const to = process.env.EMAIL_TO;
  if (!to) {
    console.warn('[email] EMAIL_TO not set – skipping email.');
    return [];
  }

  const grouped = new Map();
  for (const lead of leads) {
    if (!grouped.has(lead.artist_name)) grouped.set(lead.artist_name, []);
    grouped.get(lead.artist_name).push(lead);
  }

  const lines = ['Possible US tour activity for artists you track:\n'];
  const html = ['<h2>Possible US tour activity</h2>', '<p>Links found via web search — click to check details &amp; dates:</p>'];

  for (const [artistName, items] of grouped) {
    lines.push(`\n${artistName}`);
    lines.push('-'.repeat(artistName.length));
    html.push(`<h3 style="margin-bottom:4px;">${escapeHtml(artistName)}</h3><ul>`);
    for (const it of items) {
      const label = it.title || it.url;
      lines.push(`  • ${label}\n    ${it.url} (${it.source_site ?? ''})`);
      html.push(
        `<li><a href="${escapeHtml(it.url)}">${escapeHtml(label)}</a> <span style="color:#888;">(${escapeHtml(it.source_site ?? '')})</span></li>`,
      );
    }
    html.push('</ul>');
  }

  const subject =
    grouped.size === 1
      ? `🎤 Possible tour: ${[...grouped.keys()][0]}`
      : `🎤 Possible tours for ${grouped.size} tracked artists`;

  await t.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text: lines.join('\n').trim(),
    html: html.join(''),
  });

  return leads.map((x) => x.id);
}
