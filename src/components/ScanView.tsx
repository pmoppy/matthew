import { Camera, ImageUp, Lightbulb, Loader2, RotateCcw, ScanLine, Sun, Maximize, Hand } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyseShelf, type AnalysisResult } from '../lib/analyse';
import { addCorrection, type CatalogState } from '../lib/catalog';
import { checkQuality, cropCanvas, loadImageToCanvas, type QualityReport } from '../lib/image';
import { recommend, statusFor, summarise } from '../lib/recommend';
import { normName, type SalesInfo } from '../lib/sales';
import { STATUS_STYLE } from '../lib/settings';
import type { Facing, Settings, Status } from '../lib/types';
import { CorrectionSheet } from './CorrectionSheet';
import { ProductTable, RecommendationList, SummaryBar } from './Recommendations';
import { ShelfCanvas } from './ShelfCanvas';

interface Props {
  settings: Settings;
  catalog: CatalogState | null;
  setCatalog: (c: CatalogState) => void;
  sales: Map<string, SalesInfo> | null;
  goToCatalog: () => void;
}

export function ScanView({ settings, catalog, setCatalog, sales, goToCatalog }: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [facings, setFacings] = useState<Facing[]>([]);
  const [progress, setProgress] = useState<{ msg: string; frac: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Facing | null>(null);
  const [hidden, setHidden] = useState<Set<Status>>(new Set());
  const [dragging, setDragging] = useState(false);

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
    try {
      const c = await loadImageToCanvas(file);
      setImage(c);
      const q = checkQuality(c);
      setQuality(q);
      if (q.ok) await run(c);
    } catch (e) {
      setError(`Could not open that image: ${(e as Error).message}`);
    }
  };

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

  const summary = useMemo(() => summarise(facings, sales, catalog?.products), [facings, sales, catalog]);
  const recs = useMemo(() => recommend(facings, sales, catalog?.products ?? []), [facings, sales, catalog]);

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
    // Feed the confirmed crop back into the catalogue so the next scan recognises it.
    const feat = result.features.get(f.id);
    if (feat && catalog) {
      try {
        const entry = await addCorrection(product, cropCanvas(image, f), feat.emb, feat.hist, catalog.embedderUrl);
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

  const presentStatuses = useMemo(() => [...new Set(facings.map((f) => f.status))], [facings]);
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
              <ScanLine size={16} /> Shelf check
            </div>
            <h1>
              Snap a shelf.
              <br />
              <span className="grad-text">Spot the top sellers.</span>
            </h1>
            <p>
              ShelfScan finds every product, highlights top sellers in <b className="c-top">green</b> and delist candidates in{' '}
              <b className="c-delist">red</b>, then tells you what's missing.
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

          {!catalog?.entries.length && (
            <button className="notice notice-action" onClick={goToCatalog}>
              <Lightbulb size={18} />
              <span>
                <b>No product catalogue loaded yet.</b> You can still count facings, but SKUs won't be identified. Set one up →
              </span>
            </button>
          )}

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
        </>
      ) : (
        <div className="toolbar">
          <button className="btn" onClick={() => camRef.current?.click()} disabled={busy}>
            <Camera size={18} /> New photo
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

      {quality && !quality.ok && !result && !progress && (
        <div className="notice warn">
          {quality.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
          <div className="row">
            <button className="btn" onClick={() => camRef.current?.click()}>
              Retake
            </button>
            <button className="btn primary" onClick={() => run()}>
              Analyse anyway
            </button>
          </div>
        </div>
      )}

      {progress && (
        <div className="card progress">
          <div className="progress-head">
            <Loader2 size={18} className="spin" />
            <span>{progress.msg}</span>
            <span className="muted">{Math.round(progress.frac * 100)}%</span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round(progress.frac * 100)}%` }} />
          </div>
        </div>
      )}

      {result && result.warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}

      {image && (
        <>
          {result && <SummaryBar s={summary} />}
          <ShelfCanvas image={image} facings={facings} hidden={hidden} selectedId={selected?.id ?? null} onSelect={setSelected} />
          {result && (
            <div className="legend">
              {presentStatuses.map((s) => (
                <button key={s} className={`chip ${hidden.has(s) ? 'off' : ''}`} onClick={() => toggle(s)}>
                  <span className="dot" style={{ background: STATUS_STYLE[s].color }} />
                  {STATUS_STYLE[s].label}
                  <span className="chip-count">{facings.filter((f) => f.status === s).length}</span>
                </button>
              ))}
            </div>
          )}
          {result && (
            <p className="meta">
              {result.detector === 'model' ? 'SKU-110K detector' : 'Basic shelf-grid detector'} ·{' '}
              {(result.timings.detect / 1000).toFixed(1)}s detect · {(result.timings.recognise / 1000).toFixed(1)}s recognise · tap any box to check it
            </p>
          )}
          {result && <RecommendationList recs={recs} />}
          {result && <ProductTable s={summary} />}
        </>
      )}

      {selected && image && (
        <CorrectionSheet
          facing={selected}
          crop={cropCanvas(image, selected, 0.05)}
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
