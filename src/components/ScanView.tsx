import { useMemo, useRef, useState } from 'react';
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
}

export function ScanView({ settings, catalog, setCatalog, sales }: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [facings, setFacings] = useState<Facing[]>([]);
  const [progress, setProgress] = useState<{ msg: string; frac: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Facing | null>(null);
  const [hidden, setHidden] = useState<Set<Status>>(new Set());

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setFacings([]);
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

  return (
    <div className="view">
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={libRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {!image && (
        <div className="hero card">
          <h2>Scan a shelf</h2>
          <p className="muted">
            Stand square-on to one bay, fit the whole bay in frame, and avoid glare. The app finds every product, highlights top
            sellers in <b style={{ color: STATUS_STYLE.top.color }}>green</b> and delist candidates in{' '}
            <b style={{ color: STATUS_STYLE.delist.color }}>red</b>, then lists what is missing.
          </p>
          {!catalog?.entries.length && (
            <p className="notice">No product catalogue loaded yet. You can still scan to count facings, but SKUs won't be identified.</p>
          )}
        </div>
      )}

      <div className="actions">
        <button className="btn primary big" onClick={() => camRef.current?.click()} disabled={!!progress}>
          📷 Take photo
        </button>
        <button className="btn big" onClick={() => libRef.current?.click()} disabled={!!progress}>
          🖼 Choose photo
        </button>
      </div>

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
        <div className="progress card">
          <div>{progress.msg}</div>
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
                  {STATUS_STYLE[s].label} ({facings.filter((f) => f.status === s).length})
                </button>
              ))}
            </div>
          )}
          {result && (
            <p className="muted small">
              {result.detector === 'model' ? 'Detector model' : 'Basic shelf-grid detector (no model configured)'} ·{' '}
              {(result.timings.detect / 1000).toFixed(1)}s detect · {(result.timings.recognise / 1000).toFixed(1)}s recognise
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
