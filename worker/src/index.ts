/**
 * ShelfScan catalogue Worker.
 *
 * Sits in front of an R2 bucket laid out as:
 *
 *   <Product name>/<any>.jpg      one folder per product, 1+ photos each
 *   sales.csv                     optional: product,units (or rank)
 *   models/detector.onnx          optional: trained product detector
 *
 * and exposes it to the app with CORS:
 *
 *   GET /manifest.json   product list + image paths (+ sales / detector if present)
 *   GET /file/<key>      any object from the bucket
 *   GET /media/<key>     media hub (media/media.json + files)
 */

interface R2Object {
  key: string;
  size: number;
  httpEtag: string;
  writeHttpMetadata(h: Headers): void;
}
interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}
interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}
interface R2Bucket {
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

export interface Env {
  BUCKET: R2Bucket;
  /** Optional folder inside the bucket that holds the catalogue, e.g. "catalogue/". */
  PREFIX?: string;
  /** Optional: restrict CORS to your app's origin, e.g. "https://shelfscan.pages.dev". */
  ALLOWED_ORIGIN?: string;
}

const IMG = /\.(jpe?g|png|webp|avif)$/i;

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Length, ETag',
    // Lets the app load these while cross-origin isolated (multi-threaded WASM).
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function manifest(env: Env): Promise<Response> {
  const prefix = env.PREFIX ?? '';
  const objects = await listAll(env.BUCKET, prefix);
  const products = new Map<string, string[]>();
  let sales: string | null = null;
  let detector: string | null = null;
  const indexKeys: string[] = [];
  for (const o of objects) {
    const rel = o.key.slice(prefix.length);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 1 && /^sales\.csv$/i.test(parts[0])) sales = rel;
    if (rel === 'models/detector.onnx') detector = rel;
    if (parts.length === 1 && /^index-[\w-]+\.json$/.test(parts[0])) indexKeys.push(o.key);
    if (parts.length < 2 || !IMG.test(rel) || o.size === 0) continue;
    if (parts[0] === 'models' || parts.some((p) => p.startsWith('_') || p.startsWith('.'))) continue;
    // Product = the folder the image sits in (allows e.g. Brand/Product/img.jpg).
    const product = parts[parts.length - 2];
    const list = products.get(product) ?? [];
    list.push(rel);
    products.set(product, list);
  }
  // Pre-computed fingerprints (scripts/build_index.py) let phones skip downloading every photo.
  const indexes: Record<string, unknown> = {};
  for (const key of indexKeys) {
    const obj = await env.BUCKET.get(key);
    if (!obj) continue;
    try {
      const info = JSON.parse(await new Response(obj.body).text());
      indexes[key.slice(prefix.length).replace(/^index-|\.json$/g, '')] = info;
    } catch {
      /* ignore malformed index */
    }
  }
  // Version changes whenever photos or indexes change, so phones know to re-sync.
  let h = 0;
  for (const o of objects) for (const ch of `${o.key}:${o.size}:${o.httpEtag}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  const body = {
    generated: `v${(h >>> 0).toString(16)}`,
    indexes,
    products: [...products.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, images]) => ({ name, images: images.sort() })),
    sales,
    detector,
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...cors(env) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors(env) });

    if (url.pathname === '/manifest.json') return manifest(env);

    // Media hub: <bucket>/media/media.json plus the planograms / videos it lists.
    const filePath = url.pathname.startsWith('/media/') ? `/file${url.pathname}` : url.pathname;
    if (filePath.startsWith('/file/')) {
      const rel = filePath
        .slice('/file/'.length)
        .split('/')
        .map((s) => decodeURIComponent(s))
        .join('/');
      if (!rel || rel.includes('..')) return new Response('Bad path', { status: 400, headers: cors(env) });
      const obj = await env.BUCKET.get((env.PREFIX ?? '') + rel);
      if (!obj) return new Response('Not found', { status: 404, headers: cors(env) });
      const h = new Headers(cors(env));
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('content-length', String(obj.size));
      // Product photos and models change rarely; CSV should refresh quickly.
      h.set('cache-control', /\.(csv|json)$/i.test(rel) ? 'public, max-age=60' : 'public, max-age=86400');
      if (!h.has('content-type')) h.set('content-type', 'application/octet-stream');
      return new Response(req.method === 'HEAD' ? null : obj.body, { headers: h });
    }

    return new Response('ShelfScan catalogue. Try /manifest.json', { headers: { 'content-type': 'text/plain', ...cors(env) } });
  },
};
