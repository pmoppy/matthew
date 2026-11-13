import { ArrowLeft, Check, Minus, Plus, Send, ShoppingBasket, Star, TicketPercent, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { basketLines, basketTotals, loadBasket, money, orderText, saveBasket, type Basket, type Coupon } from '../lib/coupons';
import { shareText } from '../lib/shopping';
import { loadStore } from '../lib/stores';
import { track } from '../lib/usage';

function ends(d?: string) {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00`);
  return isNaN(t.getTime()) ? d : `Ends ${t.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function CouponCard({ c, selected, inBasket, onToggle }: { c: Coupon; selected: boolean; inBasket: boolean; onToggle: () => void }) {
  return (
    <button
      className={`coupon ${selected ? 'on' : ''}`}
      style={{ '--cp': c.colour ?? 'var(--brand)' } as React.CSSProperties}
      onClick={onToggle}
      aria-pressed={selected}
    >
      <span className="coupon-img">{c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" /> : <TicketPercent size={28} />}</span>
      <span className="coupon-body">
        <small className="coupon-brand">
          {c.featured && <Star size={12} className="coupon-star" fill="currentColor" />}
          {c.brand}
        </small>
        <b className="coupon-offer">{c.offer}</b>
        <span className="coupon-title">{c.title}</span>
        <small className="coupon-meta">
          Min {c.minCases} · {c.pack} · {ends(c.ends)}
        </small>
      </span>
      <span className="coupon-tick" aria-hidden>
        {selected ? <Check size={16} strokeWidth={3} /> : null}
      </span>
      {inBasket && !selected && <span className="coupon-flag">In basket</span>}
    </button>
  );
}

/** Retailer offers: pick coupons, then a pre-filled order basket for the wholesaler. */
export function CouponsView({
  coupons,
  balance = 0,
  balanceNote,
  onClose,
}: {
  coupons: Coupon[];
  balance?: number;
  balanceNote?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'offers' | 'basket'>('offers');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [basket, setBasketState] = useState<Basket>(loadBasket);
  const [toast, setToast] = useState<string | null>(null);
  const setBasket = (b: Basket) => {
    setBasketState(b);
    saveBasket(b);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const lines = useMemo(() => basketLines(basket, coupons), [basket, coupons]);
  const totals = basketTotals(lines);
  const pickedSaving = coupons.filter((c) => picked.has(c.id)).reduce((n, c) => n + c.saving, 0);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addPicked = () => {
    const b = { ...basket };
    const added = coupons.filter((c) => picked.has(c.id));
    for (const c of added) b[c.id] = Math.max(b[c.id] ?? 0, c.minCases);
    setBasket(b);
    track('coupons_added', added.map((c) => c.offer + ' ' + c.brand).join(', '));
    setPicked(new Set());
    setTab('basket');
  };

  const setCases = (id: string, n: number) => {
    const b = { ...basket };
    if (n <= 0) delete b[id];
    else b[id] = n;
    setBasket(b);
  };

  const send = async () => {
    const store = loadStore().trim() || undefined;
    const r = await shareText('Order', orderText(lines, store));
    track('basket_sent', `${store ?? 'no store picked'} · ${totals.cases} cases · ${money(totals.total)} · saved ${money(totals.savings)}`);
    if (r === 'copied') setToast('Order copied: paste it into your wholesaler app or email');
    else if (r === 'failed') setToast("Couldn't share the order");
  };

  return (
    <div className="cp-screen" role="dialog" aria-label="Offers and basket">
      <header className="cp-head">
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="cp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'offers'} className={tab === 'offers' ? 'on' : ''} onClick={() => setTab('offers')}>
            <TicketPercent size={16} /> Offers
          </button>
          <button role="tab" aria-selected={tab === 'basket'} className={tab === 'basket' ? 'on' : ''} onClick={() => setTab('basket')}>
            <ShoppingBasket size={16} /> Basket{lines.length ? ` (${lines.length})` : ''}
          </button>
        </div>
      </header>

      {tab === 'offers' ? (
        <div className="cp-body">
          <div className="cp-summary">
            <div>
              <span className="cp-summary-label">
                <TicketPercent size={15} /> Available offers
              </span>
              <b>{money(coupons.reduce((n, c) => n + c.saving, 0))}</b>
              <small>
                {coupons.length} offer{coupons.length === 1 ? '' : 's'} to claim
              </small>
            </div>
            <div>
              <span className="cp-summary-label">
                <Wallet size={15} /> Your balance
              </span>
              <b>{money(balance)}</b>
              <small>{balanceNote ?? 'Cashback earned'}</small>
            </div>
          </div>
          <p className="muted small cp-intro">Tap the offers you want, then add them to your basket.</p>
          {!coupons.length && <p className="muted">No offers right now. Check back soon.</p>}
          {coupons.some((c) => c.featured) && (
            <>
              <h3 className="cp-section">
                <Star size={15} fill="currentColor" /> Featured offers
              </h3>
              <div className="coupon-list">
                {coupons
                  .filter((c) => c.featured)
                  .map((c) => (
                    <CouponCard key={c.id} c={c} selected={picked.has(c.id)} inBasket={!!basket[c.id]} onToggle={() => toggle(c.id)} />
                  ))}
              </div>
              <h3 className="cp-section">All offers</h3>
            </>
          )}
          <div className="coupon-list">
            {coupons
              .filter((c) => !c.featured)
              .map((c) => (
                <CouponCard key={c.id} c={c} selected={picked.has(c.id)} inBasket={!!basket[c.id]} onToggle={() => toggle(c.id)} />
              ))}
          </div>
          <p className="muted small cp-note">Sample offers and prices for this demo.</p>
          {picked.size > 0 && (
            <div className="cp-bar">
              <span>
                <b>{picked.size} selected</b>
                <small>Save {money(pickedSaving)}</small>
              </span>
              <button className="btn primary" onClick={addPicked}>
                <ShoppingBasket size={18} /> Add to basket
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="cp-body">
          {!lines.length ? (
            <div className="cp-empty">
              <ShoppingBasket size={36} />
              <p>Your basket is empty.</p>
              <button className="btn" onClick={() => setTab('offers')}>
                <TicketPercent size={18} /> See offers
              </button>
            </div>
          ) : (
            <>
              <ul className="basket-list">
                {lines.map((l) => {
                  const short = l.coupon.minCases - l.cases;
                  return (
                    <li key={l.coupon.id} className="basket-line">
                      <span className="coupon-img small">{l.coupon.imageUrl ? <img src={l.coupon.imageUrl} alt="" /> : null}</span>
                      <span className="basket-info">
                        <b>{l.coupon.product}</b>
                        <small>
                          {l.coupon.pack} · {money(l.coupon.casePrice)} each
                        </small>
                        {l.saving ? (
                          <small className="basket-ok">
                            <Check size={12} strokeWidth={3} /> Coupon "{l.coupon.offer}" −{money(l.saving)}
                          </small>
                        ) : (
                          <small className="basket-warn">
                            Add {short} more to use "{l.coupon.offer}"
                          </small>
                        )}
                      </span>
                      <span className="basket-qty">
                        <span className="stepper">
                          <button onClick={() => setCases(l.coupon.id, l.cases - 1)} aria-label="One case fewer">
                            {l.cases === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                          </button>
                          <b>{l.cases}</b>
                          <button onClick={() => setCases(l.coupon.id, l.cases + 1)} aria-label="One case more">
                            <Plus size={14} />
                          </button>
                        </span>
                        <b>{money(l.cost)}</b>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="basket-totals">
                <span>Subtotal</span>
                <span>{money(totals.subtotal)}</span>
                <span className="basket-ok">Coupon savings</span>
                <span className="basket-ok">−{money(totals.savings)}</span>
                <b>Total</b>
                <b>{money(totals.total)}</b>
              </div>
              <button className="btn primary full" onClick={send}>
                <Send size={18} /> Send order to wholesaler
              </button>
              <button
                className="btn ghost full"
                onClick={() => {
                  if (confirm('Empty the basket?')) setBasket({});
                }}
              >
                <Trash2 size={16} /> Empty basket
              </button>
              <p className="muted small cp-note">Sample offers and prices for this demo. The order opens your share sheet, ready to send.</p>
            </>
          )}
        </div>
      )}
      {toast && <div className="cp-toast">{toast}</div>}
    </div>
  );
}
