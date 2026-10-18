import { create } from 'zustand';
import type {
  WorldConfig,
  WorldStatus,
  SimStats,
  SimEvent,
  LineageNode,
  InterventionType,
  FractalType,
  AgentSummary,
  RadarSample,
} from '@fractal-life/shared';
import { DEFAULT_PARAMS, GENOME_SIZE } from '@fractal-life/shared';
import type { WorldParams, UniverseConfig, EnvironmentPreset, WorldTopology, Intervention } from '@fractal-life/shared';

export interface EventFeedEntry {
  id: number;
  tick: number;
  type: SimEvent['type'];
  significance: number;
  data: Record<string, unknown>;
}

/** Lightweight timeline marker — kept far longer than the detailed feed so the
 *  event strip has run-length history without carrying payloads. */
export interface EventMark {
  id: number;
  tick: number;
  type: SimEvent['type'];
  significance: number;
}

/** A scripted intervention queued by the Event Scheduler. Parts of the payload
 *  are mirrored onto the Intervention at fire time; `firedTick` is set once a
 *  one-shot has run. Set `repeatEvery` to re-arm the event on a cadence;
 *  `remaining` counts fires left (undefined = repeat forever). */
export interface ScheduledEvent {
  id: number;
  label: string;
  type: InterventionType;
  /** tick the intervention should land on */
  tick: number;
  enabled: boolean;
  /** intervention fields (x/y/radius/amount/ticks/timeScale) */
  payload: { x?: number; y?: number; radius?: number; amount?: number; timeScale?: number };
  /** tick the event actually fired on (only terminal for a one-shot) */
  firedTick?: number;
  /** 0/undefined = one-shot; otherwise re-arm every N ticks */
  repeatEvery?: number;
  /** fires left after the current one (undefined = forever); omitted for one-shot */
  remaining?: number;
}

/** detailed feed entries kept for the list view */
export const EVENT_FEED_CAP = 60;
/** timeline marks kept for the event strip */
export const EVENT_MARK_CAP = 2000;

export type SimMode = 'local' | 'remote';

/** How the population is drawn. Same simulation, four views:
 *  particle — agents as glowing motes (the default);
 *  fractal  — the evolved-set terrain dominates, agents demoted to markers;
 *  graph    — agents as nodes, lineage + proximity as edges;
 *  lattice  — agents binned into a spatial grid, cell = population density. */
export type Representation = 'particle' | 'fractal' | 'graph' | 'lattice';

export interface StatsPoint {
  tick: number;
  population: number;
  entropy: number;
  diversity: number;
  complexity: number;
  speciesCount: number;
  cooperation: number;
  predatorFraction: number;
  memeEntropy: number;
  speciesMemeMI: number;
  meanAltruism: number;
  meanAggression: number;
  meanCooperation: number;
  meanRisk: number;
  meanDeception: number;
  predatorGeneFraction: number;
  preyGeneFraction: number;
  energyInequality: number;
  donationRatio: number;
  lyapunovExponent: number;
  selectionEntropy: number;
  fixationIndex: number;
  priceEquationSelection: number;
  foodGradMagMean: number;
  foodLapMean: number;
  velocityDivMean: number;
  velocityCurlMagMean: number;
  caAliveFraction: number;
  caComplexity: number;
  traitTotalVariance: number;
  traitEffectiveDim: number;
  traitAnisotropy: number;
  meanATP: number;
  meanEnzyme: number;
  meanToxin: number;
  meanPH: number;
  chemicalDiversity: number;
  meanGlucose: number;
  meanProtein: number;
  activeSynthesisFraction: number;
  terrainOxygen: number;
  terrainPH: number;
  terrainToxin: number;
  // biophysics observables (opt-in via WorldConfig.biophysics)
  meanForce: number;
  clusterCount: number;
  clusterOrder: number;
  rotationalOrder: number;
  spatialEntropy: number;
  dimensionalEntropy: number;
  orgIndex: number;
  massConservation: number;
  symmetryDrift: number;
  cascadeRate: number;
  bondEnergy: number;
  reactionEnthalpy: number;
  entropyProduction: number;
  carnotEfficiency: number;
  heatWaste: number;
  enginePower: number;
  radiationField: number;
  thermalBalance: number;
  expressionEntropy: number;
  transcriptActivity: number;
  proteinDiversity: number;
  proteomeLoad: number;
  pathwayFlux: number;
  fluxDiversity: number;
  regulationGating: number;
  ecCoupling: number;
  nativeFraction: number;
  misfoldLoad: number;
  foldStability: number;
  tfRegulation: number;
  envRecognition: number;
  expressionNoise: number;
  libraryDiversity: number;
}

