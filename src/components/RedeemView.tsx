import { ArrowLeft, Camera, CheckCircle2, CircleAlert, Loader2, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CatalogState } from '../lib/catalog';
import { detectOffer, giveClaimConsent, hasClaimConsent, previousScanNote, submitClaim, type Claim, type Detection } from '../lib/claims';
import { money, type Coupon } from '../lib/coupons';
import { loadImageToCanvas } from '../lib/image';
import type { SalesInfo } from '../lib/sales';
import { saveStore } from '../lib/stores';
import type { Settings } from '../lib/types';
import { track } from '../lib/usage';
import { StorePicker } from './StorePicker';

/** Draw the photo with the offer's product outlined in green. */
function PhotoWithBoxes({ image, boxes }: { image: HTMLCanvasElement; boxes: number[][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    c.width = Math.round(image.width * scale);
    c.height = Math.round(image.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0, c.width, c.height);
    const lw = Math.max(3, c.width / 160);
    for (const [x1, y1, x2, y2] of boxes) {
      ctx.lineWidth = lw + 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeRect(x1 * scale, y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#3b7a55';
      ctx.strokeRect(x1 * scale, y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);
    }
  }, [image, boxes]);
  return <canvas ref={ref} className="redeem-photo" />;
}

/**
 * Redeem an offer: choose the offer, take a photo of the shelf in the app,
 * see whether the product was spotted, then send the claim for review.
 */
export function RedeemView({
  coupons,
  initial,
  store: initialStore,
  catalog,
  sales,
  settings,
  onClose,
  onSent,
}: {
  coupons: Coupon[];
  initial: Coupon;
  store: string;
  catalog: CatalogState | null;
  sales: Map<string, SalesInfo> | null;
  settings: Settings;
  onClose: () => void;
  onSent: (c: Claim) => void;
}) {
  const [coupon, setCoupon] = useState(initial);
  const [store, setStore] = useState(initialStore);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [takenAt, setTakenAt] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [det, setDet] = useState<Detection | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (waiting && image && catalog?.entries.length) {
      setWaiting(false);
      void run(image, coupon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, catalog, image]);

  const run = async (img: HTMLCanvasElement, c: Coupon) => {
    setDet(null);
    setError(null);
    if (!catalog?.entries.length) {
      // Checked automatically as soon as the library is ready (see effect below).
      setProgress('Getting the product library ready…');
      setWaiting(true);
      return;
    }
    setProgress('Checking the shelf…');
    try {
      setDet(await detectOffer(img, c, catalog, sales, settings, (m) => setProgress(m)));
    } catch (e) {
      setError(`Couldn't check the photo: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const img = await loadImageToCanvas(f, 2400);
      setImage(img);
      setTakenAt(Date.now());
      await run(img, coupon);
    } catch (e) {
      setError(`Could not open that photo: ${(e as Error).message}`);
    }
  };

  const changeOffer = (id: string) => {
    const c = coupons.find((x) => x.id === id);
    if (!c) return;
    setCoupon(c);
    if (image) void run(image, c);
  };

  const submit = async () => {
    if (!image || !det || !store.trim()) return;
    if (!hasClaimConsent()) {
      if (!confirm('Your shelf photo will be sent to ShelfScan so we can check your claim. Shelf scans stay on your phone as before. Continue?')) return;
      giveClaimConsent();
    }
    setSending(true);
    setError(null);
    try {
      const prev = await previousScanNote(store.trim(), coupon);
      const claim = await submitClaim({ coupon, store: store.trim(), image, detection: det, prev });
      track('offer_claim', `${store.trim()} · ${coupon.brand} ${coupon.offer} · ${det.found ? `spotted (${det.facings})` : 'not spotted'}`);
      onSent(claim);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cp-screen redeem" role="dialog" aria-label="Redeem offer">
      <header className="cp-head">
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h2 className="tool-title">Redeem offer</h2>
      </header>
      <div className="cp-body redeem-body">
        <h3 className="redeem-step">1 · Offer</h3>
        <label className="redeem-offer">
          <span className="coupon-img small">{coupon.imageUrl ? <img src={coupon.imageUrl} alt="" /> : null}</span>
          <span className="redeem-offer-text">
            <b>{coupon.product}</b>
            <small>
              {coupon.offer} · {money(coupon.saving)} when approved
            </small>
          </span>
          <select value={coupon.id} onChange={(e) => changeOffer(e.target.value)} aria-label="Change offer">
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.brand}: {c.offer}
              </option>
            ))}
          </select>
          <span className="redeem-change">Change</span>
        </label>

        {!initialStore && (
          <>
            <h3 className="redeem-step">Store</h3>
            <StorePicker
              value={store}
              onChange={(v) => {
                setStore(v);
                saveStore(v);
              }}
              compact
            />
          </>
        )}

        <h3 className="redeem-step">2 · Photo of the shelf</h3>
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void onPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {!image ? (
          <button className="redeem-shoot" onClick={() => camRef.current?.click()}>
            <Camera size={28} />
            <b>Take a photo of the shelf</b>
            <small>Show the {coupon.brand} product clearly, front-on</small>
          </button>
        ) : (
          <div className="card redeem-card">
            <PhotoWithBoxes image={image} boxes={det?.boxes ?? []} />
            <div className="redeem-meta">
              <span className="muted small">
                {store || 'No store'} · {new Date(takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button className="btn ghost" onClick={() => camRef.current?.click()} disabled={!!progress || sending}>
                <RotateCcw size={15} /> Retake
              </button>
            </div>
          </div>
        )}

        {progress && (
          <div className="redeem-result busy">
            <Loader2 size={18} className="spin" /> {progress}
          </div>
        )}
        {det &&
          (det.found ? (
            <div className="redeem-result ok">
              <CheckCircle2 size={20} />
              <span>
                <b>{coupon.product} spotted on shelf</b>
                <small>
                  {det.facings} facing{det.facings > 1 ? 's' : ''} found, outlined in green. We'll check your photo.
                </small>
              </span>
            </div>
          ) : (
            <div className="redeem-result warn">
              <CircleAlert size={20} />
              <span>
                <b>We couldn't spot {coupon.product}</b>
                <small>Retake closer and front-on, or send it anyway and we'll check by eye.</small>
              </span>
            </div>
          ))}

        {error && <div className="notice error">{error}</div>}

        <button className="btn primary full redeem-submit" onClick={submit} disabled={!image || !det || !store.trim() || sending || !!progress}>
          {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />} Submit claim
        </button>
        <p className="muted small cp-note">
          {!store.trim() ? 'Pick your store first. ' : ''}You'll see it under My claims as Pending until we approve it.
        </p>
      </div>
    </div>
  );
}
