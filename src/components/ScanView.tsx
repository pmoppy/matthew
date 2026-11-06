import { Camera, Hand, ImageUp, Loader2, Maximize, RotateCcw, ScanLine, Sun, X } from 'lucide-react';
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
}

const ALL_STATUSES: Status[] = ['top', 'delist', 'core', 'nodata', 'unsure', 'unknown', 'gap'];

export function ScanView({ settings, catalog, setCatalog, sales, library, list, backRef }: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [facings, setFacings] = useState<Facing[]>([]);
  const [progress, setProgress] = useState<{ msg: string; frac: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Facing | null>(null);
  const [hidden, setHidden] = useState<Set<Status>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const libraryReady = library.state !== 'loading' || !!catalog?.entries.length;

  const goHome = () => {
    setImage(null);
    setResult(null);
    setFacings([]);
    setQuality(null);
    setError(null);
    setWaiting(false);
    setSelected(null);
    window.scrollTo({ top: 0 });
  };

  // Android back: close the sheet, then leave the results; only exit from home.
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
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

  const onFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      setError('That file is not an image. Choose a JPG, PNG or HEIC photo.');
      return;
    }
    setError(null);
    setResult(null);
    setFacings([]);
    setSelected(null);
    setHidden(new Set());
    try {
      const c = await loadImageToCanvas(file);
      setImage(c);
      const q = checkQuality(c);
      setQuality(q);
      if (q.ok) {
        if (libraryReady) await run(c);
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
      run(image);
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

  const run = async (img = image) => {
    if (!img) return;
    setError(null);
    setProgress({ msg: 'Starting…', frac: 0 });
    try {
      const r = await analyseShelf(img, catalog, sales, settings, (msg, frac) => setProgress({ msg, frac }));
      setResult(r);
      setFacings(r.facings);
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const summary = useMemo(() => summarise(facings, sales), [facings, sales]);
  const check = useMemo(() => topSellerCheck(facings, sales, catalog?.products ?? []), [facings, sales, catalog]);
  const recs = useMemo(() => recommend(facings, sales), [facings, sales]);

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

  const onPick = async (product: string) => {
    if (!selected || !image || !result) return;
    const f = selected;
    updateFacing(f.id, { product, corrected: true, kind: 'product', confidence: 1 });
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

  const showOnlyUnsure = () => {
    setHidden(new Set(ALL_STATUSES.filter((s) => s !== 'unsure')));
    shelfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />

      {!image ? (
        <>
          <section className="hero">
            <div className="hero-badge">
              <ScanLine size={16} /> Top-seller check
            </div>
            <h1>
              Snap a shelf.
              <br />
              <span className="grad-text">Find missing top sellers.</span>
            </h1>
            <p>
              Take a photo of a bay and ShelfScan tells you which best-selling lines aren't on it, highlights top sellers in{' '}
              <b className="c-top">green</b> and slow sellers in <b className="c-delist">red</b>.
            </p>
          </section>

          <div className={`capture ${dragging ? 'dragging' : ''}`}>
            <button className="capture-tile primary" onClick={() => camRef.current?.click()}>
              <span className="capture-icon">
                <Camera size={26} />
              </span>
              <span className="capture-title">Take photo</span>
              <span className="capture-sub">Use your camera</span>
            </button>
            <button className="capture-tile" onClick={() => uploadRef.current?.click()}>
              <span className="capture-icon">
                <ImageUp size={26} />
              </span>
              <span className="capture-title">Upload photo</span>
              <span className="capture-sub">From gallery or files</span>
            </button>
            <p className="capture-hint">or drag & drop / paste an image here</p>
          </div>

          {library.state === 'loading' && (
            <div className="card progress soft">
              <div className="progress-head">
                <Loader2 size={18} className="spin" />
                <span>{catalog ? library.msg ?? 'Updating product library' : 'Getting ready for first use…'}</span>
                <span className="muted">{Math.round((library.frac ?? 0) * 100)}%</span>
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round((library.frac ?? 0) * 100)}%` }} />
              </div>
              <p className="muted small">One-off download of the recognition models. After this the app works offline.</p>
            </div>
          )}

          <ShoppingListCard list={list} />

          <section className="card tips">
            <h3>For the best results</h3>
            <ul>
              <li>
                <Maximize size={18} /> One bay per photo, the whole bay in frame
              </li>
              <li>
                <Hand size={18} /> Stand square-on and hold steady
              </li>
              <li>
                <Sun size={18} /> Avoid glare from lights and fridge doors
              </li>
            </ul>
          </section>
          <p className="footnote">Built with DINOv3 · runs on your phone, photos never leave it</p>
        </>
      ) : (
        <div className="toolbar">
          <button
            className="btn ghost icon-only"
            onClick={goHome}
            disabled={busy}
            aria-label="Back to home"
            title="Back to home"
          >
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

      {(progress || waiting) && (
        <div className="card progress">
          <div className="progress-head">
            <Loader2 size={18} className="spin" />
            <span>{waiting ? library.msg ?? 'Preparing product library' : progress!.msg}</span>
            <span className="muted">{Math.round((waiting ? library.frac ?? 0 : progress!.frac) * 100)}%</span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round((waiting ? library.frac ?? 0 : progress!.frac) * 100)}%` }} />
          </div>
        </div>
      )}

      {result && result.warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}

      {result && <TopSellerPanel check={check} onShowUnsure={showOnlyUnsure} list={list} />}

      {image && (
        <div ref={shelfRef} className="shelf-block">
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
              {summary.facings} products found · {summary.unsure ? `${summary.unsure} unclear (tap an amber box to confirm) · ` : ''}
              {((result.timings.detect + result.timings.recognise) / 1000).toFixed(1)}s
            </p>
          )}
        </div>
      )}

      {result && <RecommendationList recs={recs} />}
      {result && <ProductTable s={summary} />}

      {selected && image && (
        <CorrectionSheet
          facing={selected}
          crop={selectedCrop!}
          products={catalog?.products ?? []}
          salesRank={(n) => sales?.get(normName(n))?.rank}
          onPick={onPick}
          onMarkGap={() => {
            updateFacing(selected.id, { kind: 'gap', product: null, corrected: true });
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
