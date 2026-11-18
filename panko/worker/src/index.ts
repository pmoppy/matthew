/**
 * Panko server: a tiny proxy so the Anthropic API key never sits on anyone's phone.
 *
 * The app sends normal Claude Messages API requests here. This Worker checks the
 * team access code, swaps in the real API key and streams Anthropic's reply back.
 * Only the Messages endpoints are forwarded.
 *
 * Secrets (wrangler secret put …):
 *   ANTHROPIC_API_KEY   your Anthropic key
 *   PANKO_PASSWORD      the password people type to unlock Panko. Several can be
 *                       given, comma-separated (e.g. one per person), so one can
 *                       be revoked without changing everyone else's.
 * Optional var:
 *   ALLOWED_ORIGIN      e.g. https://pmoppy.github.io (default: any origin)
 */

export interface Env {
  ANTHROPIC_API_KEY: string;
  PANKO_PASSWORD?: string;
  ALLOWED_ORIGIN?: string;
}

const PATHS = new Set(['/v1/messages', '/v1/messages/count_tokens']);
const FORWARD = ['content-type', 'anthropic-version', 'anthropic-beta', 'accept'];

function cors(env: Env, req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || '*',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status: number, message: string, headers: Record<string, string>) {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'panko_error', message } }), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Constant-time string compare. */
function same(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('Panko server is running.', { headers: h });
    if (req.method !== 'POST' || (url.pathname !== '/auth' && !PATHS.has(url.pathname))) return json(404, 'Not found', h);
    if (!env.ANTHROPIC_API_KEY) return json(500, 'The server has no ANTHROPIC_API_KEY set.', h);

    // Every request needs a valid password. No password configured = locked shut.
    const passwords = (env.PANKO_PASSWORD || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!passwords.length) return json(500, 'The server has no PANKO_PASSWORD set.', h);
    const given = req.headers.get('x-panko-access') || '';
    if (!passwords.some((p) => same(given, p))) {
      await sleep(800); // slows down guessing
      return json(403, 'Wrong password.', h);
    }
    if (url.pathname === '/auth') return new Response(JSON.stringify({ ok: true }), { headers: { ...h, 'content-type': 'application/json' } });

    const headers = new Headers({ 'x-api-key': env.ANTHROPIC_API_KEY });
    for (const k of FORWARD) {
      const v = req.headers.get(k);
      if (v) headers.set(k, v);
    }
    const upstream = await fetch(`https://api.anthropic.com${url.pathname}`, { method: 'POST', headers, body: await req.arrayBuffer() });
    const out = new Headers(h);
    for (const k of ['content-type', 'request-id', 'retry-after', 'x-should-retry']) {
      const v = upstream.headers.get(k);
      if (v) out.set(k, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
