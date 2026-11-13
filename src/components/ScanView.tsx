import { Camera, ChevronRight, History as HistoryIcon, ListChecks, TicketPercent, Video, Hand, ImageUp, ImagePlus, LayoutGrid, Loader2, Maximize, RotateCcw, ScanLine, Sun, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyseShelf, type AnalysisResult } from '../lib/analyse';
import { addCorrection, type CatalogState } from '../lib/catalog';
import { checkQuality, cropCanvas, loadImageToCanvas, type QualityReport } from '../lib/image';
import { recommend, statusFor, summarise, topSellerCheck } from '../lib/recommend';
import { normName, type SalesInfo } from '../lib/sales';
import { STATUS_STYLE } from '../lib/settings';
import type { ShoppingList } from '../lib/shopping';
import type { Facing, Settings, Status } from '../lib/types';
import { CorrectionSheet } from './CorrectionSheet';
import { ProductTable, RecommendationList, TopSellerPanel } from './Recommendations';
import { ShelfCanvas } from './ShelfCanvas';
import { ShoppingListCard } from './ShoppingListCard';
import { HistoryCard } from './HistoryCard';
import { StoreLeague } from './StoreLeague';
import { MediaHub } from './MediaHub';
import { ToolPage } from './ToolPage';
import { fetchMedia, seenIds } from '../lib/media';
import { signedInAs } from '../lib/auth';
import { money, type Coupon } from '../lib/coupons';
import { track } from '../lib/usage';
import { PlanogramPanel, PlanogramPicker, usePlanograms } from './PlanogramPanel';
import { comparePlanogram, planogramView, type Planogram } from '../lib/planogram';
import { catalogSource } from '../lib/sync';
import { ReportBar } from './ReportBar';
import { StorePicker } from './StorePicker';
import { logChange } from '../lib/changelog';
import { loadStore, saveStore } from '../lib/stores';
import { listScans, loadScan, saveScan, type ScanRow } from '../lib/history';

export interface LibraryStatus {
  state: 'loading' | 'ready' | 'error';
  msg?: string;
  frac?: number;
}

interface Props {
  settings: Settings;
  catalog: CatalogState | null;
  setCatalog: (c: CatalogState) => void;
  sales: Map<string, SalesInfo> | null;
  library: LibraryStatus;
  list: ShoppingList;
  /** App-level Android back button asks the scan screen to step back first. */
  backRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Wholesale offers, shown as a pill on the home screen. */
  coupons?: Coupon[];
  onOpenOffers?: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = (signedInAs() ?? '').trim();
  return name ? `${part}, ${name.charAt(0).toUpperCase()}${name.slice(1)}` : part;
}

const ALL_STATUSES: Status[] = ['top', 'delist', 'core', 'nodata', 'pog_ok', 'pog_short', 'pog_off', 'unsure', 'unknown', 'gap'];
const NO_FACINGS: Facing[] = [];

/** One photo of the bay. A bay scan can have several (closer shots, more angles). */
interface Shot {
  image: HTMLCanvasElement;
  result: AnalysisResult | null;
  facings: Facing[];
}

