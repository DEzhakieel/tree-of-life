import { useEffect, useMemo } from 'react';
import {
  decodePhenotype,
  decodeDrives,
  decodeStrategies,
  decodeImmuneGenes,
  decodePredPreyGenes,
  decodeReproGenes,
  decodeMetabGenes,
  decodeDnaGenes,
  decodeCellGenes,
  decodeMembraneGenes,
  decodeEcosystemGenes,
  fractalGenes,
} from '@fractal-life/simulation';
import { GENOME_SIZE } from '@fractal-life/shared';
import { intervene, requestAgentSummaries, agents } from '../net/session.js';
import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';
import { GenomeBrowser } from './GenomeBrowser.js';

const GOLDEN = 0.6180339887498949;

function speciesColor(species: number): string {
  return `hsl(${Math.round(((species * GOLDEN) % 1) * 360)}, 85%, 60%)`;
}

const fmt = (v: number) => v.toFixed(3);

/** Trait readout grid for the decoded blocks (canonical decode functions). */
function TraitGrid({ genome }: { genome: Float32Array }) {
  const p = decodePhenotype(genome);
  const d = decodeDrives(genome);
  const s = decodeStrategies(genome);
  const f = fractalGenes(genome);
  const rows: [string, string][] = [
    ['speed', fmt(p.speed)],
    ['sense radius', fmt(p.senseRadius)],
    ['metabolism', fmt(p.metabolism)],
    ['size', fmt(p.size)],
    ['diet', p.diet < 0.4 ? 'herbivore' : p.diet > 0.6 ? 'carnivore' : 'omnivore'],
    ['fertility', fmt(p.fertility)],
    ['longevity', fmt(p.longevity)],
    ['mutability', fmt(p.mutability)],
    ['cRe / cIm', `${f.cRe.toFixed(3)} / ${f.cIm.toFixed(3)}`],
    ['aggression', fmt(s.aggression)],
    ['cooperation', fmt(s.cooperation)],
    ['risk', fmt(s.risk)],
    ['deception', fmt(s.deception)],
    ['alignment', fmt(d.alignment)],
    ['cohesion', fmt(d.cohesion)],
    ['separation', fmt(d.separation)],
    ['circulation', fmt(d.circulation)],
    ['oscillation', fmt(d.oscillation)],
    ['noise', fmt(d.noise)],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pb-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 font-mono text-[10px]">
          <span className="truncate text-zinc-500">{k}</span>
          <span className="text-zinc-300">{v}</span>
        </div>
      ))}
      <div className="col-span-2 flex items-center gap-1.5 pt-0.5">
        <span className="text-[10px] text-zinc-500">colour</span>
        <span
          className="inline-block h-3 w-8 rounded"
          style={{ background: `rgb(${Math.round(p.color[0] * 255)},${Math.round(p.color[1] * 255)},${Math.round(p.color[2] * 255)})` }}
        />
      </div>
    </div>
  );
}

