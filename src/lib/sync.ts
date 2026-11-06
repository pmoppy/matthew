import { buildCatalog, listFromWorker, saveCatalog, type CatalogState } from './catalog';
import { parseSales } from './sales';
import type { Settings } from './types';

/**
 * Where the product library comes from. Set VITE_CATALOG_URL at build time
 * (e.g. your R2 catalogue Worker) so field users never see any set-up. The
 * built-in starter library in public/starter is used otherwise.
 */
export const DEFAULT_CATALOG_URL: string = (import.meta.env.VITE_CATALOG_URL as string | undefined)?.trim() || '/starter';

export function catalogSource(s: Settings): string {
  return s.catalogUrl.trim() || DEFAULT_CATALOG_URL;
}

const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function needsSync(catalog: CatalogState | null, s: Settings): 'full' | 'refresh' | null {
  if (!catalog || catalog.source !== catalogSource(s) || catalog.embedderId !== s.embedderId) return 'full';
  if (Date.now() - catalog.updatedAt > MAX_AGE_MS) return 'refresh';
  return null;
}

export interface SyncResult {
  catalog: CatalogState;
  salesCsv: string | null;
  detectorUrl?: string;
}

/** Download the manifest, learn any new product photos and fetch the sales ranking. */
export async function syncLibrary(s: Settings, onProgress: (msg: string, frac: number) => void): Promise<SyncResult> {
  const base = catalogSource(s);
  onProgress('Checking product library', 0);
  const { refs, salesUrl, detectorUrl, version } = await listFromWorker(base);
  if (!refs.length) throw new Error('The product library is empty.');
  let salesCsv: string | null = null;
  if (salesUrl) {
    const r = await fetch(salesUrl, { cache: 'no-store' });
    if (r.ok) {
      salesCsv = await r.text();
      parseSales(salesCsv); // validate
    }
  }
  const catalog = await buildCatalog(refs, s.embedderId, base, onProgress);
  catalog.version = version;
  await saveCatalog(catalog);
  return { catalog, salesCsv, detectorUrl };
}

/** Cheap check (manifest only) whether the published library changed since the last sync. */
export async function libraryChanged(catalog: CatalogState, s: Settings): Promise<boolean> {
  try {
    const base = catalogSource(s).replace(/\/+$/, '');
    const res = await fetch(new URL(`${base}/manifest.json`, location.href).toString(), { cache: 'no-store' });
    if (!res.ok) return false;
    const m = (await res.json()) as { generated?: string };
    return !!m.generated && m.generated !== catalog.version;
  } catch {
    return false; // offline: keep using the cached library
  }
}
