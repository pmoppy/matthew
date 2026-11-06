import { useEffect, useMemo, useState } from 'react';
import { CatalogView } from './components/CatalogView';
import { ScanView } from './components/ScanView';
import { SettingsView } from './components/SettingsView';
import { loadCatalog, loadSalesCsv, saveSalesCsv, type CatalogState } from './lib/catalog';
import { classifySales, parseSales } from './lib/sales';
import { loadSettings, saveSettings } from './lib/settings';
import type { SalesRow, Settings } from './lib/types';

type Tab = 'scan' | 'catalog' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [salesCsv, setSalesCsvState] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => {});
    loadSalesCsv().then(setSalesCsvState).catch(() => {});
  }, []);

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>ShelfScan</span>
        </div>
        <span className="muted small">
          {catalog ? `${catalog.products.length} products` : 'No catalogue'} · {salesRows.length ? `${salesRows.length} ranked` : 'No sales'}
        </span>
      </header>
      <main>
        {tab === 'scan' && <ScanView settings={settings} catalog={catalog} setCatalog={setCatalog} sales={sales} />}
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
      <nav className="tabbar">
        {(
          [
            ['scan', '📷', 'Scan'],
            ['catalog', '🗂', 'Catalogue'],
            ['settings', '⚙', 'Settings'],
          ] as const
        ).map(([t, icon, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            <span className="tab-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
