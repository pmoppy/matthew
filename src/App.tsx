import { signedInAs, signOut } from './lib/auth';
import { Activity, Download, FolderOpen, TicketPercent, Monitor, Moon, ScanLine, ShieldCheck, SlidersHorizontal, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogView } from './components/CatalogView';
import { ScanView, type LibraryStatus } from './components/ScanView';
import { SettingsView } from './components/SettingsView';
import { UsageView } from './components/UsageView';
import { CouponsView } from './components/CouponsView';
import { useCoupons } from './lib/coupons';
import { trackOpen } from './lib/usage';
import { enterAdminMode, isAdminUser, leaveAdminMode, readAdminMode } from './lib/admin';
import { checkForApkUpdate, type UpdateInfo } from './lib/update';
import { useShoppingList } from './lib/shopping';
import { applyTheme, loadTheme, NEXT_THEME, type ThemeChoice } from './lib/theme';
import { Capacitor } from '@capacitor/core';
import { loadCatalog, loadSales, saveSales, type CatalogState, type StoredSales } from './lib/catalog';
import { classifySales, parseSales } from './lib/sales';
import { loadSettings, saveSettings } from './lib/settings';
import { catalogSource, fetchLibrarySales, libraryChanged, modelsCached, needsSync, prepareModels, syncLibrary } from './lib/sync';
import { DEFAULT_DETECTOR_URL, type SalesRow, type Settings } from './lib/types';

type Tab = 'scan' | 'catalog' | 'usage' | 'settings';

const TABS = [
  { id: 'scan', label: 'Scan', Icon: ScanLine },
  { id: 'catalog', label: 'Catalogue', Icon: FolderOpen },
  { id: 'usage', label: 'Usage', Icon: Activity },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal },
] as const;

