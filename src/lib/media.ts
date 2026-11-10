import { createStore, get, set } from 'idb-keyval';

/**
 * Media hub: planograms, adverts and training videos for reps. The list is a
 * small media.json next to the product library (<library>/media/media.json),
 * so it updates on every phone without a new APK. Files open offline once seen.
 */
export type MediaType = 'image' | 'pdf' | 'video' | 'youtube' | 'link';

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  description?: string;
  tag?: string;
  date?: string;
  /** File next to media.json (image / pdf / video). */
  file?: string;
  /** Small preview image next to media.json. */
  thumb?: string;
  /** External link (YouTube or any web page). */
  url?: string;
  /** Planogram contents, shelf by shelf (top first), so a bay photo can be checked against it. */
  planogram?: { shelves: { product: string; facings: number; also?: string[] }[][] };
}

const fileStore = createStore('shelfscan-media', 'v1');
const LIST_KEY = 'shelfscan.media.v2';
const SEEN_KEY = 'shelfscan.mediaSeen';

/**
 * Live media list, read from GitHub every time the app opens so new planograms
 * and videos appear without an app update (GitHub caches it for ~5 minutes).
 * Override with VITE_MEDIA_URL, or by pointing the library at the R2 Worker.
 */
const LIVE_MEDIA_BASE: string =
  (import.meta.env.VITE_MEDIA_URL as string | undefined)?.trim() ||
  'https://raw.githubusercontent.com/pmoppy/matthew/claude/app-planning-development-x0ak8y/public/starter/media';

/** Item with its file and preview resolved to full URLs. */
export type ResolvedMedia = MediaItem & { fileUrl?: string; thumbUrl?: string };

function localBase(libraryBase: string): string {
  return new URL(`${libraryBase.replace(/\/+$/, '')}/media`, location.href).toString();
}

/** Where to look, in order: the live list first, then the copy built into the app. */
function sources(libraryBase: string): string[] {
  const own = localBase(libraryBase);
  // A custom library (e.g. the R2 Worker) carries its own media folder.
  const builtIn = /^\/([^/]+\/)*starter$/.test(libraryBase.replace(/\/+$/, '')) || libraryBase.startsWith(location.origin);
  return builtIn ? [LIVE_MEDIA_BASE, own] : [own];
}

function join(base: string, file: string): string {
  if (/^https?:/i.test(file)) return file;
  return `${base.replace(/\/+$/, '')}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function valid(x: unknown): x is MediaItem {
  const i = x as MediaItem;
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.type === 'string' && (!!i.file || !!i.url);
}

function sortNewest<T extends MediaItem>(items: T[]) {
  return [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function cachedMedia(): ResolvedMedia[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(valid) : [];
  } catch {
    return [];
  }
}

async function load(base: string): Promise<ResolvedMedia[] | null> {
  try {
    const res = await fetch(`${base}/media.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown[] };
    return sortNewest(
      (body.items ?? []).filter(valid).map((i) => ({
        ...i,
        fileUrl: i.file ? join(base, i.file) : undefined,
        thumbUrl: i.thumb ? join(base, i.thumb) : undefined,
      })),
    );
  } catch {
    return null;
  }
}

/** Latest list (live first); falls back to the last list seen, then the built-in one, when offline. */
export async function fetchMedia(libraryBase: string): Promise<ResolvedMedia[]> {
  const [live, ...rest] = sources(libraryBase);
  let items = await load(live);
  if (!items) {
    const cached = cachedMedia();
    if (cached.length) return cached;
    for (const b of rest) if ((items = await load(b))) break;
  }
  if (!items) return [];
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked */
  }
  return items;
}

/** File as a blob, from the phone if it was opened before, else downloaded and kept. */
export async function mediaBlob(url: string): Promise<Blob> {
  const hit = (await get(url, fileStore).catch(() => undefined)) as Blob | undefined;
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download (${res.status})`);
  const blob = await res.blob();
  await set(url, blob, fileStore).catch(() => {});
  return blob;
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * DEMO: "New" badges only last until the app is closed, so they are back every
 * time it is reopened and the hub can be shown off. Set to false to remember what each
 * phone has opened (later: per rep, once there are logins).
 */
export const DEMO_ALWAYS_NEW = true;
let sessionSeen = new Set<string>();

export function seenIds(): Set<string> {
  if (DEMO_ALWAYS_NEW) return new Set(sessionSeen);
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markSeen(id: string) {
  if (DEMO_ALWAYS_NEW) {
    sessionSeen.add(id);
    return;
  }
  const s = seenIds();
  s.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* ignore */
  }
}

