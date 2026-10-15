import { useMemo, useState } from 'react';
import { GENOME_BLOCKS } from '@fractal-life/shared';

export interface GenomeBrowserProps {
  genome: Float32Array;
  /** When provided, gene values become editable (range + number input). */
  onEdit?: (index: number, value: number) => void;
  /** Disable editing (e.g. while a request is in flight). */
  disabled?: boolean;
  title?: string;
}

function rowLabel(index: number): string {
  const b = GENOME_BLOCKS.find((x) => index >= x.offset && index < x.offset + x.count);
  if (!b) return '';
  if (b.genes.length > 0) {
    const g = b.genes.find((x) => x.index === index);
    if (g) return g.name;
  }
  return `raw[${index - b.offset}]`;
}

export function GenomeBrowser({ genome, onEdit, disabled, title }: GenomeBrowserProps) {
  return (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
      {title && (
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          {title}
        </div>
      )}
      {GENOME_BLOCKS.map((block) => (
        <BlockSection
          key={block.name}
          block={block}
          genome={genome}
          onEdit={onEdit}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function BlockSection({
  block,
  genome,
  onEdit,
  disabled,
}: {
  block: (typeof GENOME_BLOCKS)[number];
  genome: Float32Array;
  onEdit?: (index: number, value: number) => void;
  disabled?: boolean;
}) {
  // Named blocks start open; the 99-slot MLP block stays collapsed by default.
  const [open, setOpen] = useState<boolean>(block.genes.length > 0 && block.count <= 16);
  const { rangeText } = useMemo(() => {
    const end = block.offset + block.count - 1;
    const tag = block.genes.length > 0 ? '' : ` (${block.count})`;
    return { rangeText: `[${block.offset}..${end}]${tag}` };
  }, [block]);

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={`text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-[11px] font-medium text-zinc-200">{block.name}</span>
        </span>
        <span className="font-mono text-[10px] text-zinc-500">{rangeText}</span>
      </button>
      {block.hint && <div className="px-2 pb-1 text-[9px] leading-tight text-zinc-500">{block.hint}</div>}
      {open && (
        <div className="space-y-0.5 px-1 pb-1">
          {onEdit ? (
            <div className="mb-1 flex gap-1">
              <span className="flex-1" />
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  for (let i = 0; i < block.count; i++) {
                    const idx = block.offset + i;
                    const cur = genome[idx] ?? 0;
                    onEdit(
                      idx,
                      Math.max(-1, Math.min(1, cur + (Math.random() * 0.2 - 0.1))),
                    );
                  }
                }}
                className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
              >
                jitter block
              </button>
            </div>
          ) : null}
          {block.genes.length > 0
            ? block.genes.map((g) => (
                <GeneRow
                  key={g.index}
                  label={g.name}
                  index={g.index}
                  value={genome[g.index] ?? 0}
                  onEdit={onEdit ? (v) => onEdit(g.index, v) : undefined}
                  disabled={disabled}
                />
              ))
            : Array.from({ length: block.count }, (_, i) => block.offset + i).map((index) => (
                <GeneRow
                  key={index}
                  label={rowLabel(index)}
                  index={index}
                  value={genome[index] ?? 0}
                  onEdit={onEdit ? (v) => onEdit(index, v) : undefined}
                  disabled={disabled}
                  compact
                />
              ))}
        </div>
      )}
    </div>
  );
}

function GeneRow({
  label,
  index,
  value,
  onEdit,
  compact,
  disabled,
}: {
  label: string;
  index: number;
  value: number;
  onEdit?: (v: number) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const shown = onEdit ? local : value;
  return (
    <div className="flex items-center gap-1.5 rounded px-1 py-px font-mono text-[10px] text-zinc-300 hover:bg-white/5">
      <span className="w-24 shrink-0 truncate" title={label}>
        {label}
      </span>
      <span className="w-8 shrink-0 text-zinc-600">{index}</span>
      <span className={`w-16 shrink-0 text-right ${shown > 0 ? 'text-emerald-400/80' : shown < 0 ? 'text-rose-400/80' : 'text-zinc-500'}`}>
        {shown.toFixed(3)}
      </span>
      {onEdit ? (
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={local}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal(v);
            onEdit(v);
          }}
          className="h-1.5 min-w-0 flex-1 accent-indigo-500 disabled:opacity-40"
        />
      ) : compact ? null : (
        <span className="flex-1" />
      )}
    </div>
  );
}