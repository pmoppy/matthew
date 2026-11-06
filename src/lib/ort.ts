import * as ort from 'onnxruntime-web/webgpu';

declare const __ORT_WASM_BASE__: string;
// Web build: WASM from the CDN (cached by the service worker). APK: bundled in the app.
if (__ORT_WASM_BASE__) ort.env.wasm.wasmPaths = __ORT_WASM_BASE__;
// Single-threaded WASM unless the page is cross-origin isolated (see public/_headers).
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const MODEL_CACHE = 'shelfscan-models-v1';
const sessions = new Map<string, Promise<ort.InferenceSession>>();

/** Download a model once and keep it in Cache Storage so the app works offline in-store. */
export async function fetchModel(url: string, onProgress?: (frac: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Could not download model (${res.status}) from ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  let bytes: Uint8Array;
  if (reader && total) {
    bytes = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > bytes.length) {
        const bigger = new Uint8Array(Math.max(bytes.length * 2, got + value.length));
        bigger.set(bytes.subarray(0, got));
        bytes = bigger;
      }
      bytes.set(value, got);
      got += value.length;
      onProgress?.(Math.min(1, got / total));
    }
    bytes = bytes.subarray(0, got);
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  try {
    await cache?.put(url, new Response(bytes.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    /* quota exceeded etc. – still usable this session */
  }
  return bytes;
}

export function getSession(url: string, onProgress?: (frac: number) => void, dataUrl?: string): Promise<ort.InferenceSession> {
  let s = sessions.get(url);
  if (!s) {
    s = (async () => {
      const bytes = await fetchModel(url, dataUrl ? undefined : onProgress);
      const base: ort.InferenceSession.SessionOptions = {};
      if (dataUrl) {
        // Large models keep their weights in a side file; the graph refers to it by file name.
        const data = await fetchModel(dataUrl, onProgress);
        base.externalData = [{ path: dataUrl.split('/').pop()!.split('?')[0], data }];
      }
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      if (hasGpu) {
        try {
          return await ort.InferenceSession.create(bytes, { ...base, executionProviders: ['webgpu'] });
        } catch (e) {
          console.warn('WebGPU session failed, falling back to WASM', e);
        }
      }
      return ort.InferenceSession.create(bytes, { ...base, executionProviders: ['wasm'] });
    })();
    s.catch(() => sessions.delete(url));
    sessions.set(url, s);
  }
  return s;
}

export async function clearModelCache(): Promise<void> {
  sessions.clear();
  try {
    await caches.delete(MODEL_CACHE);
  } catch {
    /* ignore */
  }
}

export { ort };
