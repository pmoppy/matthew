import { Star, TicketPercent, X } from 'lucide-react';
import type { Coupon } from '../lib/coupons';

/**
 * Pop-up on opening the app that promotes one offer (the one marked "popup"
 * in coupons.json, otherwise the first featured offer).
 */
export function OfferPopup({ coupon, onClose, onGo }: { coupon: Coupon; onClose: () => void; onGo: () => void }) {
  return (
    <div className="sheet-backdrop popup-backdrop" onClick={onClose}>
      <div
        className="offer-popup"
        role="dialog"
        aria-label={`Offer: ${coupon.brand} ${coupon.offer}`}
        style={{ '--cp': coupon.colour ?? 'var(--brand)' } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="popup-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <span className="popup-tag">
          <Star size={13} fill="currentColor" /> {coupon.featured ? 'Star buy' : 'Offer for you'}
        </span>
        <span className="popup-img">{coupon.imageUrl ? <img src={coupon.imageUrl} alt="" /> : <TicketPercent size={40} />}</span>
        <small className="popup-brand">{coupon.brand}</small>
        <b className="popup-offer">{coupon.offer}</b>
        <p className="popup-title">{coupon.title}</p>
        <p className="muted small popup-meta">
          {coupon.pack}
          {coupon.ends ? ` · ends ${new Date(`${coupon.ends}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}
        </p>
        <div className="popup-btns">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={onGo}>
            <TicketPercent size={18} /> Go to offers
          </button>
        </div>
      </div>
    </div>
  );
}