/** The "evolved set" â€” per-cell aggregate of the live fractal orbits. */
export interface SetMap {
  tick: number;
  size: number;
  /** per-cell max orbit depth among currently alive lineages (0 = no life). */
  depth: Uint8Array;
  /** per-cell escape marks (255 = a lineage recently diverged here). */
  escape: Uint8Array;
}

/** Ground layer modes â€” what the floor texture visualises. */
export type GroundLayer = 'set' | 'escape' | 'density' | 'energy' | 'culture' | 'gene';

export interface SimState {
  mode: SimMode;
  connected: boolean;
  world: WorldConfig | null;
  status: WorldStatus | null;
  stats: SimStats | null;
  statsHistory: StatsPoint[];
  /** emergence-radar samples pushed by the worker on the stats cadence; the
   *  panel feeds them straight into the shared radarSeries math */
  radarHistory: RadarSample[];
  setMap: SetMap | null;
  paused: boolean;
  stepHeld: boolean;
  targetTickRate: number;
  /** true = sim runs unpaced at CPU speed with the render stream suppressed */
  headless: boolean;
  events: EventFeedEntry[];
  eventMarks: EventMark[];
  eventCounter: number;

  // world creation form
  formSeed: string;
  formFractal: FractalType;
  formParams: WorldParams;
  formCellBio: boolean;
  /** Opt-in mesoscale biophysics telemetry (force field, clustering, thermo). */
  formBiophysics: boolean;
  /** Opt-in molecular-omics telemetry (transcriptomics, proteomics, fluxomics). */
  formOmics: boolean;
  /** Phase C: per-block OU noise on transcription and folding (stochastic draw). */
  formOmicsStochastic: boolean;
  /** Phase C: oligomer library combinatorial chemistry. */
  formCombinatorial: boolean;
  /** Phase C: multi-point crossover + block-shuffle recombination. */
  formRecombination: boolean;
  /** Selected physics frame; null = legacy (no universe). */
  formUniverse: UniverseConfig | null;
  /** Area biome preset at world build; null = legacy chemistry (no biome regime). */
  formEnvironment: EnvironmentPreset | null;
  /** Edge-identification topology; null = torus (legacy). */
  formTopology: WorldTopology | null;
  /** Phase D chemical-terrain environment: signal-channel gain (0..10). */
  formSignalDeposit: number;
  /** Phase D culture channel: meme-copy gain (0..10). */
  formMemeCopyRate: number;
  /** Phase D discovery/curiosity subsystem toggle. */
  formDiscovery: boolean;
  /** Reproduction master switch (false = no offspring ever). */
  formReproduction: boolean;
  /** Sensorimotor master switch (false = agents frozen in place). */
  formSensing: boolean;

  // event scheduler
  scheduledEvents: ScheduledEvent[];
  nextScheduledEventId: number;

  // god-mode tools
  tool: InterventionType | 'none';
  brushSize: number;

  // genome inspector / designer
  /** agent currently inspected (null = inspector closed) */
  selectedAgentId: number | null;
  /** full agent summaries keyed by id â€” populated on demand by the inspector */
  agentsMeta: Map<number, AgentSummary>;
  /** designer genome used by the Spawn tool (null = random spawns) */
  designGenome: Float32Array | null;

  // render layers
  groundLayer: GroundLayer;
  representation: Representation;
  showAgents: boolean;
  showTerrain: boolean;
  showMinimap: boolean;
  showSpecies: boolean;
  showLineage: boolean;
  showCulture: boolean;
  lineage: LineageNode[] | null;