export function AgentInspector() {
  const id = useStore((s) => s.selectedAgentId);
  const meta = useStore((s) => (id !== null ? s.agentsMeta.get(id) : undefined));
  const designGenome = useStore((s) => s.designGenome);
  const close = useStore((s) => s.setSelectedAgentId);
  // stats cadence subscription: re-renders the live readout as frames arrive
  const liveTick = useStore((s) => s.status?.currentTick ?? 0);

  /** Live per-frame readout straight from the renderer's agent buffer (meme
   *  updates every frame and is not part of the on-demand genome summary). */
  const live = useMemo(() => {
    void liveTick;
    if (id === null) return null;
    const i = agents.indexOf(id);
    if (i < 0) return null;
    return { meme: agents.meme[i]!, energy: agents.energy[i]!, x: agents.x[i]!, y: agents.y[i]! };
  }, [id, liveTick]);

  useEffect(() => {
    if (id === null) return;
    // Genome not fetched yet → ask the source (worker summaries / server REST).
    if (!useStore.getState().agentsMeta.has(id)) requestAgentSummaries();
  }, [id]);

  const badgeRows = useMemo<{ label: string; value: string }[]>(() => {
    if (!meta) return [];
    const g = meta.genome;
    const immune = decodeImmuneGenes(g);
    const pp = decodePredPreyGenes(g);
    const repro = decodeReproGenes(g);
    const metab = decodeMetabGenes(g);
    const dna = decodeDnaGenes(g);
    const cell = decodeCellGenes(g);
    const membrane = decodeMembraneGenes(g);
    const eco = decodeEcosystemGenes(g);
    return [
      { label: 'immune', value: fmt(immune.adaptive) },
      { label: 'stealth/pursuit', value: `${fmt(pp.stealth)} / ${fmt(pp.pursuit)}` },
      { label: 'clutch', value: fmt(repro.clutchSize) },
      { label: 'aerobic', value: fmt(metab.aerobic) },
      { label: 'dna fidelity', value: fmt(dna.replicationFidelity) },
      { label: 'cell size', value: fmt(cell.cellSize) },
      { label: 'membrane perm', value: fmt(membrane.permeability) },
      { label: 'niche spec', value: fmt(eco.nicheSpecialization) },
    ];
  }, [meta]);

  /** Reverse-engineering decode: read the genome back as an engineered
   *  organism — niche, role, social posture and dominant motion instinct. */
  const re = useMemo(() => {
    if (!meta) return null;
    const g = meta.genome;
    const p = decodePhenotype(g);
    const s = decodeStrategies(g);
    const d = decodeDrives(g);
    const drives: [string, number][] = [
      ['align', d.alignment],
      ['cohere', d.cohesion],
      ['separate', d.separation],
      ['circulate', Math.abs(d.circulation)],
      ['oscillate', d.oscillation],
      ['noise', d.noise],
    ];
    drives.sort((a, b) => b[1] - a[1]);
    const niche = p.diet < 0.4 ? 'herbivore' : p.diet > 0.6 ? 'carnivore' : 'omnivore';
    const role = s.aggression > 0.6 ? 'hunter' : s.aggression < 0.35 ? 'prey' : 'generalist';
    const social = s.cooperation > 0.65 ? 'altruist' : s.cooperation < 0.3 ? 'defector' : 'reciprocator';
    const explorer = p.mutability > 1.4 ? 'speciating' : s.risk > 0.65 ? 'venturer' : 'settler';
    const signaler = s.deception > 0.6 ? 'cheap-signaller' : s.deception < 0.25 ? 'honest' : 'mixed-signaller';
    return {
      niche,
      role,
      social,
      explorer,
      signaler,
      topDrive: `${drives[0]![0]}@${drives[0]![1].toFixed(2)}`,
    };
  }, [meta]);

  if (id === null) return null;
  if (!meta) {
    return (
      <div className="w-full">
        <Panel title={`Agent #${id}`} right={<CloseButton onClick={close} />}>
          <div className="py-6 text-center text-zinc-500">requesting genome…</div>
        </Panel>
      </div>
    );
  }

  const genomeReady = meta.genome.length === GENOME_SIZE;

  return (
    <div className="flex max-h-[70vh] w-full flex-col">
      <Panel
        title={`Agent #${meta.id}`}
        className="flex min-h-0 flex-1 flex-col"
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                requestAgentSummaries();
              }}
              title="refresh genome"
              className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-white/10"
            >
              ↻
            </button>
            <CloseButton onClick={close} />
          </div>
        }
      >
        <div className="mb-1.5 flex items-center gap-2 text-[10px] text-zinc-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: speciesColor(meta.species) }} />
          <span>sp.{meta.species % 10000}</span>
          <span className="text-zinc-600">·</span>
          <span>age {Math.round(meta.age)}</span>
          <span className="text-zinc-600">·</span>
          <span>E {fmt(live?.energy ?? meta.energy)}</span>
          {live && (
            <>
              <span className="text-zinc-600">·</span>
              <span title="live cultural tag (meme)">meme {live.meme.toFixed(3)}</span>
            </>
          )}
          <span className="text-zinc-600">·</span>
          <span>parent {meta.parentId >= 0 ? `#${meta.parentId}` : '—'}</span>
        </div>
        {meta.alive ? null : <div className="mb-1 text-[10px] text-rose-400">† deceased</div>}

        <TraitGrid genome={meta.genome} />

        {re && (
          <div className="mb-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
              reverse engineering
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ['niche', re.niche],
                ['role', re.role],
                ['social', re.social],
                ['posture', re.explorer],
                ['signal', re.signaler],
                ['drive', re.topDrive],
              ].map(([k, v]) => (
                <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                  {k} <span className="text-zinc-100">{v}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mb-1 flex flex-wrap gap-1">
          {badgeRows.map((r) => (
            <span key={r.label} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
              {r.label} <span className="text-zinc-200">{r.value}</span>
            </span>
          ))}
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-1.5 border-y border-white/10 py-1.5">
          <button
            type="button"
            onClick={() => {
              useStore.getState().setDesignGenome(meta.genome.slice());
              useStore.getState().setTool('spawnAgent');
            }}
            className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/30"
            title="copy this genome into the designer, then use the Spawn tool to drop clones"
          >
            load into designer
          </button>
          {designGenome && (
            <span className="text-[9px] text-zinc-500">design loaded ({designGenome.length} genes)</span>
          )}
        </div>

        {genomeReady ? (
          <div className="min-h-0 flex-1">
            <GenomeBrowser
              genome={meta.genome}
              title="genome"
              onEdit={(index, value) => {
                intervene({ type: 'setGene', agentId: meta.id, index, value });
                useStore.getState().patchAgentGenome(meta.id, index, value);
              }}
            />
          </div>
        ) : (
          <div className="py-4 text-center text-zinc-500">
            partial/live genome unavailable — use ↻ refresh
          </div>
        )}
        <div className="pt-1.5 text-[9px] leading-tight text-zinc-600">
          Edits rewrite the heredity template: offspring inherit the change, the
          live agent's decoded traits/learned brain keep their current values.
        </div>
      </Panel>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: (v: null) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(null)}
      title="close"
      className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-white/10"
    >
      ✕
    </button>
  );
}