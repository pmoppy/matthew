import { Check, CheckCircle2, CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { signedInAs } from '../lib/auth';
import { adminClaims, claimPhoto, reviewClaim, type Claim, type ClaimStatus } from '../lib/claims';
import { money } from '../lib/coupons';
import { track } from '../lib/usage';

const PASS_KEY = 'shelfscan.usagePass';

function when(at: number) {
  return new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The claim photo with the detected product outlined, loaded with the admin login. */
function ClaimPhoto({ id, admin }: { id: string; admin: { user: string; pass: string } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let url = '';
    let live = true;
    claimPhoto(id, admin)
      .then(({ url: u, boxes }) => {
        url = u;
        const img = new Image();
        img.onload = () => {
          if (!live) return;
          const c = ref.current!;
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const lw = Math.max(3, img.width / 160);
          for (const [x1, y1, x2, y2] of boxes) {
            ctx.lineWidth = lw + 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            ctx.lineWidth = lw;
            ctx.strokeStyle = '#3b7a55';
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          }
          setState('ok');
        };
        img.onerror = () => live && setState('error');
        img.src = u;
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, admin]);
  return (
    <div className="claim-photo">
      <canvas ref={ref} style={{ display: state === 'ok' ? 'block' : 'none' }} />
      {state === 'loading' && (
        <p className="muted small">
          <Loader2 size={14} className="spin" /> Loading photo…
        </p>
      )}
      {state === 'error' && <p className="muted small">Photo not available.</p>}
    </div>
  );
}

/** Admin only: offer claims from retailers, to approve (adds to the store's balance) or reject. */
export function ClaimsAdminView() {
  const user = signedInAs() ?? '';
  const [pass, setPass] = useState(() => sessionStorage.getItem(PASS_KEY) ?? '');
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClaimStatus>('pending');
  const admin = useMemo(() => ({ user, pass }), [user, pass]);

  const load = async (p = pass) => {
    setBusy('load');
    setError(null);
    try {
      setClaims(await adminClaims(user, p));
      try {
        sessionStorage.setItem(PASS_KEY, p);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError((e as Error).message === 'not an admin login' ? 'Wrong admin password.' : (e as Error).message);
      setClaims(null);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (pass) void load(pass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const review = async (c: Claim, status: 'approved' | 'rejected') => {
    let reason = '';
    if (status === 'rejected') {
      const r = prompt('Reason (shown to the retailer):', c.found ? 'Product not clear in the photo' : 'Product not visible in the photo');
      if (r === null) return;
      reason = r.trim();
    }
    setBusy(c.key);
    try {
      const done = await reviewClaim(user, pass, c.key, status, reason);
      setClaims((cs) => (cs ?? []).map((x) => (x.key === c.key ? done : x)));
      track('claim_review', `${status} · ${c.store} · ${c.title}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of claims ?? []) counts[c.status]++;
  const shown = (claims ?? []).filter((c) => c.status === filter);

  return (
    <div className="view">
      <header className="page-head">
        <h1>Claims</h1>
        <p>Offers retailers have redeemed with a shelf photo. Approving adds the saving to that store's balance.</p>
      </header>

      {!claims ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <h2>Admin password</h2>
          <p className="muted small">Enter the password for {user} again to review claims.</p>
          <div className="row">
            <input className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <button className="btn primary" disabled={!pass || !!busy}>
              {busy ? <Loader2 size={18} className="spin" /> : null} Open
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
        </form>
      ) : (
        <>
          <div className="row wrap claims-filter">
            {(['pending', 'approved', 'rejected'] as const).map((s) => (
              <button key={s} className={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
                {s[0].toUpperCase() + s.slice(1)} <span className="chip-count">{counts[s]}</span>
              </button>
            ))}
            <button className="btn ghost" onClick={() => load()} disabled={!!busy} style={{ marginLeft: 'auto' }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
          {!shown.length && <p className="muted">No {filter} claims.</p>}
          {shown.map((c) => (
            <section key={c.key} className="card claim-review">
              <h3>
                {c.store} · {c.title}
              </h3>
              {c.status === 'pending' && <ClaimPhoto id={c.id} admin={admin} />}
              <div className={`redeem-result ${c.found ? 'ok' : 'warn'}`}>
                {c.found ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}
                <span>
                  <b>{c.found ? `Detected: ${c.product}` : `Not detected: ${c.product}`}</b>
                  <small>{c.found ? `${c.facings} facing${c.facings > 1 ? 's' : ''} · match ${c.conf}%` : 'Check the photo by eye'}</small>
                </span>
              </div>
              <div className="kv">
                <span>Sent by</span>
                <span>{c.u}</span>
                <span>Photo taken</span>
                <span>{when(c.at)} · in-app camera</span>
                <span>Previous scan</span>
                <span>{c.prev ? c.prev.replace(': not on shelf', ': not on shelf → new listing') : 'No earlier scan on this phone'}</span>
                <span>Saving</span>
                <span>{money(c.saving)}</span>
                {c.status !== 'pending' && (
                  <>
                    <span>{c.status === 'approved' ? 'Approved' : 'Rejected'}</span>
                    <span>
                      {c.reviewedAt ? when(c.reviewedAt) : ''}
                      {c.reason ? ` · ${c.reason}` : ''}
                    </span>
                  </>
                )}
              </div>
              {c.status === 'pending' && (
                <div className="claim-actions">
                  <button className="btn reject" onClick={() => review(c, 'rejected')} disabled={!!busy}>
                    <X size={16} /> Reject…
                  </button>
                  <button className="btn approve" onClick={() => review(c, 'approved')} disabled={!!busy}>
                    {busy === c.key ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Approve {money(c.saving)}
                  </button>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
