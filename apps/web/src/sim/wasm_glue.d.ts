/* tslint:disable */
/* eslint-disable */

export class WasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    agent_summaries_json(): any;
    alive_count(): number;
    all_agent_states_json(): any;
    apply_intervention_json(json: string): void;
    /**
     * Brain telemetry: `{ enabled, meanPlasticity, meanSurprise,
     * plasticAgents }`.
     */
    brain_stats_json(): any;
    build_lineage_json(): any;
    compute_state_hash(): number;
    config_json(): any;
    current_tick(): number;
    debug_agents_json(): any;
    debug_trace_json(): any;
    intervention_log_json(): any;
    constructor(config_json: string);
    /**
     * Configure the plastic recurrent brains: `{ enabled?, lr?, gamma?,
     * lambda?, inherit?, learn?, dropout?, gradNoise?, entropy?, pomdp?,
     * policy? }`. Everything optional — omitting a field keeps the per-agent
     * heritable gene (or the default off-state for the new opt-in features).
     * Must be set before the first tick.
     */
    set_brain_json(json: string): void;
    set_map_json(): any;
    /**
     * Inject the offline enrichment snapshot (real PubChem stoichiometry +
     * GBIF ecology priors) into the engine. Expected shape mirrors the
     * enrichment.json snapshot: `{ chemistry: { stoichiometry: { plant: [8],
     * meat: [8] } }, ecology: { priors: [{ level, occurrenceFraction }] } }`.
     * Must be called before the first tick for a deterministic trajectory.
     */
    set_reality_json(json: string): void;
    /**
     * Suppress the MT_DELTA render frame on subsequent ticks. The simulation
     * trajectory is unchanged (see `tests/record_delta.rs`); only the render
     * payload stops being built. Lets a headless run go faster than a watched
     * one. Defaults to recording.
     */
    set_record_delta(on: boolean): void;
    /**
     * Configure stochastic world dynamics: `{ enabled?, poissonRate?,
     * ouTheta?, ouSigma?, ouBand?, weather? }`. Pass `null` or
     * `{ enabled: false }` to disable. Must be set before the first tick.
     */
    set_world_stoch_json(json: string): void;
    terrain_grid_json(): any;
    tick(): WasmTickResult;
    world_status_json(paused: boolean): any;
}

export class WasmTickResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    delta_bytes(): Uint8Array;
    delta_count(): number;
    events_json(): any;
    stats_json(): any;
    tick(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmengine_free: (a: number, b: number) => void;
    readonly __wbg_wasmtickresult_free: (a: number, b: number) => void;
    readonly wasmengine_agent_summaries_json: (a: number) => [number, number, number];
    readonly wasmengine_alive_count: (a: number) => number;
    readonly wasmengine_all_agent_states_json: (a: number) => [number, number, number];
    readonly wasmengine_apply_intervention_json: (a: number, b: number, c: number) => [number, number];
    readonly wasmengine_brain_stats_json: (a: number) => [number, number, number];
    readonly wasmengine_build_lineage_json: (a: number) => [number, number, number];
    readonly wasmengine_compute_state_hash: (a: number) => number;
    readonly wasmengine_config_json: (a: number) => [number, number, number];
    readonly wasmengine_current_tick: (a: number) => number;
    readonly wasmengine_debug_agents_json: (a: number) => [number, number, number];
    readonly wasmengine_debug_trace_json: (a: number) => [number, number, number];
    readonly wasmengine_intervention_log_json: (a: number) => [number, number, number];
    readonly wasmengine_new: (a: number, b: number) => [number, number, number];
    readonly wasmengine_set_brain_json: (a: number, b: number, c: number) => [number, number];
    readonly wasmengine_set_map_json: (a: number) => [number, number, number];
    readonly wasmengine_set_reality_json: (a: number, b: number, c: number) => [number, number];
    readonly wasmengine_set_record_delta: (a: number, b: number) => void;
    readonly wasmengine_set_world_stoch_json: (a: number, b: number, c: number) => [number, number];
    readonly wasmengine_terrain_grid_json: (a: number) => [number, number, number];
    readonly wasmengine_tick: (a: number) => number;
    readonly wasmengine_world_status_json: (a: number, b: number) => [number, number, number];
    readonly wasmtickresult_delta_bytes: (a: number) => any;
    readonly wasmtickresult_delta_count: (a: number) => number;
    readonly wasmtickresult_events_json: (a: number) => [number, number, number];
    readonly wasmtickresult_stats_json: (a: number) => [number, number, number];
    readonly wasmtickresult_tick: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
