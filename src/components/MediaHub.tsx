import { ExternalLink, FileText, Image as ImageIcon, Loader2, Minus, Play, Plus, Share2, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cachedMedia, fetchMedia, markSeen, mediaBlob, seenIds, youtubeId, type MediaItem, type ResolvedMedia } from '../lib/media';
import { shareBlob } from '../lib/report';

interface Props {
  libraryBase: string;
  /** Lets the Android back button close the viewer. */
  closeRef?: React.MutableRefObject<(() => boolean) | null>;
}

function niceDate(d?: string) {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00`);
  return isNaN(t.getTime()) ? d : t.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function TypeIcon({ type }: { type: MediaItem['type'] }) {
  if (type === 'youtube' || type === 'video') return <Play size={18} />;
  if (type === 'pdf') return <FileText size={18} />;
  if (type === 'link') return <ExternalLink size={18} />;
  return <ImageIcon size={18} />;
}

function thumbFor(item: ResolvedMedia): string | null {
  if (item.thumbUrl) return item.thumbUrl;
  if (item.type === 'youtube' && item.url) {
    const id = youtubeId(item.url);
    if (id) return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }
  if (item.type === 'image' && item.fileUrl) return item.fileUrl;
  return null;
}

function Thumb({ item }: { item: ResolvedMedia }) {
  const src = thumbFor(item);
  const [failed, setFailed] = useState(false);
  const video = item.type === 'youtube' || item.type === 'video';
  return (
    <span className={`media-thumb ${video ? 'video' : ''}`}>
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <TypeIcon type={item.type} />}
      {video && src && !failed && (
        <span className="media-play">
          <Play size={14} fill="currentColor" />
        </span>
      )}
    </span>
  );
}

/** Full-screen image with pinch / double-tap / button zoom. */
function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  const zoomTo = (next: number) => {
    const el = box.current;
    const s = Math.min(6, Math.max(1, next));
    if (!el) return setScale(s);
    // Keep the centre of the view in place.
    const cx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
    const cy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
    setScale(s);
    requestAnimationFrame(() => {
      el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = cy * el.scrollHeight - el.clientHeight / 2;
    });
  };

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return (
    <>
      <div
        ref={box}
        className="media-zoom"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) pinch.current = { dist: dist(), scale };
          if (pointers.current.size === 1 && e.pointerType !== 'mouse') {
            const now = Date.now();
            if (now - lastTap.current < 300) zoomTo(scale > 1 ? 1 : 2.5);
            lastTap.current = now;
          }
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size === 2) zoomTo((pinch.current.scale * dist()) / pinch.current.dist);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
      >
        <img src={src} alt={alt} draggable={false} style={{ width: `${scale * 100}%` }} />
      </div>
      <div className="media-zoom-bar">
        <button className="btn ghost icon-only" onClick={() => zoomTo(scale / 1.5)} disabled={scale <= 1} aria-label="Zoom out">
          <Minus size={18} />
        </button>
        <span className="muted small">{Math.round(scale * 100)}%</span>
        <button className="btn ghost icon-only" onClick={() => zoomTo(scale * 1.5)} disabled={scale >= 6} aria-label="Zoom in">
          <Plus size={18} />
        </button>
      </div>
    </>
  );
}

function Viewer({ item, onClose }: { item: ResolvedMedia; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.fileUrl) return;
    let url: string | null = null;
    let live = true;
    mediaBlob(item.fileUrl)
      .then((b) => {
        if (!live) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setBlobUrl(url);
      })
      .catch((e) => live && setError(`${(e as Error).message}. Connect to the internet once to save it to this phone.`));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item]);

  const share = () => blob && item.file && shareBlob(item.file.split('/').pop() ?? 'file', blob);

  return (
    <div className="media-viewer" role="dialog" aria-label={item.title}>
      <header className="media-viewer-head">
        <div>
          <h3>{item.title}</h3>
          <p className="muted small">{[item.tag, niceDate(item.date)].filter(Boolean).join(' · ')}</p>
        </div>
        {blob && (
          <button className="btn ghost icon-only" onClick={share} aria-label="Share" title="Share">
            <Share2 size={18} />
          </button>
        )}
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close" title="Close">
          <X size={20} />
        </button>
      </header>
      {error ? (
        <div className="notice error">{error}</div>
      ) : !blobUrl ? (
        <div className="media-loading">
          <Loader2 size={22} className="spin" /> Loading…
        </div>
      ) : item.type === 'video' ? (
        <video className="media-video" src={blobUrl} controls autoPlay playsInline />
      ) : (
        <ZoomImage src={blobUrl} alt={item.title} />
      )}
      {item.description && <p className="media-viewer-desc">{item.description}</p>}
    </div>
  );
}

/** Home-screen hub of planograms, adverts and videos, managed from the library's media/media.json. */
export function MediaHub({ libraryBase, closeRef }: Props) {
  const [items, setItems] = useState<ResolvedMedia[]>(() => cachedMedia());
  const [seen, setSeen] = useState(() => seenIds());
  const [open, setOpen] = useState<ResolvedMedia | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMedia(libraryBase).then((xs) => live && setItems(xs));
    return () => {
      live = false;
    };
  }, [libraryBase]);

  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = open
      ? () => {
          setOpen(null);
          return true;
        }
      : null;
  });

  const tags = useMemo(() => [...new Set(items.map((i) => i.tag).filter((t): t is string => !!t))], [items]);
  if (!items.length) return null;

  const unseen = items.filter((i) => !seen.has(i.id)).length;
  const filtered = filter ? items.filter((i) => i.tag === filter) : items;
  const shown = showAll ? filtered : filtered.slice(0, 4);

  const visit = (item: ResolvedMedia) => {
    markSeen(item.id);
    setSeen(seenIds());
  };

  const onTap = async (item: ResolvedMedia) => {
    visit(item);
    if (item.type === 'pdf' && item.file && item.fileUrl) {
      // Phones open PDFs best in their own viewer: hand it over via the share sheet.
      try {
        const b = await mediaBlob(item.fileUrl);
        await shareBlob(item.file.split('/').pop() ?? 'planogram.pdf', b);
      } catch (e) {
        alert(`Couldn't open the PDF: ${(e as Error).message}`);
      }
      return;
    }
    setOpen(item);
  };

  return (
    <section className="card media">
      <div className="shop-head">
        <span className="shop-icon">
          <Video size={20} />
        </span>
        <div>
          <h3>Media hub</h3>
          <p className="muted small">
            Planograms, adverts & videos{unseen ? ` · ` : ''}
            {unseen ? <b className="media-new-count">{unseen} new</b> : null}
          </p>
        </div>
      </div>

      {tags.length > 1 && (
        <div className="media-chips">
          <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter(null)}>
            All
          </button>
          {tags.map((t) => (
            <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(filter === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      <ul className="media-list">
        {shown.map((item) => {
          const body = (
            <>
              <Thumb item={item} />
              <span className="hist-text">
                <b>{item.title}</b>
                <small>
                  {[item.tag, niceDate(item.date)].filter(Boolean).join(' · ')}
                  {item.type === 'youtube' ? ' · YouTube' : ''}
                </small>
                {item.description && <small className="media-desc">{item.description}</small>}
              </span>
              {!seen.has(item.id) ? <span className="pill good">New</span> : (item.type === 'youtube' || item.type === 'link') && <ExternalLink size={16} className="muted" />}
            </>
          );
          return (
            <li key={item.id}>
              {(item.type === 'youtube' || item.type === 'link') && item.url ? (
                // Opens the YouTube app / browser (Capacitor hands external links to Android).
                <a className="hist-open" href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => visit(item)}>
                  {body}
                </a>
              ) : (
                <button className="hist-open" onClick={() => onTap(item)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {filtered.length > 4 && (
        <div className="row wrap">
          <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
          </button>
        </div>
      )}

      {open && <Viewer item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
