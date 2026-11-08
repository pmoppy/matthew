import { BarChart3, Download, FileSpreadsheet, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  buildCatalog,
  clearCorrections,
  countCorrections,
  exportCorrectionsZip,
  listFromFiles,
  type CatalogState,
  type StoredSales,
} from '../lib/catalog';
import { normName, parseSales } from '../lib/sales';
import { catalogSource, DEFAULT_CATALOG_URL } from '../lib/sync';
import { getEmbedder, type SalesRow, type Settings } from '../lib/types';
import { listScans, scansToCsv } from '../lib/history';
import { shareFile } from '../lib/report';
import type { LibraryStatus } from './ScanView';

interface Props {
  settings: Settings;
  setSettings: (s: Settings) => void;
  catalog: CatalogState | null;
  setCatalog: (c: CatalogState) => void;
  salesRows: SalesRow[];
  sales: StoredSales | null;
  setSales: (v: StoredSales | null) => void;
  library: LibraryStatus;
  onSync: (s: Settings) => void;
}

/** Admin-only: where the product library and sales ranking come from. */
export function CatalogView({ settings, setSettings, catalog, setCatalog, salesRows, sales, setSales, library, onSync }: Props) {
  const folderRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(settings.catalogUrl);
  const [busy, setBusy] = useState<{ msg: string; frac: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [corrections, setCorrections] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    listScans()
      .then((s) => setScanCount(s.length))
      .catch(() => {});
  }, []);

  const exportCsv = async () => {
    setExportMsg(null);
    try {
      const { csv, scans, rows } = await scansToCsv();
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = await shareFile(`ShelfScan-scans-${stamp}.csv`, csv, 'text/csv');
      setExportMsg(`${r === 'shared' ? 'Exported' : 'Downloaded'} ${scans} scans (${rows} rows).`);
    } catch (e) {
      setExportMsg(`Export failed: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    countCorrections().then(setCorrections).catch(() => {});
  }, [catalog]);

  const syncNow = () => {
    setMsg(null);
    const next = { ...settings, catalogUrl: url.trim() };
    setSettings(next);
    onSync(next);
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
        setSales({ text, source: 'manual' });
      }
      if (!refs.length) throw new Error('No images found. Pick the folder that contains one sub-folder per product.');
      const c = await buildCatalog(refs, settings.embedderId, 'Local folder', (m, f) => setBusy({ msg: m, frac: f }));
      setCatalog(c);
      setMsg({ kind: 'ok', text: `Loaded ${c.products.length} products from ${refs.length} images (this device only).` });
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
      setSales({ text, source: 'manual' });
      setMsg({ kind: 'ok', text: `Loaded sales for ${rows.length} products (overrides the library's sales.csv on this device).` });
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

  const products = new Set((catalog?.products ?? []).map(normName));
  const unmatchedSales = catalog ? salesRows.filter((r) => !products.has(normName(r.product))) : [];
  const categories = [...new Set(salesRows.map((r) => r.category).filter(Boolean))];
  const progress = busy ?? (library.state === 'loading' ? { msg: library.msg ?? 'Syncing', frac: library.frac ?? 0 } : null);

  return (
    <div className="view">
      <header className="page-head">
        <h1>Catalogue</h1>
        <p>Admin only. Field users never see this screen. Everything here syncs to their phones automatically.</p>
      </header>

      <div className="card">
        <h2>Product library</h2>
        {catalog ? (
          <p>
            <b>{catalog.products.length}</b> products · {catalog.entries.filter((e) => e.source === 'catalog').length} reference photos ·{' '}
            {catalog.entries.filter((e) => e.source === 'correction').length} from in-store corrections
            <br />
            <span className="muted small">
              {catalog.source} · {getEmbedder(catalog.embedderId).label} · synced {new Date(catalog.updatedAt).toLocaleString()}
            </span>
          </p>
        ) : (
          <p className="muted">Not loaded yet.</p>
        )}
        {library.state === 'error' && <div className="notice error">{library.msg}</div>}

        <h3>Library source</h3>
        <p className="muted small">
          URL of your catalogue Worker in front of the R2 bucket. Leave blank to use the build default (
          <code>{DEFAULT_CATALOG_URL}</code>). To change it for every user, set <code>VITE_CATALOG_URL</code> when deploying.
        </p>
        <div className="row">
          <input className="input" placeholder={DEFAULT_CATALOG_URL} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary" onClick={syncNow} disabled={!!progress}>
            <RefreshCw size={18} /> Sync
          </button>
        </div>
        <p className="muted small">Currently using: {catalogSource(settings)}</p>

        <h3>Test a folder on this device</h3>
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error non-standard but widely supported
          webkitdirectory=""
          onChange={(e) => loadFolder(e.target.files)}
        />
        <button className="btn" onClick={() => folderRef.current?.click()} disabled={!!progress}>
          <FolderOpen size={18} /> Choose catalogue folder
        </button>

        {progress && (
          <div className="progress">
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
        {msg && <div className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>Sales ranking</h2>
        <p className="muted small">
          Comes from <code>sales.csv</code> in the library. Columns: <code>product</code> (matching the folder names), <code>units</code>{' '}
          and/or <code>rank</code>, plus optional <code>category</code> (so each bay is judged against its own category) and{' '}
          <code>status</code> (top / core / delist) to hand-pick must-stock lines.
        </p>
        {salesRows.length > 0 ? (
          <p>
            <b>{salesRows.length}</b> products ranked{categories.length ? ` in ${categories.length} categories (${categories.join(', ')})` : ''} ·
            source: {sales?.source === 'manual' ? 'uploaded on this device' : 'library'}
          </p>
        ) : (
          <p className="muted">No sales ranking loaded.</p>
        )}
        <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => loadCsv(e.target.files?.[0])} />
        <div className="row wrap">
          <button className="btn" onClick={() => csvRef.current?.click()}>
            <FileSpreadsheet size={18} /> Upload override CSV
          </button>
          {sales?.source === 'manual' && (
            <button
              className="btn ghost"
              onClick={() => {
                setSales(null);
                onSync(settings);
              }}
            >
              Use library sales
            </button>
          )}
        </div>
        {catalog && unmatchedSales.length > 0 && (
          <details className="small" style={{ marginTop: 10 }}>
            <summary className="warn-text">{unmatchedSales.length} ranked products have no photos in the library</summary>
            <p className="muted">They can't be recognised, so they're never reported as missing. Add a folder of photos for each.</p>
            <ul>
              {unmatchedSales.slice(0, 60).map((r) => (
                <li key={r.product}>
                  #{r.rank} {r.product}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="card">
        <h2>Scan results export</h2>
        <p className="muted small">
          Every scan saved on this phone as a CSV for Excel, Power BI or Looker Studio: one row per product per scan with date, store, bay,
          product, category, sales rank, result (<code>on_shelf</code>, <code>missing</code>, <code>to_check</code>, <code>slow_seller</code>,{' '}
          <code>core</code>, <code>other</code>), facings and the bay's top-seller score. Each rep can export from their own phone. Combine the
          files to compare stores over time.
        </p>
        <p>
          <b>{scanCount}</b> scans saved on this phone (newest 100 are kept)
        </p>
        <button className="btn" onClick={exportCsv} disabled={!scanCount}>
          <BarChart3 size={18} /> Export scans (CSV)
        </button>
        {exportMsg && <p className="muted small">{exportMsg}</p>}
      </div>

      <div className="card">
        <h2>In-store corrections</h2>
        <p className="muted small">
          When reps confirm an unclear product, the photo is saved on their phone. Download them here and add them to the matching bucket
          folders. Real shelf photos improve recognition more than anything else.
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
