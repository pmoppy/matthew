import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { signedInAs } from '../lib/auth';
import { fetchUsage, type UsageEvent } from '../lib/usage';

const LABEL: Record<string, string> = {
  sign_in: 'Signed in',
  app_open: 'Opened the app',
  scan: 'Top-seller scan',
  planogram_check: 'Planogram check',
  media_open: 'Opened in media hub',
  pdf_report: 'Shared PDF report',
  coupons_added: 'Added offers to basket',
  basket_sent: 'Sent order basket',
};
const PASS_KEY = 'shelfscan.usagePass';

function when(at: number) {
  return new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Admin only: who has used the app, from the usage log on Cloudflare. */
export function UsageView() {
  const user = signedInAs() ?? '';
  const [pass, setPass] = useState(() => sessionStorage.getItem(PASS_KEY) ?? '');
  const [events, setEvents] = useState<UsageEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<string>('');

  const load = async (p = pass) => {
    setBusy(true);
    setError(null);
    try {
      setEvents(await fetchUsage(user, p));
      try {
        sessionStorage.setItem(PASS_KEY, p);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError((e as Error).message === 'Failed to fetch' ? "Couldn't reach the usage log. Check your connection." : (e as Error).message);
      setEvents(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (pass) void load(pass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const people = useMemo(() => {
    const m = new Map<string, { last: number; scans: number; checks: number; device: string }>();
    for (const e of events ?? []) {
      const p = m.get(e.u) ?? { last: 0, scans: 0, checks: 0, device: '' };
      if (e.at > p.last) {
        p.last = e.at;
        p.device = [e.a, e.v].filter(Boolean).join(' · ');
      }
      if (e.t === 'scan') p.scans++;
      if (e.t === 'planogram_check') p.checks++;
      m.set(e.u, p);
    }
    return [...m.entries()].sort((a, b) => b[1].last - a[1].last);
  }, [events]);
  const shown = (events ?? []).filter((e) => !who || e.u === who);

  return (
    <div className="view">
      <header className="page-head">
        <h1>Usage</h1>
        <p>Who has used ShelfScan and what they did. Kept for 180 days on your Cloudflare account. No photos are sent.</p>
      </header>

      {!events && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <h2>Admin password</h2>
          <p className="muted small">Enter the password for {user} again to open the usage log.</p>
          <div className="row">
            <input className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <button className="btn primary" disabled={!pass || busy}>
              {busy ? <Loader2 size={18} className="spin" /> : null} Open
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
        </form>
      )}

      {events && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>People</h2>
              <button className="btn ghost" onClick={() => load()} disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Refresh
              </button>
            </div>
            {!people.length ? (
              <p className="muted">Nobody has used the app since the usage log was switched on.</p>
            ) : (
              <ul className="usage-people">
                {people.map(([u, p]) => (
                  <li key={u}>
                    <button className={`usage-person ${who === u ? 'on' : ''}`} onClick={() => setWho(who === u ? '' : u)}>
                      <b>{u}</b>
                      <span className="muted small">
                        last seen {when(p.last)} · {p.scans} scan{p.scans === 1 ? '' : 's'} · {p.checks} planogram check{p.checks === 1 ? '' : 's'}
                        {p.device ? ` · ${p.device}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>{who ? `Activity: ${who}` : 'All activity'}</h2>
            {!shown.length ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <ul className="usage-log">
                {shown.slice(0, 300).map((e, i) => (
                  <li key={i}>
                    <span className="usage-when">{when(e.at)}</span>
                    <span>
                      <b>{e.u}</b> {LABEL[e.t] ?? e.t}
                      {e.d && <small>{e.d}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
