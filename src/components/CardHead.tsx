import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

/** Open/closed state of a home-screen card, remembered on this phone. Closed by default to keep home tidy. */
export function useOpen(key: string, initial = false): [boolean, () => void] {
  const k = `shelfscan.open.${key}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(k, o ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !o;
    });
  return [open, toggle];
}

/** Tappable card header: icon, title, one-line summary and a chevron. */
export function CardHead({
  icon,
  title,
  sub,
  open,
  onToggle,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  sub: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="shop-head">
      <button className="card-toggle" onClick={onToggle} aria-expanded={open}>
        <span className="shop-icon">{icon}</span>
        <span className="card-toggle-text">
          <h3>{title}</h3>
          <span className="muted small">{sub}</span>
        </span>
        <ChevronDown size={18} className={`card-chev ${open ? 'rot' : ''}`} />
      </button>
      {extra}
    </div>
  );
}
