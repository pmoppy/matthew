import { FolderOpen, ScanLine, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogView } from './components/CatalogView';
import { ScanView, type LibraryStatus } from './components/ScanView';
import { SettingsView } from './components/SettingsView';
import { leaveAdminMode, readAdminMode } from './lib/admin';
import { loadCatalog, loadSales, saveSales, type CatalogState, type StoredSales } from './lib/catalog';
import { classifySales, parseSales } from './lib/sales';
import { loadSettings, saveSettings } from './lib/settings';
import { needsSync, syncLibrary } from './lib/sync';
import { DEFAULT_DETECTOR_URL, type SalesRow, type Settings } from './lib/types';

type Tab = 'scan' | 'catalog' | 'settings';

const TABS = [
  { id: 'scan', label: 'Scan', Icon: ScanLine },
  { id: 'catalog', label: 'Catalogue', Icon: FolderOpen },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal },
] as const;

export default function App() {
  const [admin, setAdmin] = useState(readAdminMode);
  const [tab, setTab] = useState<Tab>('scan');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [sales, setSalesState] = useState<StoredSales | null>(null);
  const [library, setLibrary] = useState<LibraryStatus>({ state: 'loading', msg: 'Loading product library', frac: 0 });
  const syncing = useRef(false);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };
  const setSales = (v: StoredSales | null) => {
    setSalesState(v);
    saveSales(v).catch(() => {});
  };

  /** Keep the on-device product library in step with the catalogue the admin publishes. */
  const sync = useCallback(
    async (force = false, s: Settings = settings) => {
      if (syncing.current) return;
      syncing.current = true;
      const current = await loadCatalog().catch(() => null);
      if (current) setCatalog(current);
      const storedSales = await loadSalesSafe();
      if (storedSales) setSalesState(storedSales);
      const need = force ? 'full' : needsSync(current, s);
      if (!need) {
        setLibrary({ state: 'ready' });
        syncing.current = false;
        return;
      }
      setLibrary({ state: 'loading', msg: 'Preparing product library', frac: 0 });
      try {
        const res = await syncLibrary(s, (msg, frac) => setLibrary({ state: 'loading', msg, frac }));
        setCatalog(res.catalog);
        // Sales from the library unless the admin uploaded a manual override.
        if (res.salesCsv && storedSales?.source !== 'manual') setSales({ text: res.salesCsv, source: 'library' });
        // A detector published with the catalogue replaces the default one.
        if (res.detectorUrl && (!s.detectorUrl || s.detectorUrl === DEFAULT_DETECTOR_URL) && res.detectorUrl !== s.detectorUrl) {
          setSettings({ ...s, detectorUrl: res.detectorUrl });
        }
        setLibrary({ state: 'ready' });
      } catch (e) {
        console.error('Library sync failed', e);
        // Keep working with the cached library if there is one (e.g. offline in-store).
        setLibrary({ state: current ? 'ready' : 'error', msg: (e as Error).message });
      } finally {
        syncing.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings],
  );

  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const salesRows: SalesRow[] = useMemo(() => {
    if (!sales?.text) return [];
    try {
      return parseSales(sales.text);
    } catch {
      return [];
    }
  }, [sales]);
  const salesMap = useMemo(() => (salesRows.length ? classifySales(salesRows, settings) : null), [salesRows, settings]);

  return (
    <div className={`app ${admin ? 'is-admin' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>ShelfScan</span>
        </div>
        {admin ? (
          <button
            className="status-pill admin"
            onClick={() => {
              leaveAdminMode();
              setAdmin(false);
              setTab('scan');
            }}
            title="Leave admin mode"
          >
            <ShieldCheck size={14} /> Admin · exit
          </button>
        ) : library.state === 'error' ? (
          <span className="status-pill">
            <span className="status-dot" /> Offline
          </span>
        ) : null}
      </header>
      <main>
        {tab === 'scan' && <ScanView settings={settings} catalog={catalog} setCatalog={setCatalog} sales={salesMap} library={library} />}
        {admin && tab === 'catalog' && (
          <CatalogView
            settings={settings}
            setSettings={setSettings}
            catalog={catalog}
            setCatalog={setCatalog}
            salesRows={salesRows}
            sales={sales}
            setSales={setSales}
            library={library}
            onSync={(s) => sync(true, s)}
          />
        )}
        {admin && tab === 'settings' && (
          <SettingsView
            settings={settings}
            setSettings={(s) => {
              const embedderChanged = s.embedderId !== settings.embedderId;
              setSettings(s);
              if (embedderChanged) sync(true, s);
            }}
          />
        )}
        {library.state === 'error' && !catalog && tab === 'scan' && (
          <div className="notice warn" style={{ marginTop: 14 }}>
            The product library couldn't be downloaded. Check your connection and reopen the app.
          </div>
        )}
      </main>
      {admin && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <Icon size={20} strokeWidth={tab === id ? 2.4 : 2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

async function loadSalesSafe() {
  try {
    return await loadSales();
  } catch {
    return null;
  }
}