  /** per-panel collapse state, keyed by the panel's registry id. A missing key
   *  means the panel is expanded, so panels never seen before default open. */
  panelCollapsed: Record<string, boolean>;

  cameraZoom: number;
  workerError: string | null;

  // actions
  setMode: (m: SimMode) => void;
  setConnected: (c: boolean) => void;
  setWorld: (w: WorldConfig | null) => void;
  setStatus: (s: WorldStatus | null) => void;
  setStats: (s: SimStats | null) => void;
  pushStatsHistory: (p: StatsPoint) => void;
  pushRadarSample: (s: RadarSample) => void;
  setSetMap: (m: SetMap) => void;
  setPaused: (p: boolean) => void;
  setTargetTickRate: (r: number) => void;
  setHeadless: (h: boolean) => void;
  pushEvent: (e: SimEvent) => void;
  /** one set() for a whole worker batch — the per-tick flush posts dozens of
   *  events at once and a loop of pushEvent calls would churn the store */
  pushEvents: (list: readonly SimEvent[]) => void;
  clearEvents: () => void;
  /** a new world starts a new run: live stats + their history belong to the
   *  old run and must not leak into the atlas / signals charts */
  clearStats: () => void;
  setFormSeed: (s: string) => void;
  setFormFractal: (f: FractalType) => void;
  setFormParam: <K extends keyof WorldParams>(k: K, v: WorldParams[K]) => void;
  setFormCellBio: (v: boolean) => void;
  setFormBiophysics: (v: boolean) => void;
  setFormOmics: (v: boolean) => void;
  setFormOmicsStochastic: (v: boolean) => void;
  setFormCombinatorial: (v: boolean) => void;
  setFormRecombination: (v: boolean) => void;
  setFormUniverse: (u: UniverseConfig | null) => void;
  setFormEnvironment: (e: EnvironmentPreset | null) => void;
  setFormTopology: (t: WorldTopology | null) => void;
  setFormSignalDeposit: (v: number) => void;
  setFormMemeCopyRate: (v: number) => void;
  setFormDiscovery: (v: boolean) => void;
  setFormReproduction: (v: boolean) => void;
  setFormSensing: (v: boolean) => void;
  resetForm: () => void;
  addScheduledEvent: (e: Omit<ScheduledEvent, 'id'>) => void;
  removeScheduledEvent: (id: number) => void;
  toggleScheduledEvent: (id: number) => void;
  markScheduledEventFired: (id: number, tick: number) => void;
  /** fire-and-reschedule: re-arms a repeating event, else marks it terminal. */
  advanceScheduledEvent: (id: number, nowTick: number) => void;
  clearScheduledEvents: () => void;
  setTool: (t: InterventionType | 'none') => void;
  setBrushSize: (n: number) => void;
  setSelectedAgentId: (id: number | null) => void;
  setAgentSummaries: (list: AgentSummary[]) => void;
  patchAgentGenome: (id: number, index: number, value: number) => void;
  setDesignGenome: (g: Float32Array | null) => void;
  setGroundLayer: (l: GroundLayer) => void;
  setRepresentation: (r: Representation) => void;
  setShowAgents: (b: boolean) => void;
  setShowTerrain: (b: boolean) => void;
  setShowMinimap: (b: boolean) => void;
  setShowSpecies: (b: boolean) => void;
  setShowLineage: (b: boolean) => void;
  setShowCulture: (b: boolean) => void;
  setLineage: (l: LineageNode[] | null) => void;
  togglePanel: (id: string) => void;
  setCameraZoom: (z: number) => void;
  setWorkerError: (e: string | null) => void;
}

/** single-set() path shared by pushEvent/pushEvents: newest first, both
 *  arrays capped, ids monotonic across the batch. */