export function ScanView({ settings, catalog, setCatalog, sales, library, list, backRef, coupons = [], onOpenOffers }: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const addCamRef = useRef<HTMLInputElement>(null);
  const addUploadRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [active, setActive] = useState(0);
  /** Planogram this bay is being checked against (null = normal top-seller scan). */
  const [pog, setPog] = useState<Planogram | null>(null);
  const [pickerSource, setPickerSource] = useState<'camera' | 'upload' | null>(null);
  /** Home-screen tool open on its own screen. */
  const [tool, setTool] = useState<'media' | 'list' | 'history' | null>(null);
  const [toolInfo, setToolInfo] = useState({ media: 0, mediaNew: 0, scans: 0 });
  const listOpen = list.items.filter((i) => !i.done).length;
  const planograms = usePlanograms(catalogSource(settings));
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const cur = shots[active];
  const image = cur?.image ?? null;
  const result = cur?.result ?? null;
  const rawFacings = cur?.facings ?? NO_FACINGS;
  const anyResult = shots.some((sh) => sh.result);
  const patchShot = (i: number, fn: (sh: Shot) => Partial<Shot>) =>
    setShots((ss) => ss.map((sh, j) => (j === i ? { ...sh, ...fn(sh) } : sh)));
  const setFacings = (fn: Facing[] | ((fs: Facing[]) => Facing[])) => {
    const i = active;
    patchShot(i, (sh) => ({
      facings: typeof fn === 'function' ? fn(sh.facings) : fn,
    }));
  };
  const [progress, setProgress] = useState<{
    msg: string;
    frac: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Facing | null>(null);
  const [hidden, setHidden] = useState<Set<Status>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [waiting, setWaiting] = useState(false);
  /** Saved-history entry for the scan on screen, and when it was taken if reopened. */
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [reopenedAt, setReopenedAt] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const saving = useRef<Promise<unknown> | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const scanStarted = useRef(Date.now());
  const [store, setStoreState] = useState(loadStore);
  const setStore = (v: string) => {
    setStoreState(v);
    saveStore(v);
  };
  historyIdRef.current = historyId;

  // Never analyse without the product library: every box would come back unidentified.
  const libraryReady = !!catalog?.entries.length;
  const libraryFailed = library.state === 'error' && !libraryReady;

  const goHome = () => {
    setPog(null);
    setShots([]);
    setActive(0);
    setQuality(null);
    setError(null);
    setWaiting(false);
    setSelected(null);
    setHistoryId(null);
    setReopenedAt(null);
    setHistoryKey((k) => k + 1);
    window.scrollTo({ top: 0 });
  };

  const openScan = async (id: string) => {
    const [scan, metas] = await Promise.all([loadScan(id), listScans()]);
    if (!scan?.length) return;
    setError(null);
    setQuality(null);
    setSelected(null);
    setHidden(new Set());
    setShots(
      scan.map((sh) => {
        const fs = sh.facings.map((f) => ({
          ...f,
          status: statusFor(f, sales, settings),
        }));
        return {
          image: sh.image,
          facings: fs,
          result: {
            facings: fs,
            features: new Map(),
            detector: 'model',
            timings: { detect: 0, recognise: 0 },
            warnings: [],
          },
        };
      }),
    );
    setActive(0);
    setHistoryId(id);
    const meta = metas.find((m) => m.id === id);
    setPog(planograms.find((p) => p.id === meta?.planogramId) ?? null);
    setReopenedAt(meta?.at ?? null);
    if (meta?.store !== undefined) setStoreState(meta.store);
    window.scrollTo({ top: 0 });
  };

  const mediaCloseRef = useRef<(() => boolean) | null>(null);

  // Counts for the home-screen tool boxes (refreshed when a tool closes or a scan is saved).
  const [toolKey, setToolKey] = useState(0);
  const closeTool = () => {
    setTool(null);
    setToolKey((k) => k + 1);
  };
  useEffect(() => {
    let live = true;
    Promise.all([fetchMedia(catalogSource(settings)).catch(() => []), listScans().catch(() => [])]).then(([media, scans]) => {
      if (!live) return;
      const seen = seenIds();
      setToolInfo({ media: media.length, mediaNew: media.filter((m) => !seen.has(m.id)).length, scans: scans.length });
    });
    return () => {
      live = false;
    };
  }, [toolKey, historyKey, settings]);
  const pogCloseRef = useRef<(() => boolean) | null>(null);

  // Android back: close the sheet, then leave the results; only exit from home.
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (mediaCloseRef.current?.()) return true;
      if (pogCloseRef.current?.()) return true;
      if (pickerSource) {
        setPickerSource(null);
        return true;
      }
      if (tool) {
        setTool(null);
        return true;
      }
      if (selected) {
        setSelected(null);
        return true;
      }
      if (image && !progress) {
        goHome();
        return true;
      }
      return false;
    };
  });

  /** add = another photo of the same bay; otherwise start a new bay scan. */
  const onFile = async (file: File | undefined | null, add = false) => {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      setError('That file is not an image. Choose a JPG, PNG or HEIC photo.');
      return;
    }
    setError(null);
    setSelected(null);
    setHidden(new Set());
    if (!add) {
      setHistoryId(null);
      setReopenedAt(null);
      scanStarted.current = Date.now();
      setStoreState(loadStore()); // a new scan uses the store picked on the home screen
    }
    try {
      const c = await loadImageToCanvas(file);
      const idx = add ? shots.length : 0;
      const shot: Shot = { image: c, result: null, facings: [] };
      setShots((ss) => (add ? [...ss, shot] : [shot]));
      setActive(idx);
      const q = checkQuality(c);
      setQuality(q);
      if (q.ok) {
        if (libraryReady) await run(c, idx);
        else setWaiting(true);
      }
    } catch (e) {
      setError(`Could not open that image: ${(e as Error).message}`);
    }
  };

  // If a photo was taken while the product library was still loading, analyse it once ready.
  useEffect(() => {
    if (waiting && libraryReady && image) {
      setWaiting(false);
      run(image, active);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, libraryReady, image]);

  // Paste a photo from the clipboard (handy on desktop).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) onFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const run = async (img = image, idx = active) => {
    if (!img) return;
    setError(null);
    setProgress({ msg: 'Starting…', frac: 0 });
    try {
      const r = await analyseShelf(img, catalog, sales, settings, (msg, frac) => setProgress({ msg, frac }));
      patchShot(idx, () => ({ result: r, facings: r.facings }));
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  // Bay-level results combine every photo: a top seller is only missing if it's in none of them.
  const allFacings = useMemo(() => shots.flatMap((sh, si) => sh.facings.map((f) => ({ ...f, id: si * 100000 + f.id }))), [shots]);
  const summary = useMemo(() => summarise(allFacings, sales), [allFacings, sales]);
  const check = useMemo(
    () => topSellerCheck(allFacings, sales, catalog?.products ?? [], (n) => catalog?.categories?.[n]),
    [allFacings, sales, catalog],
  );
  const recs = useMemo(() => recommend(allFacings, sales), [allFacings, sales]);
  const pogResult = useMemo(() => (pog ? comparePlanogram(pog, allFacings, catalog?.products ?? []) : null), [pog, allFacings, catalog]);
  const unsureCount = useMemo(() => {
    if (!pog || !pogResult) return summary.unsure;
    const view = planogramView(pog, pogResult);
    return allFacings.filter((f) => f.kind === 'product' && view(f).status === 'unsure').length;
  }, [pog, pogResult, allFacings, summary]);
  // In a planogram check the boxes show the plan (green / blue / red) instead of top / slow sellers.
  const facings = useMemo(
    () => (pog && pogResult ? rawFacings.map(planogramView(pog, pogResult)) : rawFacings),
    [pog, pogResult, rawFacings],
  );

  // Save each finished bay scan to history, and keep it up to date as photos are added or boxes confirmed.
  useEffect(() => {
    if (!anyResult || progress || shots.some((sh) => !sh.result)) return;
    const info = {
      bay: check.categories.length ? `${check.categories.join(' & ')} bay` : 'Shelf',
      present: check.present.length,
      total: check.present.length + check.missing.length,
      missing: check.missing.filter((m) => !m.possible).length,
      store: store.trim() || undefined,
      rows: scanRows(),
      planogramId: pog?.id,
      planogramScore: pogResult && pogResult.expected ? pogResult.score : undefined,
    };
    const snapshot = shots.map((sh) => ({
      image: sh.image,
      facings: sh.facings,
    }));
    const t = setTimeout(() => {
      const prev = saving.current ?? Promise.resolve();
      saving.current = prev.then(async () => {
        try {
          const first = !historyIdRef.current;
          setHistoryId(await saveScan(snapshot, info, historyIdRef.current ?? undefined));
          // Usage log: one note per new scan (not for reopened ones or later edits).
          if (first) {
            const where = info.store ?? 'no store picked';
            const photos = `${snapshot.length} photo${snapshot.length > 1 ? 's' : ''}`;
            if (pog) track('planogram_check', `${where} · ${pog.title} · ${pogResult && pogResult.expected ? Math.round(pogResult.score * 100) + '% in place' : 'not checkable'} · ${photos}`);
            else track('scan', `${where} · ${info.bay} · ${info.total ? `${info.present}/${info.total} top sellers, ${info.missing} missing` : 'no top-seller check'} · ${photos}`);
          }
        } catch (e) {
          console.warn('Could not save scan to history', e);
        }
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, progress, store]);

  const updateFacing = (id: number, patch: Partial<Facing>) => {
    setFacings((fs) =>
      fs.map((f) => {
        if (f.id !== id) return f;
        const nf = { ...f, ...patch };
        nf.status = statusFor(nf, sales, settings);
        return nf;
      }),
    );
  };

  /** Audit trail: record what the app said and what the rep chose. */
  const recordChange = (f: Facing, repProduct: string | null) => {
    if (!image) return;
    const action = repProduct === null ? 'marked_empty' : repProduct === f.product ? 'confirmed' : 'corrected';
    logChange({
      action,
      appProduct: f.kind === 'gap' ? null : f.product,
      appConfidence: f.confidence,
      appStatus: f.status,
      repProduct,
      alternatives: f.candidates
        .map((c) => c.product)
        .filter((p) => p !== f.product)
        .slice(0, 3),
      store: store.trim() || undefined,
      scanId: historyIdRef.current ?? undefined,
      bay: check.categories.length ? `${check.categories.join(' & ')} bay` : undefined,
      crop: cropCanvas(image, f, 0.05),
    }).catch((e) => console.warn('Could not log change', e));
  };

  const onPick = async (product: string) => {
    if (!selected || !image || !result) return;
    const f = selected;
    recordChange(f, product);
    updateFacing(f.id, {
      product,
      corrected: true,
      kind: 'product',
      confidence: 1,
    });
    setSelected(null);
    // Confirmed crops are kept as extra reference photos (and exported for the admin).
    const feat = result.features.get(f.id);
    if (feat && catalog) {
      try {
        const entry = await addCorrection(product, cropCanvas(image, f), feat.emb, feat.hist, catalog.embedderId);
        if (entry) setCatalog({ ...catalog, entries: [...catalog.entries, entry] });
      } catch (e) {
        console.warn('Could not save correction', e);
      }
    }
  };

  const toggle = (s: Status) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  /** Per-product results for the CSV export. */
  const scanRows = (): ScanRow[] => {
    const rows: ScanRow[] = [];
    const seen = new Set<string>();
    for (const m of check.present) {
      rows.push({
        product: m.name,
        category: m.category,
        rank: m.categoryRank,
        result: 'on_shelf',
        facings: m.facings,
      });
      seen.add(m.name);
    }
    for (const m of check.missing) {
      rows.push({
        product: m.name,
        category: m.category,
        rank: m.categoryRank,
        result: m.possible ? 'to_check' : 'missing',
        facings: 0,
      });
      seen.add(m.name);
    }
    for (const p of summary.products) {
      if (seen.has(p.name)) continue;
      const cat = p.category ?? catalog?.categories?.[p.name];
      rows.push({
        product: p.name,
        category: cat,
        rank: p.rank,
        result: p.status === 'delist' ? 'slow_seller' : p.status === 'core' ? 'core' : 'other',
        facings: p.facings,
      });
    }
    return rows;
  };
  const slow = useMemo(
    () => summary.products.filter((p) => p.status === 'delist').map((p) => ({ name: p.name, facings: p.facings })),
    [summary],
  );
  const showOnly = (s: Status) => {
    setHidden(new Set(ALL_STATUSES.filter((x) => x !== s)));
    shelfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showOnlyUnsure = () => {
    setHidden(new Set(ALL_STATUSES.filter((s) => s !== 'unsure')));
    shelfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Likely products for the correction list: same brand as the guesses, then the bay's categories by sales rank.
  const suggestions = useMemo(() => {
    if (!selected || !catalog) return [];
    const guesses = selected.candidates.map((c) => c.product);
    const brands = new Set(guesses.map((g) => g.split(' ')[0].toLowerCase()));
    const bay = new Set(check.categories.map((c) => normName(c)));
    const catOf = (n: string) => sales?.get(normName(n))?.category ?? catalog.categories?.[n];
    const rank = (n: string) => sales?.get(normName(n))?.rank ?? 9999;
    const sameBrand = catalog.products.filter((p) => brands.has(p.split(' ')[0].toLowerCase()));
    const sameBay = catalog.products.filter((p) => {
      const c = catOf(p);
      return c ? bay.has(normName(c)) : false;
    });
    const ordered = [
      ...guesses,
      ...sameBrand.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
      ...sameBay.sort((a, b) => rank(a) - rank(b)),
    ];
    return [...new Set(ordered)];
  }, [selected, catalog, check, sales]);
  const selectedCrop = useMemo(() => (selected && image ? cropCanvas(image, selected, 0.05) : null), [selected, image]);
  const presentStatuses = useMemo(() => ALL_STATUSES.filter((s) => facings.some((f) => f.status === s)), [facings]);
  const busy = !!progress;

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      onFile(e.dataTransfer.files?.[0]);
    },
  };

  return (
    <div className="view" {...dropProps}>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={addCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0], true);
          e.target.value = '';
        }}
      />
      <input
        ref={addUploadRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0], true);
          e.target.value = '';
        }}
      />

      {!image ? (
        <>
          <h1 className="hello">{greeting()}</h1>

          <div className="home-store">
            <StorePicker value={store} onChange={setStore} compact />
          </div>

          {coupons.length > 0 && onOpenOffers && (
            <button className="offers-pill" onClick={onOpenOffers}>
              <span className="offers-pill-icon">
                <TicketPercent size={22} />
              </span>
              <span className="offers-pill-text">
                <b>Wholesale offers</b>
                <small>
                  {coupons.length} deal{coupons.length > 1 ? 's' : ''} · save up to {money(Math.max(...coupons.map((c) => c.saving)))}
                </small>
              </span>
              <span className="offers-pill-count">{coupons.length}</span>
              <ChevronRight size={18} />
            </button>
          )}

          <h2 className="home-label">Check a shelf</h2>

          <section className={`card check-card ${dragging ? 'dragging' : ''}`}>
            <div className="check-head">
              <span className="shop-icon">
                <ScanLine size={20} />
              </span>
              <div>
                <h3>Top-seller check</h3>
                <p className="muted small">Which best sellers are missing</p>
              </div>
            </div>
            <div className="check-btns">
              <button
                className="check-btn primary"
                onClick={() => {
                  setPog(null);
                  camRef.current?.click();
                }}
              >
                <Camera size={18} /> Take photo
              </button>
              <button
                className="check-btn"
                onClick={() => {
                  setPog(null);
                  uploadRef.current?.click();
                }}
              >
                <ImageUp size={18} /> Upload
              </button>
            </div>
          </section>

          <section className="card check-card">
            <div className="check-head">
              <span className="shop-icon">
                <LayoutGrid size={20} />
              </span>
              <div>
                <h3>Planogram check</h3>
                <p className="muted small">Compare a bay with its planogram</p>
              </div>
            </div>
            <div className="check-btns">
              <button className="check-btn primary" onClick={() => setPickerSource('camera')}>
                <Camera size={18} /> Take photo
              </button>
              <button className="check-btn" onClick={() => setPickerSource('upload')}>
                <ImageUp size={18} /> Upload
              </button>
            </div>
          </section>
          {pickerSource && (
            <PlanogramPicker
              planograms={planograms}
              source={pickerSource}
              onClose={() => setPickerSource(null)}
              onPick={(p, source) => {
                setPog(p);
                setPickerSource(null);
                (source === 'camera' ? camRef : uploadRef).current?.click();
              }}
            />
          )}

          {library.state === 'loading' && (
            <div className="card progress soft">
              <div className="progress-head">
                <Loader2 size={18} className="spin" />
                <span>{catalog ? (library.msg ?? 'Updating product library') : 'Getting ready for first use…'}</span>
                <span className="muted">{Math.round((library.frac ?? 0) * 100)}%</span>
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round((library.frac ?? 0) * 100)}%` }} />
              </div>
              <p className="muted small">One-off download of the recognition models. After this the app works offline.</p>
            </div>
          )}

          <StoreLeague onOpen={openScan} refreshKey={historyKey} />

          <h2 className="home-label">Your tools</h2>
          <div className="tool-grid">
            <button className="tool-tile" onClick={() => setTool('media')}>
              <span className="shop-icon">
                <Video size={20} />
              </span>
              <b>Media hub</b>
              <small>{toolInfo.mediaNew ? `${toolInfo.mediaNew} new` : `${toolInfo.media} item${toolInfo.media === 1 ? '' : 's'}`}</small>
            </button>
            <button className="tool-tile" onClick={() => setTool('list')}>
              <span className="shop-icon">
                <ListChecks size={20} />
              </span>
              <b>Shopping list</b>
              <small>{listOpen ? `${listOpen} to get` : 'Empty'}</small>
            </button>
            <button className="tool-tile" onClick={() => setTool('history')}>
              <span className="shop-icon">
                <HistoryIcon size={20} />
              </span>
              <b>History</b>
              <small>
                {toolInfo.scans} scan{toolInfo.scans === 1 ? '' : 's'}
              </small>
            </button>
          </div>

          <details className="photo-tips">
            <summary>Photo tips</summary>
            <ul>
              <li>
                <Maximize size={16} /> One bay per photo, the whole bay in frame
              </li>
              <li>
                <Hand size={16} /> Stand square-on and hold steady
              </li>
              <li>
                <Sun size={16} /> Avoid glare from lights and fridge doors
              </li>
            </ul>
          </details>
          <p className="footnote">Built with DINOv3 · runs on your phone, photos never leave it</p>

          {tool === 'media' && (
            <ToolPage title="Media hub" onClose={closeTool}>
              <MediaHub libraryBase={catalogSource(settings)} closeRef={mediaCloseRef} page />
            </ToolPage>
          )}
          {tool === 'list' && (
            <ToolPage title="Shopping list" onClose={closeTool}>
              <ShoppingListCard list={list} page />
            </ToolPage>
          )}
          {tool === 'history' && (
            <ToolPage title="Scan history" onClose={closeTool}>
              <HistoryCard
                onOpen={(id) => {
                  closeTool();
                  openScan(id);
                }}
                refreshKey={historyKey}
                page
              />
            </ToolPage>
          )}
        </>
      ) : (
        <div className="toolbar">
          <button className="btn ghost icon-only" onClick={goHome} disabled={busy} aria-label="Back to home" title="Back to home">
            <X size={18} />
          </button>
          <button className="btn" onClick={() => camRef.current?.click()} disabled={busy}>
            <Camera size={18} /> Camera
          </button>
          <button className="btn" onClick={() => uploadRef.current?.click()} disabled={busy}>
            <ImageUp size={18} /> Upload
          </button>
          {result && (
            <button className="btn ghost icon-only" onClick={() => run()} disabled={busy} aria-label="Analyse again" title="Analyse again">
              <RotateCcw size={18} />
            </button>
          )}
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      {quality && !quality.ok && !result && !progress && !waiting && (
        <div className="notice warn">
          {quality.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
          <div className="row">
            <button className="btn" onClick={() => camRef.current?.click()}>
              Retake
            </button>
            <button className="btn primary" onClick={() => (libraryReady ? run() : setWaiting(true))}>
              Analyse anyway
            </button>
          </div>
        </div>
      )}

      {waiting && libraryFailed && (
        <div className="notice error">
          The product library couldn't be loaded ({library.msg ?? 'no connection'}), so products can't be identified yet. Check your
          connection and try again.
          <div className="row">
            <button className="btn primary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </div>
      )}
      {(progress || (waiting && !libraryFailed)) && (
        <div className="card progress">
          <div className="progress-head">
            <Loader2 size={18} className="spin" />
            <span>{waiting ? (library.msg ?? 'Preparing product library') : progress!.msg}</span>
            <span className="muted">{Math.round((waiting ? (library.frac ?? 0) : progress!.frac) * 100)}%</span>
          </div>
          <div className="bar">
            <div
              style={{
                width: `${Math.round((waiting ? (library.frac ?? 0) : progress!.frac) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {reopenedAt && (
        <div className="notice">
          Saved scan from{' '}
          {new Date(reopenedAt).toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          . Results use today's top-seller list.
        </div>
      )}
      {result &&
        result.warnings.map((w) => (
          <div key={w} className="notice warn">
            {w}
          </div>
        ))}

      {anyResult && pog && pogResult && (
        <PlanogramPanel pog={pog} r={pogResult} list={list} onShowUnsure={showOnlyUnsure} onShow={showOnly} closeRef={pogCloseRef} />
      )}
      {anyResult && !pog && (
        <TopSellerPanel check={check} onShowUnsure={showOnlyUnsure} list={list} slow={slow} onShowSlow={() => showOnly('delist')} />
      )}
      {anyResult && !pog && !busy && check.bayKnown && (
        <ReportBar
          check={check}
          slow={slow}
          shots={shots.map((sh) => ({ image: sh.image, facings: sh.facings }))}
          productsFound={summary.facings}
          takenAt={reopenedAt ?? scanStarted.current}
          store={store}
          onStoreChange={setStore}
        />
      )}

      {image && (
        <div ref={shelfRef} className="shelf-block">
          {anyResult && (
            <div className="shots">
              {shots.map((sh, i) => (
                <div key={i} className={`shot ${i === active ? 'active' : ''}`}>
                  <button
                    className="shot-btn"
                    onClick={() => {
                      setActive(i);
                      setSelected(null);
                    }}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <ShotThumb canvas={sh.image} />
                    <span>{sh.result ? `Photo ${i + 1}` : 'Analysing…'}</span>
                  </button>
                  {shots.length > 1 && !busy && (
                    <button
                      className="shot-remove"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => {
                        setShots((ss) => ss.filter((_, j) => j !== i));
                        setActive((a) => (a > i ? a - 1 : a === i ? Math.max(0, i - 1) : a));
                        setSelected(null);
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {shots.length < 6 && (
                <div className="shot-add">
                  <button className="shot-add-btn" onClick={() => addCamRef.current?.click()} disabled={busy}>
                    <ImagePlus size={18} />
                    <span>Add photo</span>
                  </button>
                  <button className="shot-add-link" onClick={() => addUploadRef.current?.click()} disabled={busy}>
                    or upload
                  </button>
                </div>
              )}
            </div>
          )}
          <ShelfCanvas
            image={image}
            facings={facings}
            hidden={hidden}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            scanning={!!progress || waiting}
          />
          {result && (
            <div className="legend">
              {presentStatuses.map((s) => (
                <button key={s} className={`chip ${hidden.has(s) ? 'off' : ''}`} onClick={() => toggle(s)}>
                  <span className="dot" style={{ background: STATUS_STYLE[s].color }} />
                  {STATUS_STYLE[s].label}
                  <span className="chip-count">{facings.filter((f) => f.status === s).length}</span>
                </button>
              ))}
              {hidden.size > 0 && (
                <button className="chip" onClick={() => setHidden(new Set())}>
                  Show all
                </button>
              )}
            </div>
          )}
          {result && (
            <p className="meta">
              {summary.facings} products found
              {shots.length > 1 ? ` across ${shots.length} photos` : ''}
              {unsureCount ? ` · ${unsureCount} unclear (tap an amber box to confirm)` : ''}
              {reopenedAt || shots.length > 1 ? '' : ` · ${((result.timings.detect + result.timings.recognise) / 1000).toFixed(1)}s`}
              {shots.length === 1 ? ' · Big bay? Add a closer photo of each half for better results.' : ''}
            </p>
          )}
        </div>
      )}

      {anyResult && !pog && <RecommendationList recs={recs} />}
      {anyResult && !pog && <ProductTable s={summary} />}

      {selected && image && (
        <CorrectionSheet
          facing={selected}
          crop={selectedCrop!}
          products={catalog?.products ?? []}
          suggestions={suggestions}
          salesRank={(n) => sales?.get(normName(n))?.rank}
          onPick={onPick}
          onMarkGap={() => {
            recordChange(selected, null);
            updateFacing(selected.id, {
              kind: 'gap',
              product: null,
              corrected: true,
            });
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ShotThumb({ canvas }: { canvas: HTMLCanvasElement }) {
  const url = useMemo(() => {
    const c = document.createElement('canvas');
    const k = 96 / Math.max(canvas.width, canvas.height);
    c.width = Math.round(canvas.width * k);
    c.height = Math.round(canvas.height * k);
    c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }, [canvas]);
  return <img src={url} alt="" />;
}
