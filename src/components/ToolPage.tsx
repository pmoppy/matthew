import { ArrowLeft } from 'lucide-react';

/** A home-screen tool (media hub, shopping list, history) opened on its own screen. */
export function ToolPage({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="cp-screen" role="dialog" aria-label={title}>
      <header className="cp-head">
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h2 className="tool-title">{title}</h2>
      </header>
      <div className="cp-body tool-body">{children}</div>
    </div>
  );
}
