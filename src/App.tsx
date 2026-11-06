import { FolderOpen, ScanLine, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CatalogView } from './components/CatalogView';
import { ScanView } from './components/ScanView';
import { SettingsView } from './components/SettingsView';
import { loadCatalog, loadSalesCsv, saveSalesCsv, type CatalogState } from './lib/catalog';
import { classifySales, parseSales } from './lib/sales';
import { loadSettings, saveSettings } from './lib/settings';
import type { SalesRow, Settings } from './lib/types';

type Tab = 'scan' | 'catalog' | 'settings';

const TABS = [
  { id: 'scan', label: 'Scan', Icon: ScanLine },
  { id: 'catalog', label: 'Catalogue', Icon: FolderOpen },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal },
] as const;

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [salesCsv, setSalesCsvState] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => {});
    loadSalesCsv().then(setSalesCsvState).catch(() => {});
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };
  const setSalesCsv = (t: string | null) => {
    setSalesCsvState(t);
    saveSalesCsv(t).catch(() => {});
  };

  const salesRows: SalesRow[] = useMemo(() => {
    if (!salesCsv) return [];
    try {
      return parseSales(salesCsv);
    } catch {
      return [];
    }
  }, [salesCsv]);
  const sales = useMemo(() => (salesRows.length ? classifySales(salesRows, settings) : null), [salesRows, settings]);
  const ready = !!catalog?.products.length && salesRows.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>ShelfScan</span>
        </div>
        <button className={`status-pill ${ready ? 'ok' : ''}`} onClick={() => setTab('catalog')}>
          <span className="status-dot" />
          {catalog ? `${catalog.products.length} products` : 'No catalogue'}
          {salesRows.length ? ` · ${salesRows.length} ranked` : ''}
        </button>
      </header>
      <main>
        {tab === 'scan' && (
          <ScanView settings={settings} catalog={catalog} setCatalog={setCatalog} sales={sales} goToCatalog={() => setTab('catalog')} />
        )}
        {tab === 'catalog' && (
          <CatalogView
            settings={settings}
            setSettings={setSettings}
            catalog={catalog}
            setCatalog={setCatalog}
            salesRows={salesRows}
            setSalesCsv={setSalesCsv}
          />
        )}
        {tab === 'settings' && <SettingsView settings={settings} setSettings={setSettings} />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon size={20} strokeWidth={tab === id ? 2.4 : 2} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
