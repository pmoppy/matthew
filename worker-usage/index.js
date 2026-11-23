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
 * Offer claims (redeeming a wholesale offer with a shelf photo):
 *   POST /claims                 { h, offerId, title, product, saving, store, detect, boxes, photo (base64 jpeg) }
 *   GET  /claims?store=…         header x-login: <login hash>     a store's claims (retailer)
 *   GET  /admin/claims           admin headers                    every claim
 *   POST /admin/claims/<key>     admin headers { status: approved|rejected, reason }
 *   GET  /photo/<id>             header x-login (or admin headers) the claim photo
 * Photos are stored privately in KV (never in the public bucket). One open
 * (pending or approved) claim per offer per store; rejected ones can be resubmitted.
 *
 * Deploy / update: python3 worker-usage/deploy.py
 */
const KEEP_SECONDS = 180 * 24 * 3600;
const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-admin-user, x-admin-pass, x-login',
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

    // ---- offer claims -------------------------------------------------------------------
    const logins = JSON.parse(env.LOGINS || '{}');
    const isAdmin = async () => {
      const user = (req.headers.get('x-admin-user') || '').trim().toLowerCase();
      const admins = (env.ADMINS || '').split(',').filter(Boolean);
      return admins.includes(await sha256(`shelfscan-v1:${user}:${req.headers.get('x-admin-pass') || ''}`));
    };
    // A store's claims in one record: read-after-write is immediate, unlike KV listing.
    const storeDoc = async (store) => JSON.parse((await env.USAGE.get(`claims-store:${store}`)) || '[]');
    const saveDoc = (store, list) => env.USAGE.put(`claims-store:${store}`, JSON.stringify(list.slice(0, 300)));
    const allClaims = async () => {
      const out = [];
      let cursor;
      do {
        const page = await env.USAGE.list({ prefix: 'claim:', cursor, limit: 1000 });
        for (const k of page.keys) if (k.metadata) out.push({ key: k.name, ...k.metadata });
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return out;
    };

    if (req.method === 'POST' && url.pathname === '/claims') {
      let b;
      try {
        b = await req.json();
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const user = logins[b && b.h];
      if (!user) return json({ ok: false, error: 'unknown login' }, 403);
      const store = clip(b.store, 80);
      if (!store || !b.offerId || typeof b.photo !== 'string') return json({ ok: false, error: 'missing store, offer or photo' }, 400);
      if (b.photo.length > 4_000_000) return json({ ok: false, error: 'photo too large' }, 413);
      const doc = await storeDoc(store);
      const open = doc.find((c) => c.offerId === b.offerId && c.status !== 'rejected');
      if (open) return json({ ok: false, error: 'This offer has already been claimed for this store.' }, 409);
      const now = Date.now();
      const id = crypto.randomUUID().slice(0, 12);
      const key = `claim:${String(9e12 - now).padStart(13, '0')}:${id}`;
      const d = b.detect || {};
      const meta = {
        id, u: user, store, at: now, status: 'pending',
        offerId: clip(b.offerId, 60), title: clip(b.title, 90) || '', product: clip(b.product, 90) || '',
        saving: Number(b.saving) || 0,
        found: !!d.found, facings: Number(d.facings) || 0, conf: Math.round((Number(d.confidence) || 0) * 100),
        prev: clip(b.prev, 80) || '',
      };
      const bin = Uint8Array.from(atob(b.photo), (ch) => ch.charCodeAt(0));
      await env.USAGE.put(`photo:${id}`, bin);
      await env.USAGE.put(`boxes:${id}`, JSON.stringify(Array.isArray(b.boxes) ? b.boxes.slice(0, 60) : []));
      await env.USAGE.put(key, '1', { metadata: meta });
      await saveDoc(store, [{ key, ...meta }, ...doc]);
      return json({ ok: true, claim: { key, ...meta } });
    }

    if (req.method === 'GET' && url.pathname === '/claims') {
      if (!logins[req.headers.get('x-login') || '']) return json({ ok: false, error: 'unknown login' }, 403);
      const store = url.searchParams.get('store') || '';
      return json({ ok: true, claims: await storeDoc(store) });
    }

    if (req.method === 'GET' && url.pathname === '/admin/claims') {
      if (!(await isAdmin())) return json({ ok: false, error: 'not an admin login' }, 403);
      return json({ ok: true, claims: await allClaims() });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/admin/claims/')) {
      if (!(await isAdmin())) return json({ ok: false, error: 'not an admin login' }, 403);
      const key = decodeURIComponent(url.pathname.slice('/admin/claims/'.length));
      if (!key.startsWith('claim:')) return json({ ok: false, error: 'claim not found' }, 404);
      const { metadata } = await env.USAGE.getWithMetadata(key);
      if (!metadata) return json({ ok: false, error: 'claim not found' }, 404);
      const b = await req.json().catch(() => ({}));
      if (b.status !== 'approved' && b.status !== 'rejected') return json({ ok: false, error: 'bad status' }, 400);
      const meta = { ...metadata, status: b.status, reason: clip(b.reason, 120) || '', reviewedAt: Date.now() };
      await env.USAGE.put(key, '1', { metadata: meta });
      const doc = await storeDoc(meta.store);
      await saveDoc(meta.store, doc.map((c) => (c.key === key ? { key, ...meta } : c)));
      return json({ ok: true, claim: { key, ...meta } });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/photo/')) {
      if (!logins[req.headers.get('x-login') || ''] && !(await isAdmin())) return json({ ok: false, error: 'forbidden' }, 403);
      const id = url.pathname.slice('/photo/'.length).replace(/[^a-z0-9-]/gi, '');
      const [photo, boxes] = await Promise.all([env.USAGE.get(`photo:${id}`, 'arrayBuffer'), env.USAGE.get(`boxes:${id}`)]);
      if (!photo) return json({ ok: false, error: 'not found' }, 404);
      return new Response(photo, { headers: { 'content-type': 'image/jpeg', 'x-boxes': boxes || '[]', 'access-control-expose-headers': 'x-boxes', ...HEADERS } });
    }

    return json({ ok: true, service: 'ShelfScan usage log' });
  },
};
