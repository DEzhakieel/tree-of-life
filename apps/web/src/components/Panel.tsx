import type { ReactNode } from 'react';
import { useStore } from '../store/useStore.js';

interface PanelProps {
  title: string;
  /** Registry id. When present the header becomes a collapse toggle bound to
   *  the store; omit it for panels that should always stay open. */
  id?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Standardised glass panel with a consistent header bar. */
export function Panel({ title, id, right, children, className }: PanelProps) {
  const collapsed = useStore((s) => (id ? s.panelCollapsed[id] ?? false : false));

  return (
    <div
      className={`pointer-events-auto w-full rounded-xl border border-white/10 bg-black/60 p-3 text-xs backdrop-blur ${
        className ?? ''
      }`}
    >
      <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
        {id ? (
          <button
            type="button"
            onClick={() => useStore.getState().togglePanel(id)}
            title={collapsed ? `expand ${title}` : `collapse ${title}`}
            className="flex items-center gap-1.5 text-left hover:text-zinc-200"
          >
            <span
              className={`text-[9px] text-zinc-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            >
              ▶
            </span>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{title}</h3>
          </button>
        ) : (
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{title}</h3>
        )}
        {right}
      </div>
      {collapsed ? null : children}
    </div>
  );
}

