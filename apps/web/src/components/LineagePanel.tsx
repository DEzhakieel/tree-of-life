import type { LineageNode } from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';

function TreeNode({ node, depth }: { node: LineageNode; depth: number }) {
  const children = node.children ?? [];
  return (
    <li>
      <div className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
        <span style={{ width: depth * 12 }} className="shrink-0" />
        <span className={`h-2 w-2 shrink-0 rounded-full ${node.alive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <span className="font-mono text-zinc-300">
          #{node.id}
          <span className="ml-1 text-zinc-500">sp.{node.species % 10000}</span>
        </span>
        <span className="text-[10px] text-zinc-600">
          b{node.bornAtTick}
          {node.diedAtTick > 0 ? ` d${node.diedAtTick}` : ''}
        </span>
        <span className="text-[10px] text-indigo-300">{node.children.length > 0 ? `${node.children.length}↳` : ''}</span>
      </div>
      {children.length > 0 && (
        <ul>
          {children.slice(0, 40).map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LineagePanel() {
  const lineage = useStore((s) => s.lineage);
  const show = useStore((s) => s.showLineage);

  if (!show) return null;

  return (
    <Panel
      id="lineage"
      title="Genealogy"
      right={
        <button onClick={() => useStore.getState().setShowLineage(false)} className="text-zinc-400 hover:text-white" title="hide genealogy">
          ✕
        </button>
      }
    >
      {lineage ? (
        <ul className="max-h-72 overflow-y-auto">
          {lineage.slice(0, 20).map((root) => (
            <TreeNode key={root.id} node={root} depth={0} />
          ))}
        </ul>
      ) : (
        <div className="text-zinc-500">no lineage data yet — toggle Genealogy in the toolbar to fetch it</div>
      )}
    </Panel>
  );
}
