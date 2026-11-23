import { analyseShelf } from './analyse';
import { signedInHash } from './auth';
import type { CatalogState } from './catalog';
import type { Coupon } from './coupons';
import { listScans } from './history';
import { normName, type SalesInfo } from './sales';
import type { Settings } from './types';
import { USAGE_URL } from './usage';

/**
 * Redeeming an offer: the retailer photographs the shelf, the app checks on the
 * phone whether the offer's product is there, and the claim (photo + result)
 * goes to the ShelfScan claims service on Cloudflare for the admin to approve.
 * Approved claims make up the store's balance.
 */
export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface Claim {
  key: string;
  id: string;
  /** Who sent it (login name). */
  u: string;
  store: string;
  at: number;
  status: ClaimStatus;
  offerId: string;
  title: string;
  product: string;
  saving: number;
  found: boolean;
  facings: number;
  /** Detection confidence, 0-100. */
  conf: number;
  /** Note on the store's previous scan, e.g. "12 Nov: not on shelf". */
  prev: string;
  reason?: string;
  reviewedAt?: number;
}

export interface Detection {
  found: boolean;
  facings: number;
  confidence: number;
  /** Boxes [x1, y1, x2, y2] of the product in the photo's pixels. */
  boxes: number[][];
}

/** Names the recognition library uses for an offer's product. */
function offerNames(c: Coupon): Set<string> {
  return new Set([c.product, ...(c.match ?? [])].map(normName));
}

/** Run the shelf recognition on the photo and look for the offer's product. */
export async function detectOffer(
  img: HTMLCanvasElement,
  coupon: Coupon,
  catalog: CatalogState | null,
  sales: Map<string, SalesInfo> | null,
  settings: Settings,
  onProgress: (msg: string, frac: number) => void,
): Promise<Detection> {
  const r = await analyseShelf(img, catalog, sales, settings, onProgress);
  const names = offerNames(coupon);
  const hits = r.facings.filter(
    (f) => f.kind === 'product' && f.product && names.has(normName(f.product)) && f.confidence >= settings.matchThreshold - 0.04,
  );
  return {
    found: hits.length > 0,
    facings: hits.length,
    confidence: hits.reduce((m, f) => Math.max(m, f.confidence), 0),
    boxes: hits.map((f) => [f.x1, f.y1, f.x2, f.y2].map(Math.round)),
  };
}

/** What this phone's last scan of the store (before now) said about the product. */
export async function previousScanNote(store: string, coupon: Coupon): Promise<string> {
  if (!store) return '';
  const names = offerNames(coupon);
  const scans = (await listScans().catch(() => [])).filter((s) => s.store === store && s.rows?.length);
  const last = scans.sort((a, b) => b.at - a.at)[0];
  if (!last) return '';
  const day = new Date(last.at).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const row = last.rows!.find((r) => names.has(normName(r.product)) && r.facings > 0 && r.result !== 'missing' && r.result !== 'to_check');
  return row ? `${day}: already on shelf (${row.facings} facing${row.facings > 1 ? 's' : ''})` : `${day}: not on shelf`;
}

const CONSENT = 'shelfscan.claimConsent';
export function hasClaimConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT) === '1';
  } catch {
    return false;
  }
}
export function giveClaimConsent() {
  try {
    localStorage.setItem(CONSENT, '1');
  } catch {
    /* ignore */
  }
}

function login(): string {
  const h = signedInHash();
  if (!h) throw new Error('Please sign in again.');
  return h;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${USAGE_URL}${path}`, init);
  } catch {
    throw new Error("Couldn't reach ShelfScan. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Send the claim: a smaller copy of the photo, the detection and boxes (scaled to the copy). */
export async function submitClaim(p: { coupon: Coupon; store: string; image: HTMLCanvasElement; detection: Detection; prev: string }): Promise<Claim> {
  const scale = Math.min(1, 1280 / Math.max(p.image.width, p.image.height));
  const c = document.createElement('canvas');
  c.width = Math.round(p.image.width * scale);
  c.height = Math.round(p.image.height * scale);
  c.getContext('2d')!.drawImage(p.image, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode photo'))), 'image/jpeg', 0.82));
  const body = {
    h: login(),
    offerId: p.coupon.id,
    title: `${p.coupon.brand} · ${p.coupon.offer}`,
    product: p.coupon.product,
    saving: p.coupon.saving,
    store: p.store,
    detect: { found: p.detection.found, facings: p.detection.facings, confidence: p.detection.confidence },
    boxes: p.detection.boxes.map((b) => b.map((v) => Math.round(v * scale))),
    prev: p.prev,
    photo: await toBase64(blob),
  };
  const r = await call<{ claim: Claim }>('/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.claim;
}

export async function storeClaims(store: string): Promise<Claim[]> {
  if (!store) return [];
  const r = await call<{ claims: Claim[] }>(`/claims?store=${encodeURIComponent(store)}`, { headers: { 'x-login': login() } });
  return r.claims.sort((a, b) => b.at - a.at);
}

export async function adminClaims(user: string, pass: string): Promise<Claim[]> {
  const r = await call<{ claims: Claim[] }>('/admin/claims', { headers: { 'x-admin-user': user, 'x-admin-pass': pass } });
  return r.claims.sort((a, b) => b.at - a.at);
}

export async function reviewClaim(user: string, pass: string, key: string, status: 'approved' | 'rejected', reason = ''): Promise<Claim> {
  const r = await call<{ claim: Claim }>(`/admin/claims/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-user': user, 'x-admin-pass': pass },
    body: JSON.stringify({ status, reason }),
  });
  return r.claim;
}

/** Claim photo (as an object URL) with the detected boxes. */
export async function claimPhoto(id: string, admin?: { user: string; pass: string }): Promise<{ url: string; boxes: number[][] }> {
  const headers: Record<string, string> = admin ? { 'x-admin-user': admin.user, 'x-admin-pass': admin.pass } : { 'x-login': login() };
  const res = await fetch(`${USAGE_URL}/photo/${encodeURIComponent(id)}`, { headers });
  if (!res.ok) throw new Error('Photo not available');
  let boxes: number[][] = [];
  try {
    boxes = JSON.parse(res.headers.get('x-boxes') ?? '[]');
  } catch {
    /* ignore */
  }
  return { url: URL.createObjectURL(await res.blob()), boxes };
}

/** Balance and pending total for a store, from its claims. */
export function claimTotals(claims: Claim[]) {
  const sum = (s: ClaimStatus) => claims.filter((c) => c.status === s).reduce((n, c) => n + c.saving, 0);
  return {
    balance: sum('approved'),
    pending: sum('pending'),
    pendingCount: claims.filter((c) => c.status === 'pending').length,
    paidCount: claims.filter((c) => c.status === 'approved').length,
  };
}

/** The latest claim for each offer (a rejected claim can be resubmitted). */
export function latestByOffer(claims: Claim[]): Map<string, Claim> {
  const m = new Map<string, Claim>();
  for (const c of [...claims].sort((a, b) => b.at - a.at)) if (!m.has(c.offerId)) m.set(c.offerId, c);
  return m;
}
