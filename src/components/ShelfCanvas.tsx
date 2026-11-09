import { useEffect, useRef, useState } from 'react';
import { STATUS_STYLE } from '../lib/settings';
import type { Facing, Status } from '../lib/types';

interface Props {
  image: HTMLCanvasElement;
  facings: Facing[];
  hidden: Set<Status>;
  selectedId: number | null;
  onSelect: (f: Facing) => void;
  /** Show the scanning animation while the photo is being analysed. */
  scanning?: boolean;
}

/** Shelf photo with colour-coded boxes. Tap a box to inspect or correct it. */
export function ShelfCanvas({ image, facings, hidden, selectedId, onSelect, scanning }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Draw at a capped resolution for performance on phones.
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    c.width = Math.round(image.width * scale);
    c.height = Math.round(image.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0, c.width, c.height);
    const lw = Math.max(2, Math.round(c.width / 300));
    for (const f of facings) {
      if (hidden.has(f.status)) continue;
      const st = STATUS_STYLE[f.status];
      const x = f.x1 * scale, y = f.y1 * scale, w = (f.x2 - f.x1) * scale, h = (f.y2 - f.y1) * scale;
      const width = f.id === selectedId ? lw * 2.2 : lw;
      // Dark halo so boxes stay visible on any packaging colour.
      ctx.setLineDash([]);
      ctx.lineWidth = width + 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
      ctx.lineWidth = width;
      ctx.strokeStyle = st.color;
      ctx.setLineDash(st.dash ? [lw * 3, lw * 2] : []);
      ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
      if (f.status === 'top' || f.status === 'delist' || f.status === 'unsure' || f.status.startsWith('pog_')) {
        ctx.fillStyle = st.color + '22';
        ctx.fillRect(x, y, w, h);
      }
      if (f.corrected) {
        const r = Math.max(5, lw * 2.5);
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.arc(x + w - r - lw, y + r + lw, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
  }, [image, facings, hidden, selectedId]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * image.width;
    const y = ((e.clientY - rect.top) / rect.height) * image.height;
    // Smallest box containing the point (boxes can overlap slightly).
    let best: Facing | null = null;
    for (const f of facings) {
      if (hidden.has(f.status)) continue;
      if (x >= f.x1 && x <= f.x2 && y >= f.y1 && y <= f.y2) {
        if (!best || (f.x2 - f.x1) * (f.y2 - f.y1) < (best.x2 - best.x1) * (best.y2 - best.y1)) best = f;
      }
    }
    // Detector boxes are tight, so taps often land in the gap between packs.
    // Fall back to the nearest box within a finger-width.
    if (!best) {
      const reach = (24 / rect.width) * image.width;
      let bestD = reach;
      for (const f of facings) {
        if (hidden.has(f.status)) continue;
        const dx = Math.max(f.x1 - x, 0, x - f.x2);
        const dy = Math.max(f.y1 - y, 0, y - f.y2);
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    if (best) onSelect(best);
  };

  return (
    <div className="shelf-wrap card">
      <div className="shelf-scroll">
        <canvas ref={ref} onClick={onClick} style={{ width: `${zoom * 100}%` }} className="shelf-canvas" />
        {scanning && <div className="scan-overlay" aria-hidden />}
      </div>
      <div className="zoom-controls">
        {[1, 2, 3].map((z) => (
          <button key={z} className={zoom === z ? 'chip active' : 'chip'} onClick={() => setZoom(z)}>
            {z}×
          </button>
        ))}
      </div>
    </div>
  );
}
