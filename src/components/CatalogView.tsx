import { Download, FileSpreadsheet, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  buildCatalog,
  clearCorrections,
  countCorrections,
  exportCorrectionsZip,
  listFromFiles,
  listFromWorker,
  type CatalogState,
} from '../lib/catalog';
import { parseSales } from '../lib/sales';
import { DEFAULT_DETECTOR_URL, type SalesRow, type Settings } from '../lib/types';

interface Props {
  settings: Settings;
  setSettings: (s: Settings) => void;
  catalog: CatalogState | null;
  setCatalog: (c: CatalogState) => void;
  salesRows: SalesRow[];
  setSalesCsv: (text: string | null) => void;
}

export function CatalogView({ settings, setSettings, catalog, setCatalog, salesRows, setSalesCsv }: Props) {
  const folderRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(settings.catalogUrl);
  const [busy, setBusy] = useState<{ msg: string; frac: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [corrections, setCorrections] = useState(0);

  useEffect(() => {
    countCorrections().then(setCorrections).catch(() => {});
  }, [catalog]);

  const progress = (m: string, f: number) => setBusy({ msg: m, frac: f });

  const syncWorker = async () => {
    setMsg(null);
    const base = url.trim();
    if (!base) return;
    setBusy({ msg: 'Reading catalogue…', frac: 0 });
    try {
      const { refs, salesUrl, detectorUrl } = await listFromWorker(base);
      const next = { ...settings, catalogUrl: base };
      // A detector stored in the bucket (your own trained model) replaces the
      // default one, unless a different URL was entered manually.
      if (detectorUrl && (!settings.detectorUrl || settings.detectorUrl === DEFAULT_DETECTOR_URL)) next.detectorUrl = detectorUrl;
      setSettings(next);
      if (salesUrl) {
        const r = await fetch(salesUrl, { cache: 'no-store' });
        if (r.ok) {
          const text = await r.text();
          parseSales(text);
          setSalesCsv(text);
        }
      }
      if (!refs.length) throw new Error('No product images found. Expected folders named by product, with images inside.');
      const c = await buildCatalog(refs, settings.embedderUrl, base, progress);
      setCatalog(c);
      setMsg({ kind: 'ok', text: `Loaded ${c.products.length} products from ${refs.length} images.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const loadFolder = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    setBusy({ msg: 'Reading folder…', frac: 0 });
    try {
      const { refs, salesFile } = listFromFiles(files);
      if (salesFile) {
        const text = await salesFile.text();
        parseSales(text);
        setSalesCsv(text);
      }
      if (!refs.length) throw new Error('No images found. Pick the folder that contains one sub-folder per product.');
      const c = await buildCatalog(refs, settings.embedderUrl, 'Local folder', progress);
      setCatalog(c);
      setMsg({ kind: 'ok', text: `Loaded ${c.products.length} products from ${refs.length} images.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const loadCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseSales(text);
      setSalesCsv(text);
      setMsg({ kind: 'ok', text: `Loaded sales for ${rows.length} products.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const download = async () => {
    const zip = await exportCorrectionsZip();
    if (!zip) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `shelfscan-corrections-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const unmatchedSales = catalog
    ? salesRows.filter((r) => !catalog.products.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '') === r.product.toLowerCase().replace(/[^a-z0-9]/g, '')))
    : [];

  return (
    <div className="view">
      <header className="page-head">
        <h1>Catalogue</h1>
        <p>Product photos, sales data and the corrections your team has made.</p>
      </header>
      <div className="card">
        <h2>Product catalogue</h2>
        {catalog ? (
          <p>
            <b>{catalog.products.length}</b> products · {catalog.entries.filter((e) => e.source === 'catalog').length} reference images ·{' '}
            {catalog.entries.filter((e) => e.source === 'correction').length} learned from corrections
            <br />
            <span className="muted small">
              Source: {catalog.source} · updated {new Date(catalog.updatedAt).toLocaleString()}
            </span>
          </p>
        ) : (
          <p className="muted">No catalogue loaded.</p>
        )}

        <h3>From your image bucket</h3>
        <p className="muted small">
          The URL of the ShelfScan catalogue Worker in front of your Cloudflare R2 bucket. The bucket should contain one folder per
          product with photos inside, plus an optional <code>sales.csv</code> and <code>models/detector.onnx</code>.
        </p>
        <div className="row">
          <input className="input" placeholder="https://shelfscan-catalog.example.workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary" onClick={syncWorker} disabled={!!busy || !url.trim()}>
            <RefreshCw size={18} /> Sync
          </button>
        </div>

        <h3>Or from a folder on this device</h3>
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error non-standard but widely supported
          webkitdirectory=""
          onChange={(e) => loadFolder(e.target.files)}
        />
        <button className="btn" onClick={() => folderRef.current?.click()} disabled={!!busy}>
          <FolderOpen size={18} /> Choose catalogue folder
        </button>

        {busy && (
          <div className="progress">
            <div className="progress-head">
              <Loader2 size={18} className="spin" />
              <span>{busy.msg}</span>
            </div>
            <div className="bar">
              <div style={{ width: `${Math.round(busy.frac * 100)}%` }} />
            </div>
            <p className="muted small">The first sync downloads the recognition model (~90 MB) and learns each image. Later syncs only process new images.</p>
          </div>
        )}
        {msg && <div className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>Sales data</h2>
        <p className="muted small">
          CSV with a <code>product</code> column (matching the folder names) and <code>units</code> and/or <code>rank</code>. Top{' '}
          {settings.topSellerPercent}% count as top sellers and bottom {settings.delistPercent}% as delist candidates (change this in
          Settings).
        </p>
        <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => loadCsv(e.target.files?.[0])} />
        <div className="row">
          <button className="btn" onClick={() => csvRef.current?.click()}>
            <FileSpreadsheet size={18} /> Upload sales CSV
          </button>
          {salesRows.length > 0 && (
            <button className="btn ghost" onClick={() => setSalesCsv(null)}>
              Remove
            </button>
          )}
        </div>
        {salesRows.length > 0 && (
          <>
            <p>
              <b>{salesRows.length}</b> products ranked. Best seller: {salesRows[0].product}
            </p>
            {catalog && unmatchedSales.length > 0 && (
              <details>
                <summary className="warn-text">{unmatchedSales.length} products in the sales file have no catalogue images</summary>
                <p className="muted small">These can't be recognised, so they won't be reported as missing. Add a folder for each one.</p>
                <ul className="small">
                  {unmatchedSales.slice(0, 40).map((r) => (
                    <li key={r.product}>
                      #{r.rank} {r.product}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Corrections</h2>
        <p className="muted small">
          Each product you confirm or correct is saved as a labelled photo. Download them and add them to your bucket folders, or use them
          to train the detector. Real shelf photos improve accuracy more than anything else.
        </p>
        <p>
          <b>{corrections}</b> saved on this device
        </p>
        <div className="row">
          <button className="btn" onClick={download} disabled={!corrections}>
            <Download size={18} /> Download ZIP
          </button>
          <button
            className="btn ghost"
            disabled={!corrections}
            onClick={async () => {
              if (confirm('Delete all saved corrections from this device?')) {
                await clearCorrections();
                setCorrections(0);
              }
            }}
          >
            <Trash2 size={18} /> Clear
          </button>
        </div>
      </div>
    </div>
  );
}
