import * as ort from 'onnxruntime-web/webgpu';

declare const __ORT_WASM_BASE__: string;
// Web build: WASM from the CDN (cached by the service worker). APK: bundled in the app.
if (__ORT_WASM_BASE__) ort.env.wasm.wasmPaths = __ORT_WASM_BASE__;
// Single-threaded WASM unless the page is cross-origin isolated (see public/_headers).
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const MODEL_CACHE = 'shelfscan-models-v1';
const sessions = new Map<string, Promise<ort.InferenceSession>>();
/** Which backend each model ended up on (shown in admin diagnostics). */
export const backends = new Map<string, 'webgpu' | 'wasm'>();
const forceWasm = new Set<string>();

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
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !forceWasm.has(url);
      if (hasGpu) {
        try {
          const sess = await ort.InferenceSession.create(bytes, { ...base, executionProviders: ['webgpu'] });
          backends.set(url, 'webgpu');
          return sess;
        } catch (e) {
          console.warn('WebGPU session failed, falling back to WASM', e);
        }
      }
      const sess = await ort.InferenceSession.create(bytes, { ...base, executionProviders: ['wasm'] });
      backends.set(url, 'wasm');
      return sess;
    })();
    s.catch(() => sessions.delete(url));
    sessions.set(url, s);
  }
  return s;
}

/**
 * Run a model, and if it fails on the GPU (some phones expose WebGPU but
 * can't run every operator), rebuild it on the CPU and try once more.
 */
export async function runModel(
  url: string,
  feeds: Record<string, ort.Tensor>,
  dataUrl?: string,
): Promise<ort.InferenceSession.OnnxValueMapType> {
  const session = await getSession(url, undefined, dataUrl);
  try {
    return await session.run(feeds);
  } catch (e) {
    if (backends.get(url) !== 'webgpu') throw e;
    console.warn('GPU inference failed, switching this model to CPU', e);
    forceWasm.add(url);
    sessions.delete(url);
    return (await getSession(url, undefined, dataUrl)).run(feeds);
  }
}

export function diagnostics(): string {
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const used = [...new Set(backends.values())].join('+') || 'not loaded yet';
  return `AI runs on: ${used} · WebGPU ${gpu ? 'available' : 'not available'} · CPU threads ${ort.env.wasm.numThreads}`;
}

export async function isModelCached(url: string): Promise<boolean> {
  try {
    return !!(await (await caches.open(MODEL_CACHE)).match(url));
  } catch {
    return false;
  }
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