function withBatch(
  st: Pick<SimState, 'events' | 'eventMarks' | 'eventCounter'>,
  list: readonly SimEvent[],
): Pick<SimState, 'events' | 'eventMarks' | 'eventCounter'> {
  const entries: EventFeedEntry[] = [];
  const marks: EventMark[] = [];
  let counter = st.eventCounter;
  for (const e of list) {
    entries.push({ id: counter, tick: e.tick, type: e.type, significance: e.significance, data: e.data });
    marks.push({ id: counter, tick: e.tick, type: e.type, significance: e.significance });
    counter++;
  }
  entries.reverse();
  marks.reverse();
  return {
    events: [...entries, ...st.events].slice(0, EVENT_FEED_CAP),
    eventMarks: [...marks, ...st.eventMarks].slice(0, EVENT_MARK_CAP),
    eventCounter: counter,
  };
}

export const useStore = create<SimState>((set) => ({
  mode: 'local',
  connected: false,
  world: null,
  status: null,
  stats: null,
  statsHistory: [],
  radarHistory: [],
  setMap: null,
  paused: false,
  stepHeld: false,
  targetTickRate: 30,
  headless: false,
  events: [],
  eventMarks: [],
  eventCounter: 0,

  formSeed: '',
  formFractal: 'mandelbrot',
  formParams: { ...DEFAULT_PARAMS },
  formCellBio: false,
  formBiophysics: false,
  formOmics: false,
  formOmicsStochastic: false,
  formCombinatorial: false,
  formRecombination: false,
  formUniverse: null,
  formEnvironment: null,
  formTopology: null,
  formSignalDeposit: 1,
  formMemeCopyRate: 1,
  formDiscovery: false,
  formReproduction: true,
  formSensing: true,

  scheduledEvents: [],
  nextScheduledEventId: 0,

  tool: 'none',
  brushSize: 80,

  selectedAgentId: null,
  agentsMeta: new Map(),
  designGenome: null,

  groundLayer: 'set',
  representation: 'particle',
  showAgents: true,
  showTerrain: true,
  showMinimap: true,
  showSpecies: true,
  showLineage: false,
  showCulture: false,
  lineage: null,

  // The three densest analysis panels start folded so the world view and the
  // vital signs are the first thing on screen; everything else opens by
  // default and stays open (an unknown id reads as expanded).
  panelCollapsed: { atlas: true, radar: true, scheduler: true },

  cameraZoom: 1,
  workerError: null,

  setMode: (m) => set({ mode: m }),
  setConnected: (c) => set({ connected: c }),
  setWorld: (w) => set({ world: w }),
  setStatus: (s) => set({ status: s }),
  setStats: (s) => set({ stats: s }),
  pushStatsHistory: (p) =>
    set((st) => ({ statsHistory: [...st.statsHistory, p].slice(-480) })),
  pushRadarSample: (s) =>
    set((st) => ({ radarHistory: [...st.radarHistory, s].slice(-480) })),
  setSetMap: (m) => set({ setMap: m }),
  setPaused: (p) => set({ paused: p }),
  setTargetTickRate: (r) => set({ targetTickRate: r }),
  setHeadless: (h) => set({ headless: h }),
  pushEvent: (e) => set((st) => withBatch(st, [e])),
  pushEvents: (list) => set((st) => (list.length === 0 ? st : withBatch(st, list))),
  // ids restart with the world: both arrays go together, so a reused id can
  // never collide with anything still mounted
  clearEvents: () => set({ events: [], eventMarks: [], eventCounter: 0 }),
  clearStats: () => set({ stats: null, statsHistory: [], radarHistory: [] }),
  setFormSeed: (s) => set({ formSeed: s }),
  setFormFractal: (f) => set({ formFractal: f }),
  setFormParam: (k, v) => set((st) => ({ formParams: { ...st.formParams, [k]: v } })),
  setFormCellBio: (v) => set({ formCellBio: v }),
  setFormBiophysics: (v) => set({ formBiophysics: v }),
  setFormOmics: (v) => set({ formOmics: v }),
  setFormOmicsStochastic: (v) => set({ formOmicsStochastic: v }),
  setFormCombinatorial: (v) => set({ formCombinatorial: v }),
  setFormRecombination: (v) => set({ formRecombination: v }),
  setFormUniverse: (u) => set({ formUniverse: u }),
  setFormEnvironment: (e) => set({ formEnvironment: e }),
  setFormTopology: (t) => set({ formTopology: t }),
  setFormSignalDeposit: (v) => set({ formSignalDeposit: v }),
  setFormMemeCopyRate: (v) => set({ formMemeCopyRate: v }),
  setFormDiscovery: (v) => set({ formDiscovery: v }),
  setFormReproduction: (v) => set({ formReproduction: v }),
  setFormSensing: (v) => set({ formSensing: v }),
  resetForm: () => set({ formSeed: '', formFractal: 'mandelbrot', formParams: { ...DEFAULT_PARAMS }, formCellBio: false, formBiophysics: false, formOmics: false, formOmicsStochastic: false, formCombinatorial: false, formRecombination: false, formUniverse: null, formEnvironment: null, formTopology: null, formSignalDeposit: 1, formMemeCopyRate: 1, formDiscovery: false, formReproduction: true, formSensing: true }),
  addScheduledEvent: (e) =>
    set((st) => ({
      scheduledEvents: [...st.scheduledEvents, { ...e, id: st.nextScheduledEventId }],
      nextScheduledEventId: st.nextScheduledEventId + 1,
    })),
  removeScheduledEvent: (id) => set((st) => ({ scheduledEvents: st.scheduledEvents.filter((e) => e.id !== id) })),
  toggleScheduledEvent: (id) =>
    set((st) => ({ scheduledEvents: st.scheduledEvents.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)) })),
  markScheduledEventFired: (id, tick) =>
    set((st) => ({ scheduledEvents: st.scheduledEvents.map((e) => (e.id === id ? { ...e, firedTick: tick } : e)) })),
  advanceScheduledEvent: (id, nowTick) =>
    set((st) => ({
      scheduledEvents: st.scheduledEvents.map((e) => {
        if (e.id !== id) return e;
        const repeat = e.repeatEvery ?? 0;
        const left = e.remaining;
        if (repeat > 0 && left !== 0) {
          const nextLeft = left === undefined ? undefined : left - 1;
          if (nextLeft === 0) return { ...e, firedTick: nowTick, remaining: 0 };
          return { ...e, tick: nowTick + repeat, remaining: nextLeft };
        }
        return { ...e, firedTick: nowTick };
      }),
    })),
  clearScheduledEvents: () => set({ scheduledEvents: [], nextScheduledEventId: 0 }),
  setTool: (t) => set({ tool: t }),
  setBrushSize: (n) => set({ brushSize: n }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setAgentSummaries: (list) => {
    const map = new Map<number, AgentSummary>();
    for (const a of list) map.set(a.id, a);
    set({ agentsMeta: map });
  },
  patchAgentGenome: (id, index, value) =>
    set((st) => {
      const cur = st.agentsMeta.get(id);
      if (!cur || index < 0 || index >= GENOME_SIZE) return st;
      const g = cur.genome.slice();
      g[index] = Math.max(-1, Math.min(1, value));
      const next = new Map(st.agentsMeta);
      next.set(id, { ...cur, genome: g });
      return { agentsMeta: next };
    }),
  setDesignGenome: (g) => set({ designGenome: g }),
  setGroundLayer: (l) => set({ groundLayer: l }),
  setRepresentation: (r) => set({ representation: r }),
  setShowAgents: (b) => set({ showAgents: b }),
  setShowTerrain: (b) => set({ showTerrain: b }),
  setShowMinimap: (b) => set({ showMinimap: b }),
  setShowSpecies: (b) => set({ showSpecies: b }),
  setShowLineage: (b) => set({ showLineage: b }),
  setShowCulture: (b) => set({ showCulture: b }),
  setLineage: (l) => set({ lineage: l }),
  togglePanel: (id) =>
    set((st) => ({ panelCollapsed: { ...st.panelCollapsed, [id]: !st.panelCollapsed[id] } })),
  setCameraZoom: (z) => set({ cameraZoom: z }),
  setWorkerError: (e) => set({ workerError: e }),
}));
