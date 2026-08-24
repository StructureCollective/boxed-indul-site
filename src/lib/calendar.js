// Google Calendar two-way sync.
//
// PUSH: when a custom-order booking is confirmed (deposit paid), we create
// an all-day event on the connected calendar so it shows up alongside the
// admin's personal events.
//
// PULL: a scheduled Worker cron (see scheduled() in index.js) — and a
// manual "Sync now" admin button — call syncBusyDatesFromCalendar(), which
// reads the connected calendar's free/busy info for the next N days and
// upserts blocked_dates rows (source='google_calendar') so busy days on the
// admin's personal calendar block new customer requests automatically.
// Availability is date-level (matching how the booking calendar already
// works), not time-level.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";
// calendar.events + calendar.readonly cover the push/pull sync; openid +
// userinfo.email are needed so /oauth2/v2/userinfo (used to show "connected
// as ___" in the admin panel) actually returns an email.
const SCOPE =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly openid https://www.googleapis.com/auth/userinfo.email";

export function buildGoogleAuthUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on repeat connects
    scope: SCOPE,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(env, code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);
  return data; // { access_token, refresh_token, expires_in, id_token, ... }
}

export async function getConnectedEmail(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

async function refreshAccessToken(env, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Loads the stored connection and returns a fresh access token, or null if
// nothing is connected.
export async function getFreshAccessToken(env) {
  const conn = await env.DB.prepare(
    "SELECT * FROM google_calendar_connection WHERE id = 'default'"
  ).first();
  if (!conn || !conn.refresh_token) return null;
  return { accessToken: await refreshAccessToken(env, conn.refresh_token), connection: conn };
}

export async function createCalendarEvent(env, accessToken, { calendarId = "primary", summary, description, date }) {
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary,
      description,
      start: { date }, // all-day event, YYYY-MM-DD
      end: { date: nextDay(date) },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Calendar event create failed: ${JSON.stringify(data)}`);
  return data; // includes .id
}

export async function deleteCalendarEvent(env, accessToken, { calendarId = "primary", eventId }) {
  await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Pushes a confirmed booking to the connected calendar (no-op if nothing is
// connected). Returns the new event id, or null.
export async function pushBookingToCalendar(env, booking) {
  const fresh = await getFreshAccessToken(env);
  if (!fresh) return null;
  const event = await createCalendarEvent(env, fresh.accessToken, {
    calendarId: fresh.connection.calendar_id || "primary",
    summary: `Boxed Indulgence — ${booking.name} (${booking.guest_count} boxes)`,
    description: `Confirmed order. Location: ${booking.location || "TBD"}. Email: ${booking.email}`,
    date: booking.event_date,
  });
  return event.id;
}

// Pulls free/busy info for the next `daysAhead` days and upserts
// blocked_dates rows sourced from Google Calendar. Removes stale
// google_calendar-sourced blocks that are no longer busy.
export async function syncBusyDatesFromCalendar(env, daysAhead = 120) {
  const fresh = await getFreshAccessToken(env);
  if (!fresh) return { synced: false, reason: "not connected" };

  const timeMin = new Date();
  timeMin.setUTCHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setUTCDate(timeMax.getUTCDate() + daysAhead);

  const res = await fetch(`${CAL_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fresh.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: fresh.connection.calendar_id || "primary" }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google freeBusy query failed: ${JSON.stringify(data)}`);

  const busy = Object.values(data.calendars || {})[0]?.busy || [];
  const busyDates = new Set();
  for (const range of busy) {
    let cur = new Date(range.start.slice(0, 10) + "T00:00:00Z");
    const end = new Date(range.end.slice(0, 10) + "T00:00:00Z");
    while (cur <= end) {
      busyDates.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const existing = await env.DB.prepare(
    "SELECT date FROM blocked_dates WHERE source = 'google_calendar'"
  ).all();
  const existingDates = new Set((existing.results || []).map((r) => r.date));

  const toAdd = [...busyDates].filter((d) => !existingDates.has(d));
  const toRemove = [...existingDates].filter((d) => !busyDates.has(d));

  for (const date of toAdd) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO blocked_dates (date, reason, source) VALUES (?, 'Busy on connected Google Calendar', 'google_calendar')"
    ).bind(date).run();
  }
  for (const date of toRemove) {
    await env.DB.prepare(
      "DELETE FROM blocked_dates WHERE date = ? AND source = 'google_calendar'"
    ).bind(date).run();
  }

  await env.DB.prepare(
    "UPDATE google_calendar_connection SET last_synced_at = ? WHERE id = 'default'"
  ).bind(new Date().toISOString()).run();

  return { synced: true, added: toAdd.length, removed: toRemove.length };
}
