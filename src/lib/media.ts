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
}

const fileStore = createStore('shelfscan-media', 'v1');
const LIST_KEY = 'shelfscan.media';
const SEEN_KEY = 'shelfscan.mediaSeen';

export function mediaBase(libraryBase: string): string {
  return `${libraryBase.replace(/\/+$/, '')}/media`;
}

export function mediaUrl(libraryBase: string, file: string): string {
  return new URL(`${mediaBase(libraryBase)}/${file.split('/').map(encodeURIComponent).join('/')}`, location.href).toString();
}

function valid(x: unknown): x is MediaItem {
  const i = x as MediaItem;
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.type === 'string' && (!!i.file || !!i.url);
}

function sortNewest(items: MediaItem[]) {
  return [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function cachedMedia(): MediaItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(valid) : [];
  } catch {
    return [];
  }
}

/** Latest list from the library; falls back to the last copy when offline. */
export async function fetchMedia(libraryBase: string): Promise<MediaItem[]> {
  try {
    const res = await fetch(new URL(`${mediaBase(libraryBase)}/media.json`, location.href).toString(), { cache: 'no-store' });
    if (!res.ok) return res.status === 404 ? [] : cachedMedia();
    const body = (await res.json()) as { items?: unknown[] };
    const items = sortNewest((body.items ?? []).filter(valid));
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(items));
    } catch {
      /* storage full or blocked */
    }
    return items;
  } catch {
    return cachedMedia();
  }
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

export function seenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markSeen(id: string) {
  const s = seenIds();
  s.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* ignore */
  }
}
