/**
 * ShelfScan usage log (Cloudflare Worker + KV).
 *
 *   POST /event   { h, type, detail?, app?, device?, at? }   from the app
 *   GET  /events  headers x-admin-user / x-admin-pass        for the admin screen
 *
 * Only signed-in testers can log: `h` must be one of the login hashes in the
 * LOGINS binding ({ hash: username }), and the username is taken from there,
 * never from the request. Reading the log needs an admin account's password
 * (checked against ADMINS, a list of login hashes). Events are kept 180 days.
 * Each event is stored as KV key metadata, so one list call returns the log.
 *
 * Deploy / update: python3 worker-usage/deploy.py
 */
const KEEP_SECONDS = 180 * 24 * 3600;
const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-admin-user, x-admin-pass',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...HEADERS } });
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

    if (req.method === 'POST' && url.pathname === '/event') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const logins = JSON.parse(env.LOGINS || '{}');
      const user = logins[body && body.h];
      if (!user) return json({ ok: false, error: 'unknown login' }, 403);
      const now = Date.now();
      // Offline events are queued on the phone: keep their own time if it's plausible.
      const at = typeof body.at === 'number' && body.at < now + 60e3 && body.at > now - 30 * 864e5 ? body.at : now;
      const meta = {
        u: user,
        t: clip(body.type, 40) || 'event',
        d: clip(body.detail, 500) || '',
        a: clip(body.app, 20) || '',
        v: clip(body.device, 60) || '',
        at,
      };
      // Inverted time so a plain KV list returns the newest first.
      const key = `ev:${String(9e12 - at).padStart(13, '0')}:${crypto.randomUUID().slice(0, 8)}`;
      await env.USAGE.put(key, '1', { metadata: meta, expirationTtl: KEEP_SECONDS });
      return json({ ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const user = (req.headers.get('x-admin-user') || '').trim().toLowerCase();
      const pass = req.headers.get('x-admin-pass') || '';
      const admins = (env.ADMINS || '').split(',').filter(Boolean);
      if (!admins.includes(await sha256(`shelfscan-v1:${user}:${pass}`))) return json({ ok: false, error: 'not an admin login' }, 403);
      const want = Math.min(Number(url.searchParams.get('limit')) || 1000, 5000);
      const events = [];
      let cursor;
      do {
        const page = await env.USAGE.list({ prefix: 'ev:', cursor, limit: 1000 });
        for (const k of page.keys) if (k.metadata) events.push(k.metadata);
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor && events.length < want);
      return json({ ok: true, events: events.slice(0, want) });
    }

    return json({ ok: true, service: 'ShelfScan usage log' });
  },
};