export default function App() {
  const [admin, setAdmin] = useState(readAdminMode);
  const [tab, setTab] = useState<Tab>('scan');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const offers = useCoupons(catalogSource(settings));
  const coupons = offers.coupons;
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [sales, setSalesState] = useState<StoredSales | null>(null);
  const [library, setLibrary] = useState<LibraryStatus>({ state: 'loading', msg: 'Loading product library', frac: 0 });
  const syncing = useRef(false);
  const list = useShoppingList();
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const scanBack = useRef<(() => boolean) | null>(null);
  const [couponsOpen, setCouponsOpen] = useState(false);
  const couponsRef = useRef(couponsOpen);
  couponsRef.current = couponsOpen;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Android hardware/gesture back button (APK only).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) =>
      CapApp.addListener('backButton', () => {
        if (couponsRef.current) setCouponsOpen(false);
        else if (tabRef.current !== 'scan') setTab('scan');
        else if (!scanBack.current?.()) CapApp.exitApp();
      }).then((h) => (remove = () => h.remove())),
    );
    return () => remove?.();
  }, []);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    checkForApkUpdate().then(setUpdate);
    trackOpen();
    // Android keeps the app alive in the background, so also check whenever it
    // comes back to the screen (at most every 10 minutes), not only on a cold start.
    let last = Date.now();
    const recheck = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10 * 60e3) return;
      last = Date.now();
      checkForApkUpdate().then(setUpdate);
      trackOpen();
    };
    document.addEventListener('visibilitychange', recheck);
    let remove: (() => void) | undefined;
    if (Capacitor.isNativePlatform())
      import('@capacitor/app').then(({ App: CapApp }) => CapApp.addListener('resume', recheck).then((h) => (remove = () => h.remove())));
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      remove?.();
    };
  }, []);

  // Hidden admin switch for the APK (no address bar for ?admin=1): tap the logo 7 times within 3 seconds.
  const onLogoTap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 7 && !admin && isAdminUser()) {
      taps.current = [];
      enterAdminMode();
      setAdmin(true);
    }
  };

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
      let need = force ? 'full' : needsSync(current, s);
      if (!need && current && (await libraryChanged(current, s))) need = 'refresh';
      // Keep the sales ranking current even when the photos haven't changed.
      if (!need && storedSales?.source !== 'manual') {
        const latest = await fetchLibrarySales(s);
        if (latest && latest !== storedSales?.text) setSales({ text: latest, source: 'library' });
      }
      if (!need) {
        setLibrary({ state: 'ready' });
        syncing.current = false;
        warmUp(s);
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
        // First run: fetch the models now (with progress) rather than on the first scan.
        if (!(await modelsCached(s).catch(() => true))) {
          await prepareModels(s, (msg, frac) => setLibrary({ state: 'loading', msg, frac })).catch((e) => console.warn(e));
        }
        setLibrary({ state: 'ready' });
        warmUp(s);
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
    // Re-check the library when the app returns to the foreground (at most every 30 min).
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30 * 60 * 1000) {
        last = Date.now();
        sync();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
        <div className="brand" onClick={onLogoTap}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={32} height={32} />
          <span>ShelfScan</span>
        </div>
        <div className="topbar-actions">
          {coupons.length > 0 && (
            <button className="coupon-btn" onClick={() => setCouponsOpen(true)} aria-label={`Offers: ${coupons.length} coupons`} title="Offers & coupons">
              <TicketPercent size={20} />
              <span className="coupon-badge">{coupons.length}</span>
            </button>
          )}
          <button
            className="theme-btn"
            onClick={() => setTheme(NEXT_THEME[theme])}
            aria-label={`Theme: ${theme}. Tap to change`}
            title="Light / dark mode"
          >
            {theme === 'light' ? <Sun size={15} /> : theme === 'dark' ? <Moon size={15} /> : <Monitor size={15} />}
            {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto'}
          </button>
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
          ) : isAdminUser() ? (
            <button
              className="status-pill admin"
              onClick={() => {
                enterAdminMode();
                setAdmin(true);
              }}
              title="Open the admin area"
            >
              <ShieldCheck size={14} /> Admin
            </button>
          ) : library.state === 'error' ? (
            <span className="status-pill">
              <span className="status-dot" /> Offline
            </span>
          ) : null}
        </div>
      </header>
      {update && (
        <div className="update-banner">
          <span>
            <b>New version available</b> (build {update.build})
          </span>
          <button className="btn primary" onClick={() => (window.location.href = update.url)}>
            <Download size={16} /> Download
          </button>
        </div>
      )}
      <main>
        {tab === 'scan' && <ScanView settings={settings} catalog={catalog} setCatalog={setCatalog} sales={salesMap} library={library} list={list} backRef={scanBack} coupons={coupons} onOpenOffers={() => setCouponsOpen(true)} />}
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
        {admin && tab === 'usage' && <UsageView />}
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
            The product library couldn't be downloaded ({library.msg}). Check your connection and{' '}
            <button className="btn ghost" onClick={() => location.reload()}>
              try again
            </button>
          </div>
        )}
      </main>
      {tab === 'scan' && (
        <button
          className="btn ghost signout"
          onClick={() => {
            if (confirm('Sign out of ShelfScan on this device?')) {
              signOut();
              location.reload();
            }
          }}
        >
          Signed in as {signedInAs() ?? 'tester'} · Sign out
        </button>
      )}
      {tab === 'scan' && <p className="app-version">{__BUILD_NUMBER__ ? `ShelfScan build ${__BUILD_NUMBER__}` : `ShelfScan web · updated ${new Date(__BUILT_AT__).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</p>}
      {couponsOpen && <CouponsView coupons={coupons} balance={offers.balance} balanceNote={offers.balanceNote} onClose={() => setCouponsOpen(false)} />}
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

/** Load already-downloaded models in the background so the first scan starts instantly. */
function warmUp(s: Settings) {
  modelsCached(s)
    .then((ok) => (ok ? prepareModels(s, () => {}) : undefined))
    .catch(() => {});
}

async function loadSalesSafe() {
  try {
    return await loadSales();
  } catch {
    return null;
  }
}
