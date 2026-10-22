import { useState } from 'react';
import type { FractalType, WorldParams, UniverseConfig, EnvironmentPreset, WorldTopology, SubstrateKind } from '@fractal-life/shared';
import { UNIVERSE_EARTH_LIKE, UNIVERSE_LUNA, UNIVERSE_MARS, ENV_PROFILES, TOPOLOGIES, TOPOLOGY_DEFS } from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import { startSession } from '../net/session.js';

const FRACTALS: { id: FractalType; label: string; hint: string }[] = [
  { id: 'mandelbrot', label: 'Mandelbrot', hint: 'coastal terrain around the Set' },
  { id: 'julia', label: 'Julia', hint: 'repeating archipelago (uses cReal/cImag)' },
  { id: 'perlin', label: 'Perlin', hint: 'smooth value-noise continents' },
];

/** Life substrates selectable at world creation (local/worker mode only —
 *  remote worlds always run the WASM agent engine). */
const SUBSTRATE_CHOICES: { id: SubstrateKind; label: string; hint: string }[] = [
  { id: 'agents', label: 'Agents', hint: 'full agent engine — terrain, genome, research parity' },
  { id: 'particles', label: 'Particles', hint: 'attraction-repulsion bodies with an energy life cycle' },
  { id: 'lattice', label: 'Lattice', hint: 'cellular automaton on the 128×128 grid' },
  { id: 'graph', label: 'Graph', hint: 'excitable-medium nodes on a proximity graph' },
];

const UNIVERSE_PRESETS: { id: 'off' | 'earth' | 'moon' | 'mars'; label: string; hint: string; cfg: UniverseConfig | null }[] = [
  { id: 'off', label: 'Off', hint: 'legacy physics frame', cfg: null },
  { id: 'earth', label: 'Earth', hint: '1g, sea-level air', cfg: UNIVERSE_EARTH_LIKE },
  { id: 'moon', label: 'Moon', hint: '0.17g, no atmosphere', cfg: UNIVERSE_LUNA },
  { id: 'mars', label: 'Mars', hint: '0.38g, thin air', cfg: UNIVERSE_MARS },
];

const ENV_PRESET_IDS: (EnvironmentPreset | null)[] = [null, ...(Object.keys(ENV_PROFILES) as EnvironmentPreset[])];

const PARAM_FIELDS: { key: keyof WorldParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'spawnCount', label: 'Founders', min: 10, max: 4000, step: 10 },
  { key: 'maxPopulation', label: 'Max pop', min: 100, max: 12000, step: 100 },
  { key: 'metabolismBase', label: 'Metabolism', min: 0.1, max: 4, step: 0.1 },
  { key: 'foodRegenRate', label: 'Food regen', min: 0, max: 0.005, step: 0.0001 },
  { key: 'energyCapacity', label: 'Energy cap', min: 10, max: 1000, step: 10 },
  { key: 'agentMaxAge', label: 'Max age', min: 100, max: 20000, step: 100 },
  { key: 'dayLength', label: 'Day (ticks)', min: 100, max: 100000, step: 100 },
  { key: 'seasonLength', label: 'Season (ticks)', min: 100, max: 500000, step: 100 },
  { key: 'worldScale', label: 'World scale', min: 0.5, max: 16, step: 0.5 },
  { key: 'maxIter', label: 'Orbit depth', min: 32, max: 2048, step: 32 },
  { key: 'escapeRadius', label: 'Escape radius', min: 64, max: 65536, step: 64 },
];

function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-400" title={hint}>
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-indigo-500"
      />
      <span className="w-10 shrink-0 text-right font-mono text-zinc-200">{value}</span>
    </label>
  );
}

