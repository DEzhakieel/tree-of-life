import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Standardised glass panel with a consistent header bar. */
export function Panel({ title, right, children, className }: PanelProps) {
  return (
    <div
      className={`pointer-events-auto w-full rounded-xl border border-white/10 bg-black/60 p-3 text-xs backdrop-blur ${
        className ?? ''
      }`}
    >
      <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