export function NewWorldModal() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = useStore();
  /** remote worlds always run the WASM agent engine; substrates are local-only */
  const isAgents = mode === 'remote' || st.formSubstrate === 'agents';

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const substrateKind: SubstrateKind = mode === 'local' ? st.formSubstrate : 'agents';
      const world = await startSession({
        mode,
        create: {
          seed: st.formSeed,
          fractalType: st.formFractal,
          params: st.formParams,
          cellBio: st.formCellBio,
          biophysics: st.formBiophysics,
          omics: st.formOmics,
          omicsStochastic: st.formOmicsStochastic,
          combinatorial: st.formCombinatorial,
          recombination: st.formRecombination,
          universe: st.formUniverse ?? undefined,
          environment: st.formEnvironment ?? undefined,
          topology: st.formTopology ?? undefined,
          signalDeposit: st.formSignalDeposit,
          memeCopyRate: st.formMemeCopyRate,
          discovery: st.formDiscovery,
          reproduction: st.formReproduction,
          sensing: st.formSensing,
          substrate:
            substrateKind !== 'agents'
              ? {
                  kind: substrateKind,
                  ...(substrateKind === 'particles'
                    ? { attraction: st.formAttraction, repulsion: st.formRepulsion }
                    : {}),
                  ...(substrateKind === 'lattice' ? { noise: st.formNoise } : {}),
                  ...(substrateKind === 'graph' ? { linkRadius: st.formLinkRadius } : {}),
                }
              : undefined,
        },
      });
      st.setWorld(world);
      st.setConnected(mode === 'local');
      st.clearEvents();
      st.clearStats();
      st.clearScheduledEvents();
      // each substrate has a purpose-built representation; agent worlds return
      // to the flagship particle field (never inherit the previous world's view)
      if (substrateKind === 'lattice') st.setRepresentation('lattice');
      else if (substrateKind === 'graph') st.setRepresentation('graph');
      else st.setRepresentation('particle');
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
      >
        New World
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="max-h-[90vh] w-[480px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Spawn a new world</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              {(['local', 'remote'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    mode === m ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30'
                  }`}
                >
                  {m === 'local' ? 'Local (Worker)' : 'Remote (Server)'}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs text-zinc-400">Seed</label>
            <input
              value={st.formSeed}
              onChange={(e) => st.setFormSeed(e.target.value)}
              placeholder="random"
              className="mb-3 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-400"
            />

            {mode === 'local' && (
              <div className="mb-4">
                <div className="mb-1 text-xs text-zinc-400">Life substrate</div>
                <div className="grid grid-cols-4 gap-2">
                  {SUBSTRATE_CHOICES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => st.setFormSubstrate(s.id)}
                      title={s.hint}
                      className={`rounded-lg border px-2 py-1.5 text-xs ${
                        st.formSubstrate === s.id
                          ? 'border-indigo-400 bg-indigo-500/20 text-white'
                          : 'border-white/10 text-zinc-400 hover:border-white/30'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {SUBSTRATE_CHOICES.find((s) => s.id === st.formSubstrate)?.hint}
                </div>
                {st.formSubstrate !== 'agents' && (
                  <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
                    {st.formSubstrate === 'particles' && (
                      <>
                        <Knob
                          label="Attraction gain"
                          value={st.formAttraction}
                          min={0}
                          max={3}
                          step={0.05}
                          onChange={st.setFormAttraction}
                          hint="near-field attraction between bodies (engine default 1)"
                        />
                        <Knob
                          label="Repulsion gain"
                          value={st.formRepulsion}
                          min={0}
                          max={3}
                          step={0.05}
                          onChange={st.setFormRepulsion}
                          hint="near-field repulsion between bodies (engine default 1)"
                        />
                      </>
                    )}
                    {st.formSubstrate === 'lattice' && (
                      <Knob
                        label="Flip noise"
                        value={st.formNoise}
                        min={0}
                        max={0.2}
                        step={0.005}
                        onChange={st.setFormNoise}
                        hint="per-tick random cell flip probability (engine default 0)"
                      />
                    )}
                    {st.formSubstrate === 'graph' && (
                      <Knob
                        label="Link radius"
                        value={st.formLinkRadius}
                        min={20}
                        max={300}
                        step={5}
                        onChange={st.setFormLinkRadius}
                        hint="neighbour-link radius in world units (engine default 90)"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {isAgents && (
              <>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {FRACTALS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => st.setFormFractal(f.id)}
                  title={f.hint}
                  className={`rounded-lg border px-2 py-1.5 text-xs ${
                    st.formFractal === f.id ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Deep cell biochemistry</div>
                <div className="text-[11px] text-zinc-500">Opt-in: folding, membranes, gradients, MM kinetics</div>
              </div>
              <button
                onClick={() => st.setFormCellBio(!st.formCellBio)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formCellBio ? 'bg-emerald-500/70' : 'bg-white/15'}`}
                title={st.formCellBio ? 'on' : 'off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formCellBio ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Biophysics telemetry</div>
                <div className="text-[11px] text-zinc-500">Opt-in: force field, clustering, entropy, thermo (Phase 1 observable)</div>
              </div>
              <button
                onClick={() => st.setFormBiophysics(!st.formBiophysics)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formBiophysics ? 'bg-indigo-500/70' : 'bg-white/15'}`}
                title={st.formBiophysics ? 'biophysics on' : 'biophysics off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formBiophysics ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Omics telemetry</div>
                <div className="text-[11px] text-zinc-500">Opt-in: transcriptomics, proteomics, fluxomics (Phase A observable)</div>
              </div>
              <button
                onClick={() => st.setFormOmics(!st.formOmics)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formOmics ? 'bg-fuchsia-500/70' : 'bg-white/15'}`}
                title={st.formOmics ? 'omics on' : 'omics off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formOmics ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Stochastic expression</div>
                <div className="text-[11px] text-zinc-500">Phase C: per-block OU noise on transcription and folding (reproducible)</div>
              </div>
              <button
                onClick={() => st.setFormOmicsStochastic(!st.formOmicsStochastic)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formOmicsStochastic ? 'bg-fuchsia-500/70' : 'bg-white/15'}`}
                title={st.formOmicsStochastic ? 'stochastic on' : 'stochastic off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formOmicsStochastic ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Combinatorial chemistry</div>
                <div className="text-[11px] text-zinc-500">Phase C: oligomer library ligated from molecule pools, screened by the folded proteome</div>
              </div>
              <button
                onClick={() => st.setFormCombinatorial(!st.formCombinatorial)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formCombinatorial ? 'bg-fuchsia-500/70' : 'bg-white/15'}`}
                title={st.formCombinatorial ? 'combinatorial on' : 'combinatorial off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formCombinatorial ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Recombination ops</div>
                <div className="text-[11px] text-zinc-500">Phase C: multi-point crossover, block shuffle, per-block assembly on mating</div>
              </div>
              <button
                onClick={() => st.setFormRecombination(!st.formRecombination)}
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${st.formRecombination ? 'bg-fuchsia-500/70' : 'bg-white/15'}`}
                title={st.formRecombination ? 'recombination on' : 'recombination off'}
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${st.formRecombination ? 'translate-x-3' : ''}`}
                />
              </button>
            </div>

            <div className="mb-4">
              <div className="mb-1 text-xs text-zinc-400">Physics frame</div>
              <div className="grid grid-cols-4 gap-2">
                {UNIVERSE_PRESETS.map((u) => {
                  const active = u.cfg === st.formUniverse;
                  return (
                    <button
                      key={u.id}
                      onClick={() => st.setFormUniverse(u.cfg)}
                      title={u.hint}
                      className={`rounded-lg border px-2 py-1.5 text-xs ${
                        active ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30'
                      }`}
                    >
                      {u.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                Real climb costs, escape-velocity cap, drag, seasons (Off = legacy physics)
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div className="mb-2">
                <div className="text-xs font-semibold text-zinc-200">Environment preset</div>
                <div className="text-[11px] text-zinc-500">Biome seeds the chemical terrain + omics climate; activates the biome regime</div>
              </div>
              <select
                value={st.formEnvironment ?? 'off'}
                onChange={(e) => st.setFormEnvironment(e.target.value === 'off' ? null : (e.target.value as EnvironmentPreset))}
                className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-400"
                title={st.formEnvironment ? ENV_PROFILES[st.formEnvironment]?.desc : 'no preset — legacy chemistry'}
              >
                <option value="off">Legacy (no biome regime)</option>
                {ENV_PRESET_IDS.filter((id): id is EnvironmentPreset => id !== null).map((id) => (
                  <option key={id} value={id}>
                    {id} — {ENV_PROFILES[id].desc}
                  </option>
                ))}
              </select>
              {st.formEnvironment && (
                <div className="mt-1.5 font-mono text-[10px] text-zinc-500">
                  o2 {ENV_PROFILES[st.formEnvironment].o2} · ph {ENV_PROFILES[st.formEnvironment].ph} · toxin{' '}
                  {ENV_PROFILES[st.formEnvironment].toxin} · minerals {ENV_PROFILES[st.formEnvironment].minerals} · water{' '}
                  {ENV_PROFILES[st.formEnvironment].waterFactor} · heat {ENV_PROFILES[st.formEnvironment].heat}
                </div>
              )}
            </div>

            <div className="mb-4">
              <div className="mb-1 text-xs text-zinc-400">Topology</div>
              <div className="grid grid-cols-5 gap-1.5">
                {([null, ...TOPOLOGIES] as (WorldTopology | null)[]).map((t) => {
                  const active = t === st.formTopology;
                  const def = t ? TOPOLOGY_DEFS[t] : TOPOLOGY_DEFS.torus;
                  return (
                    <button
                      key={t ?? 'legacy'}
                      onClick={() => st.setFormTopology(t)}
                      title={def.desc}
                      className={`rounded-lg border px-1 py-1.5 text-[11px] ${
                        active ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30'
                      }`}
                    >
                      {t ?? 'torus'}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {st.formTopology ? TOPOLOGY_DEFS[st.formTopology].desc : TOPOLOGY_DEFS.torus.desc}
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Signal channel (gain)</div>
                <div className="text-[11px] text-zinc-500">0 closes communication; &gt;1 amplifies it (L7 faculty)</div>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={st.formSignalDeposit}
                onChange={(e) => st.setFormSignalDeposit(Number(e.target.value))}
                className="w-28 accent-fuchsia-500"
              />
              <span className="w-8 text-right font-mono text-zinc-200">{st.formSignalDeposit.toFixed(1)}</span>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-zinc-200">Culture channel (meme copy)</div>
                <div className="text-[11px] text-zinc-500">0 closes cultural inheritance; &gt;1 accelerates it (L8 faculty)</div>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={st.formMemeCopyRate}
                onChange={(e) => st.setFormMemeCopyRate(Number(e.target.value))}
                className="w-28 accent-fuchsia-500"
              />
              <span className="w-8 text-right font-mono text-zinc-200">{st.formMemeCopyRate.toFixed(1)}</span>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
              {(
                [
                  { label: 'Discovery', on: st.formDiscovery, set: (v: boolean) => st.setFormDiscovery(v), hint: 'curiosity / novelty events (open-endedness faculty)' },
                  { label: 'Reproduction', on: st.formReproduction, set: (v: boolean) => st.setFormReproduction(v), hint: 'L6 master switch — no offspring when off' },
                  { label: 'Sensing', on: st.formSensing, set: (v: boolean) => st.setFormSensing(v), hint: 'L2 master switch — agents freeze when off' },
                ] as const
              ).map((c) => (
                <button
                  key={c.label}
                  onClick={() => c.set(!c.on)}
                  title={c.hint}
                  className={`rounded-lg border px-2 py-1.5 text-xs ${
                    c.on ? 'border-fuchsia-400 bg-fuchsia-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30'
                  }`}
                >
                  {c.label} {c.on ? 'ON' : 'OFF'}
                </button>
              ))}
            </div>

            {st.formFractal === 'julia' && (
              <div className="mb-3 grid grid-cols-2 gap-3">
                <label className="block text-xs text-zinc-400">
                  cReal
                  <input
                    type="number"
                    step="0.001"
                    value={st.formParams.cReal}
                    onChange={(e) => st.setFormParam('cReal', Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-sm text-white"
                  />
                </label>
                <label className="block text-xs text-zinc-400">
                  cImag
                  <input
                    type="number"
                    step="0.001"
                    value={st.formParams.cImag}
                    onChange={(e) => st.setFormParam('cImag', Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-sm text-white"
                  />
                </label>
              </div>
            )}

            {PARAM_FIELDS.map((f) => (
              <label key={f.key} className="mb-2 block text-xs text-zinc-400">
                <span className="flex justify-between">
                  <span>{f.label}</span>
                  <span className="text-indigo-300">{st.formParams[f.key]}</span>
                </span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={st.formParams[f.key]}
                  onChange={(e) => st.setFormParam(f.key, Number(e.target.value))}
                  className="mt-1 w-full accent-indigo-500"
                />
              </label>
            ))}
              </>
            )}

            {error && <div className="mb-3 rounded-md bg-red-500/20 px-3 py-2 text-xs text-red-300">{error}</div>}

            <button
              onClick={start}
              disabled={busy}
              className="mt-2 w-full rounded-md bg-indigo-500 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {busy ? 'Spawning…' : 'Spawn'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
