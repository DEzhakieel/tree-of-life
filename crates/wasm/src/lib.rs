use fractal_life_shared::types::*;
use fractal_life_shared::universe::UniverseConfig;
use fractal_life_simulation::chemistry::ChemStoich;
use fractal_life_simulation::engine::{Engine, Grounding};
use js_sys::{Uint8Array, JSON};
use wasm_bindgen::prelude::*;

fn parse_optional_f64(obj: &js_sys::Object, key: &str) -> Option<f64> {
    let v = js_sys::Reflect::get(obj, &key.into()).ok()?;
    if v.is_undefined() || v.is_null() {
        None
    } else {
        v.as_f64()
    }
}

fn parse_universe(parsed: &JsValue) -> Option<UniverseConfig> {
    let obj = js_sys::Reflect::get(parsed, &"universe".into()).ok()?;
    if obj.is_undefined() || obj.is_null() {
        return None;
    }
    let o: js_sys::Object = obj.into();
    Some(UniverseConfig {
        local_gravity: parse_optional_f64(&o, "localGravity"),
        parent_mass: parse_optional_f64(&o, "parentMass"),
        parent_luminosity: parse_optional_f64(&o, "parentLuminosity"),
        parent_teffective: parse_optional_f64(&o, "parentTeffective"),
        planet_radius: parse_optional_f64(&o, "planetRadius"),
        planet_mass: parse_optional_f64(&o, "planetMass"),
        semi_major_axis: parse_optional_f64(&o, "semiMajorAxis"),
        eccentricity: parse_optional_f64(&o, "eccentricity"),
        day_length_sec: parse_optional_f64(&o, "dayLengthSec"),
        atmosphere_pressure: parse_optional_f64(&o, "atmospherePressure"),
        albedo: parse_optional_f64(&o, "albedo"),
        greenhouse_delta: parse_optional_f64(&o, "greenhouseDelta"),
    })
}

/// `WorldConfig.eventPolicy.include` — the event emission filter (absent =
/// all types). Returns None both when the config omits the policy and when
/// `include` is not a string array (mirroring the other optional config flags).
fn parse_event_policy(parsed: &JsValue) -> Option<Vec<String>> {
    let obj = js_sys::Reflect::get(parsed, &"eventPolicy".into()).ok()?;
    if obj.is_undefined() || obj.is_null() {
        return None;
    }
    let inc = js_sys::Reflect::get(&obj, &"include".into()).ok()?;
    if !inc.is_array() {
        return None;
    }
    let arr = js_sys::Array::from(&inc);
    let mut out: Vec<String> = Vec::new();
    for i in 0..arr.length() {
        if let Some(s) = arr.get(i).as_string() {
            out.push(s);
        }
    }
    Some(out)
}

#[wasm_bindgen]
pub struct WasmEngine {
    inner: Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<WasmEngine, JsValue> {
        let parsed = JSON::parse(config_json)?;
        let id = js_sys::Reflect::get(&parsed, &"id".into())?
            .as_string()
            .unwrap_or_default();
        let seed = js_sys::Reflect::get(&parsed, &"seed".into())?
            .as_string()
            .unwrap_or_default();
        let fractal_type = js_sys::Reflect::get(&parsed, &"fractalType".into())?
            .as_string()
            .unwrap_or_else(|| "julia".to_string());
        let created_at = js_sys::Reflect::get(&parsed, &"createdAt".into())?
            .as_f64()
            .unwrap_or(0.0);
        let current_tick = js_sys::Reflect::get(&parsed, &"currentTick".into())?
            .as_f64()
            .unwrap_or(0.0) as u32;

        let params_obj = js_sys::Reflect::get(&parsed, &"params".into())?;
        let params = WorldParams {
            c_real: js_sys::Reflect::get(&params_obj, &"cReal".into())?
                .as_f64()
                .unwrap_or(-0.8),
            c_imag: js_sys::Reflect::get(&params_obj, &"cImag".into())?
                .as_f64()
                .unwrap_or(0.156),
            max_iter: js_sys::Reflect::get(&params_obj, &"maxIter".into())?
                .as_f64()
                .unwrap_or(256.0) as u32,
            escape_radius: js_sys::Reflect::get(&params_obj, &"escapeRadius".into())?
                .as_f64()
                .unwrap_or(65536.0),
            center_x: js_sys::Reflect::get(&params_obj, &"centerX".into())?
                .as_f64()
                .unwrap_or(-0.6),
            center_y: js_sys::Reflect::get(&params_obj, &"centerY".into())?
                .as_f64()
                .unwrap_or(0.0),
            world_scale: js_sys::Reflect::get(&params_obj, &"worldScale".into())?
                .as_f64()
                .unwrap_or(4.0),
            spawn_count: js_sys::Reflect::get(&params_obj, &"spawnCount".into())?
                .as_f64()
                .unwrap_or(300.0) as usize,
            metabolism_base: js_sys::Reflect::get(&params_obj, &"metabolismBase".into())?
                .as_f64()
                .unwrap_or(1.0),
            max_population: js_sys::Reflect::get(&params_obj, &"maxPopulation".into())?
                .as_f64()
                .unwrap_or(4000.0) as usize,
            food_regen_rate: js_sys::Reflect::get(&params_obj, &"foodRegenRate".into())?
                .as_f64()
                .unwrap_or(0.0003),
            energy_capacity: js_sys::Reflect::get(&params_obj, &"energyCapacity".into())?
                .as_f64()
                .unwrap_or(100.0),
            agent_max_age: js_sys::Reflect::get(&params_obj, &"agentMaxAge".into())?
                .as_f64()
                .unwrap_or(4000.0),
            time_scale: js_sys::Reflect::get(&params_obj, &"timeScale".into())?
                .as_f64()
                .unwrap_or(1.0),
            day_length: js_sys::Reflect::get(&params_obj, &"dayLength".into())?
                .as_f64()
                .unwrap_or(2400.0) as u32,
            season_length: js_sys::Reflect::get(&params_obj, &"seasonLength".into())?
                .as_f64()
                .unwrap_or(20000.0) as u32,
        };

        let config = WorldConfig {
            id,
            seed,
            fractal_type: Box::leak(fractal_type.into_boxed_str()),
            params,
            created_at,
            current_tick,
            universe: parse_universe(&parsed),
            cell_bio: {
                let v =
                    js_sys::Reflect::get(&parsed, &"cellBio".into()).unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            biophysics: {
                let v = js_sys::Reflect::get(&parsed, &"biophysics".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            omics: {
                let v =
                    js_sys::Reflect::get(&parsed, &"omics".into()).unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            omics_stochastic: {
                let v = js_sys::Reflect::get(&parsed, &"omicsStochastic".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            combinatorial: {
                let v = js_sys::Reflect::get(&parsed, &"combinatorial".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            recombination: {
                let v = js_sys::Reflect::get(&parsed, &"recombination".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            folding: {
                let v =
                    js_sys::Reflect::get(&parsed, &"folding".into()).unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            discovery: {
                let v = js_sys::Reflect::get(&parsed, &"discovery".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            stochastic_dynamics: {
                let v = js_sys::Reflect::get(&parsed, &"stochasticDynamics".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            environment: {
                let v = js_sys::Reflect::get(&parsed, &"environment".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_string().and_then(|s| EnvironmentPreset::from_name(&s))
                }
            },
            topology: {
                let v =
                    js_sys::Reflect::get(&parsed, &"topology".into()).unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_string().and_then(|s| WorldTopology::from_name(&s))
                }
            },
            signal_deposit: {
                let v = js_sys::Reflect::get(&parsed, &"signalDeposit".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_f64().map(|n| n as f32)
                }
            },
            meme_copy_rate: {
                let v = js_sys::Reflect::get(&parsed, &"memeCopyRate".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_f64().map(|n| n as f32)
                }
            },
            reproduction: {
                let v = js_sys::Reflect::get(&parsed, &"reproduction".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
            sensing: {
                let v = js_sys::Reflect::get(&parsed, &"sensing".into())
                    .unwrap_or(JsValue::UNDEFINED);
                if v.is_undefined() || v.is_null() {
                    None
                } else {
                    v.as_bool()
                }
            },
        };

        let mut engine = Engine::new(config);
        engine.set_event_policy(parse_event_policy(&parsed));
        Ok(WasmEngine { inner: engine })
    }

    pub fn tick(&mut self) -> WasmTickResult {
        let result = self.inner.tick();
        WasmTickResult {
            tick: result.tick,
            delta_count: result.delta_count,
            delta: result.delta,
            stats: result.stats,
            events: result.events,
        }
    }

    pub fn current_tick(&self) -> u32 {
        self.inner.current_tick()
    }

    pub fn alive_count(&self) -> u32 {
        self.inner.alive_count()
    }

    /// Suppress the MT_DELTA render frame on subsequent ticks. The simulation
    /// trajectory is unchanged (see `tests/record_delta.rs`); only the render
    /// payload stops being built. Lets a headless run go faster than a watched
    /// one. Defaults to recording.
    pub fn set_record_delta(&mut self, on: bool) {
        self.inner.set_record_delta(on);
    }

    pub fn all_agent_states_json(&self) -> Result<JsValue, JsValue> {
        let agents = self.inner.all_agent_states();
        let mut json = String::from("[");
        for (i, a) in agents.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "{{\"id\":{},\"x\":{},\"y\":{},\"energy\":{},\"state\":{},\"species\":{},\"meme\":{}}}",
                a.id, a.x, a.y, a.energy, a.state, a.species, a.meme
            ));
        }
        json.push(']');
        JSON::parse(&json)
    }

    pub fn config_json(&self) -> Result<JsValue, JsValue> {
        let c = &self.inner.config;
        let p = &c.params;
        let json = format!(
            "{{\"id\":\"{}\",\"seed\":\"{}\",\"fractalType\":\"{}\",\"createdAt\":{},\"currentTick\":{},\"params\":{{\"cReal\":{},\"cImag\":{},\"maxIter\":{},\"escapeRadius\":{},\"centerX\":{},\"centerY\":{},\"worldScale\":{},\"spawnCount\":{},\"metabolismBase\":{},\"maxPopulation\":{},\"foodRegenRate\":{},\"energyCapacity\":{},\"agentMaxAge\":{},\"timeScale\":{},\"dayLength\":{},\"seasonLength\":{}}}}}",
            c.id, c.seed, c.fractal_type, c.created_at, c.current_tick,
            p.c_real, p.c_imag, p.max_iter, p.escape_radius,
            p.center_x, p.center_y, p.world_scale, p.spawn_count,
            p.metabolism_base, p.max_population, p.food_regen_rate,
            p.energy_capacity, p.agent_max_age, p.time_scale,
            p.day_length, p.season_length
        );
        JSON::parse(&json)
    }

    pub fn world_status_json(&self, paused: bool) -> Result<JsValue, JsValue> {
        let status = self.inner.world_status(paused);
        let p = &status.params;
        let json = format!(
            "{{\"id\":\"{}\",\"seed\":\"{}\",\"fractalType\":\"{}\",\"currentTick\":{},\"population\":{},\"aliveCount\":{},\"speciesCount\":{},\"createdAt\":{},\"interventions\":{},\"paused\":{},\"params\":{{\"cReal\":{},\"cImag\":{},\"maxIter\":{},\"escapeRadius\":{},\"centerX\":{},\"centerY\":{},\"worldScale\":{},\"spawnCount\":{},\"metabolismBase\":{},\"maxPopulation\":{},\"foodRegenRate\":{},\"energyCapacity\":{},\"agentMaxAge\":{},\"timeScale\":{},\"dayLength\":{},\"seasonLength\":{}}}}}",
            status.id, status.seed, status.fractal_type,
            status.current_tick, status.population, status.alive_count,
            status.species_count, status.created_at, status.interventions, status.paused,
            p.c_real, p.c_imag, p.max_iter, p.escape_radius,
            p.center_x, p.center_y, p.world_scale, p.spawn_count,
            p.metabolism_base, p.max_population, p.food_regen_rate,
            p.energy_capacity, p.agent_max_age, p.time_scale,
            p.day_length, p.season_length
        );
        JSON::parse(&json)
    }

    pub fn set_map_json(&self) -> Result<JsValue, JsValue> {
        let tick = self.inner.current_tick();
        let size = self.inner.set_map_size();
        let depth = self.inner.set_map_depth();
        let escape = self.inner.set_map_escape();

        let mut depth_str = String::with_capacity(depth.len() * 2);
        for (i, &v) in depth.iter().enumerate() {
            if i > 0 {
                depth_str.push(',');
            }
            depth_str.push_str(&v.to_string());
        }
        let mut escape_str = String::with_capacity(escape.len() * 2);
        for (i, &v) in escape.iter().enumerate() {
            if i > 0 {
                escape_str.push(',');
            }
            escape_str.push_str(&v.to_string());
        }

        let json = format!(
            "{{\"tick\":{},\"size\":{},\"depth\":[{}],\"escape\":[{}]}}",
            tick, size, depth_str, escape_str
        );
        JSON::parse(&json)
    }

    pub fn agent_summaries_json(&self) -> Result<JsValue, JsValue> {
        let raw = self.inner.agent_summaries_json();
        JSON::parse(&raw)
    }

    pub fn debug_agents_json(&self) -> Result<JsValue, JsValue> {
        let raw = self.inner.debug_agents_json();
        JSON::parse(&raw)
    }

    pub fn debug_trace_json(&self) -> Result<JsValue, JsValue> {
        let t = &self.inner.trace;
        let sensors: Vec<String> = t.sensors.iter().map(|x| format!("{}", *x as f64)).collect();
        let out: Vec<String> = t.out.iter().map(|x| format!("{}", *x as f64)).collect();
        let act: Vec<String> = t.act.iter().map(|x| format!("{}", *x as f64)).collect();
        let eps: Vec<String> = t
            .eps
            .iter()
            .take(2)
            .map(|x| format!("{}", *x as f64))
            .collect();
        let belief: Vec<String> = t.belief.iter().map(|x| format!("{}", *x as f64)).collect();
        let obs_raw: Vec<String> = t.obs_raw.iter().map(|x| format!("{}", *x as f64)).collect();
        let noise: Vec<String> = t
            .obs_noise
            .iter()
            .take(fractal_life_simulation::brain::POMDP_BELIEF)
            .map(|x| format!("{}", *x as f64))
            .collect();
        let json = format!(
            "{{\"tick\":{},\"agent\":{},\"sensors\":[{}],\"out\":[{}],\"driveX\":{},\"driveY\":{},\"dAlgY\":{},\"dCoY\":{},\"dSepY\":{},\"dOscY\":{},\"dNoiseY\":{},\"ph\":{},\"osc\":{},\"noise\":{},\"sinPh\":{},\"cosPh\":{},\"thrustX\":{},\"thrustY\":{},\"waterFrac\":{},\"dh\":{},\"hazard\":{},\"chemMod\":{},\"flux\":{},\"zmag2\":{},\"daylight\":{},\"seasonPhase\":{},\"seasonMoisture\":{},\"energyBefore\":{},\"nbCount\":{},\"weatherId\":{},\"weatherMoisture\":{},\"weatherGrowth\":{},\"sigma\":{},\"act\":[{}],\"eps\":[{}],\"belief\":[{}],\"obsRaw\":[{}],\"obsNoise\":[{}]}}",
            t.tick, t.agent_id, sensors.join(","), out.join(","), t.drive_x, t.drive_y, t.d_alg_y, t.d_co_y, t.d_sep_y, t.d_osc_y, t.d_noise_y, t.ph, t.osc, t.noise, t.sin_ph, t.cos_ph, t.thrust_x, t.thrust_y,
            t.water_frac, t.dh, t.hazard, t.chem_mod, t.flux, t.zmag2, t.daylight, t.season_phase,
            t.season_moisture, t.energy_before, t.nb_count,
            t.weather_id, t.weather_moisture, t.weather_growth, t.policy_sigma,
            act.join(","), eps.join(","), belief.join(","), obs_raw.join(","), noise.join(",")
        );
        JSON::parse(&json)
    }

    pub fn terrain_grid_json(&self) -> Result<JsValue, JsValue> {
        let g = &self.inner.grid;
        let f = |v: &[f32]| {
            let mut s = String::with_capacity(v.len() * 24);
            for (i, &x) in v.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&format!("{}", x as f64));
            }
            s
        };
        let json = format!(
            "{{\"size\":{},\"cell\":{},\"height\":[{}],\"energy\":[{}],\"moisture\":[{}],\"hazard\":[{}],\"chem\":[{}],\"baseMinerals\":[{}],\"minerals\":[{}],\"food\":[{}],\"meat\":[{}],\"signal\":[{}],\"cap\":[{}]}}",
            g.size, g.cell,
            f(&g.height), f(&g.energy), f(&g.moisture), f(&g.hazard), f(&g.chem),
            f(&g.base_minerals), f(&g.minerals), f(&g.food), f(&g.meat),
            f(&g.signal), f(&g.cap),
        );
        JSON::parse(&json)
    }

    pub fn compute_state_hash(&self) -> u32 {
        self.inner.compute_state_hash_value()
    }

    pub fn apply_intervention_json(&mut self, json: &str) -> Result<(), JsValue> {
        let parsed = JSON::parse(json)?;
        let itype_str = js_sys::Reflect::get(&parsed, &"type".into())?
            .as_string()
            .unwrap_or_default();
        let itype = match itype_str.as_str() {
            "meteor" => InterventionType::Meteor,
            "seedFood" => InterventionType::SeedFood,
            "spawnAgent" => InterventionType::SpawnAgent,
            "pauseRegion" => InterventionType::PauseRegion,
            "setTimeScale" => InterventionType::SetTimeScale,
            "nuke" => InterventionType::Nuke,
            "setGene" => InterventionType::SetGene,
            _ => InterventionType::Nuke,
        };

        let get_f = |key: &str| -> Result<Option<f32>, JsValue> {
            let v = js_sys::Reflect::get(&parsed, &key.into())?;
            if v.is_undefined() || v.is_null() {
                Ok(None)
            } else {
                Ok(v.as_f64().map(|n| n as f32))
            }
        };
        let get_f64 = |key: &str| -> Result<Option<f64>, JsValue> {
            let v = js_sys::Reflect::get(&parsed, &key.into())?;
            if v.is_undefined() || v.is_null() {
                Ok(None)
            } else {
                Ok(v.as_f64())
            }
        };
        let x = get_f64("x")?;
        let y = get_f64("y")?;
        let radius = get_f("radius")?;
        let amount = get_f("amount")?;
        let ticks = get_f("ticks")?.map(|n| n.round() as u32);
        let time_scale = get_f64("timeScale")?;
        let sequence = get_f("sequence")?.map(|n| n.round() as u32).unwrap_or(0);

        let genome: Option<Vec<f32>> = {
            let g = js_sys::Reflect::get(&parsed, &"genome".into())?;
            if g.is_undefined() || g.is_null() {
                None
            } else {
                let arr = js_sys::Array::from(&g);
                let mut out = Vec::with_capacity(arr.length() as usize);
                for i in 0..arr.length() {
                    out.push(arr.get(i).as_f64().unwrap_or(0.0) as f32);
                }
                Some(out)
            }
        };
        let get_u32 = |key: &str| -> Result<Option<u32>, JsValue> {
            let v = js_sys::Reflect::get(&parsed, &key.into())?;
            if v.is_undefined() || v.is_null() {
                Ok(None)
            } else {
                Ok(v.as_f64().map(|n| n.round() as u32))
            }
        };
        let agent_id = get_u32("agentId")?;
        let index = get_u32("index")?;
        let value = get_f("value")?;

        let iv = Intervention {
            itype,
            x,
            y,
            radius,
            amount,
            ticks,
            genome,
            time_scale,
            agent_id,
            index,
            value,
            sequence,
        };
        self.inner.apply_intervention(&iv);
        Ok(())
    }

    /// Inject the offline enrichment snapshot (real PubChem stoichiometry +
    /// GBIF ecology priors) into the engine. Expected shape mirrors the
    /// enrichment.json snapshot: `{ chemistry: { stoichiometry: { plant: [8],
    /// meat: [8] } }, ecology: { priors: [{ level, occurrenceFraction }] } }`.
    /// Must be called before the first tick for a deterministic trajectory.
    pub fn set_reality_json(&mut self, json: &str) -> Result<(), JsValue> {
        let parsed = JSON::parse(json)?;

        let mut plant = [0.0f64; 8];
        let mut meat = [0.0f64; 8];
        let mut have_plant = false;

        if let Ok(chem) = js_sys::Reflect::get(&parsed, &"chemistry".into()) {
            if let Ok(sto) = js_sys::Reflect::get(&chem, &"stoichiometry".into()) {
                if let Ok(pl) = js_sys::Reflect::get(&sto, &"plant".into()) {
                    if let Ok(parr) = pl.dyn_into::<js_sys::Array>() {
                        for i in 0..(8.min(parr.length() as usize)) {
                            plant[i] = parr.get(i as u32).as_f64().unwrap_or(0.0);
                        }
                        have_plant = true;
                    }
                }
                if let Ok(me) = js_sys::Reflect::get(&sto, &"meat".into()) {
                    if let Ok(marr) = me.dyn_into::<js_sys::Array>() {
                        for i in 0..(8.min(marr.length() as usize)) {
                            meat[i] = marr.get(i as u32).as_f64().unwrap_or(0.0);
                        }
                    }
                }
            }
        }

        // Derive per-trophic-level expected fractions from real GBIF priors,
        // mirroring the TS engine: levels absent from the data fall back to the
        // top (apex) value so exotic assignments don't run unbounded.
        let mut eco_fra = [0.0f32; 5];
        if let Ok(eco) = js_sys::Reflect::get(&parsed, &"ecology".into()) {
            if let Ok(priors) = js_sys::Reflect::get(&eco, &"priors".into()) {
                if let Ok(arr) = priors.dyn_into::<js_sys::Array>() {
                    let mut last_top = 0.0f32;
                    for i in 0..arr.length() {
                        let p = arr.get(i);
                        let level = js_sys::Reflect::get(&p, &"level".into())
                            .ok()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0) as usize;
                        let frac = js_sys::Reflect::get(&p, &"occurrenceFraction".into())
                            .ok()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0) as f32;
                        let f = if frac > 0.0 { frac } else { 0.0 };
                        if level < 5 {
                            eco_fra[level] = f;
                        }
                        last_top = f;
                    }
                    for lv in (0..5).rev() {
                        if eco_fra[lv] == 0.0 {
                            eco_fra[lv] = last_top;
                        }
                    }
                }
            }
        }

        let chem_stoich = if have_plant {
            Some(ChemStoich::grounded(plant, meat))
        } else {
            None
        };
        let grounding = Grounding {
            chem_stoich,
            eco_fra,
            enabled: true,
        };
        self.inner.set_grounding(grounding);
        Ok(())
    }

    /// Configure the plastic recurrent brains: `{ enabled?, lr?, gamma?,
    /// lambda?, inherit?, learn?, dropout?, gradNoise?, entropy?, pomdp?,
    /// policy? }`. Everything optional — omitting a field keeps the per-agent
    /// heritable gene (or the default off-state for the new opt-in features).
    /// Must be set before the first tick.
    pub fn set_brain_json(&mut self, json: &str) -> Result<(), JsValue> {
        let parsed = JSON::parse(json)?;
        let get_opt = |key: &str| -> Result<Option<f64>, JsValue> {
            let v = js_sys::Reflect::get(&parsed, &JsValue::from(key))?;
            if v.is_undefined() || v.is_null() {
                Ok(None)
            } else {
                Ok(v.as_f64())
            }
        };
        let get_num =
            |key: &str, dflt: f64| -> Result<f64, JsValue> { Ok(get_opt(key)?.unwrap_or(dflt)) };
        let learn = match js_sys::Reflect::get(&parsed, &"learn".into())
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default()
            .as_str()
        {
            "backprop" => fractal_life_simulation::brain::LearnRule::Backprop,
            _ => fractal_life_simulation::brain::LearnRule::Hebbian,
        };
        let pomdp = {
            let obj = js_sys::Reflect::get(&parsed, &"pomdp".into())?;
            if obj.is_undefined() || obj.is_null() {
                None
            } else {
                let hidden = {
                    let h = js_sys::Reflect::get(&obj, &"hidden".into())?;
                    if h.is_undefined() || h.is_null() {
                        None
                    } else {
                        let arr = js_sys::Array::from(&h);
                        let mut out = Vec::with_capacity(arr.length() as usize);
                        for i in 0..arr.length() {
                            out.push(arr.get(i).as_f64().unwrap_or(0.0) as usize);
                        }
                        Some(out)
                    }
                };
                let f = |key: &str, dflt: f64| -> f64 {
                    js_sys::Reflect::get(&obj, &JsValue::from(key))
                        .ok()
                        .and_then(|v| v.as_f64())
                        .unwrap_or(dflt)
                };
                Some(fractal_life_simulation::brain::PomdpConfig {
                    enabled: js_sys::Reflect::get(&obj, &"enabled".into())
                        .ok()
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    noise: f("noise", 0.08),
                    gain: f("gain", 0.2),
                    weight: f("weight", 0.4),
                    hidden,
                })
            }
        };
        let policy = {
            let obj = js_sys::Reflect::get(&parsed, &"policy".into())?;
            if obj.is_undefined() || obj.is_null() {
                None
            } else {
                let mode = match js_sys::Reflect::get(&obj, &"mode".into())
                    .ok()
                    .and_then(|v| v.as_string())
                    .unwrap_or_default()
                    .as_str()
                {
                    "gaussian" => fractal_life_simulation::brain::PolicyMode::Gaussian,
                    _ => fractal_life_simulation::brain::PolicyMode::Deterministic,
                };
                let f = |key: &str, dflt: f64| -> f64 {
                    js_sys::Reflect::get(&obj, &JsValue::from(key))
                        .ok()
                        .and_then(|v| v.as_f64())
                        .unwrap_or(dflt)
                };
                Some(fractal_life_simulation::brain::PolicyConfig {
                    mode,
                    sigma: f("sigma", 0.4),
                    sigma_min: f("sigmaMin", 0.05),
                    anneal_ticks: f("annealTicks", 0.0) as u32,
                })
            }
        };
        let cfg = fractal_life_simulation::brain::BrainConfig {
            enabled: js_sys::Reflect::get(&parsed, &"enabled".into())
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            lr_override: get_opt("lr")?,
            gamma_override: get_opt("gamma")?,
            lambda_override: get_opt("lambda")?,
            inherit_override: get_opt("inherit")?,
            learn,
            pomdp,
            policy,
            dropout: get_num("dropout", 0.0)?,
            grad_noise: get_num("gradNoise", 0.0)?,
            entropy: get_num("entropy", 0.0)?,
        };
        self.inner.set_brain_config(cfg);
        Ok(())
    }

    /// Configure stochastic world dynamics: `{ enabled?, poissonRate?,
    /// ouTheta?, ouSigma?, ouBand?, weather? }`. Pass `null` or
    /// `{ enabled: false }` to disable. Must be set before the first tick.
    pub fn set_world_stoch_json(&mut self, json: &str) -> Result<(), JsValue> {
        let parsed = JSON::parse(json)?;
        if parsed.is_null() {
            self.inner.set_world_stochastics(None);
            return Ok(());
        }
        let enabled = js_sys::Reflect::get(&parsed, &"enabled".into())
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !enabled {
            self.inner.set_world_stochastics(None);
            return Ok(());
        }
        let get_opt = |key: &str| -> Result<Option<f64>, JsValue> {
            let v = js_sys::Reflect::get(&parsed, &JsValue::from(key))?;
            if v.is_undefined() || v.is_null() {
                Ok(None)
            } else {
                Ok(v.as_f64())
            }
        };
        let weather = {
            let w = js_sys::Reflect::get(&parsed, &"weather".into())?;
            if w.is_undefined() || w.is_null() {
                None
            } else {
                let arr = js_sys::Array::from(&w);
                let mut m = [[0.0f64; 4]; 4];
                for i in 0..4 {
                    let row_arr = js_sys::Array::from(&arr.get(i));
                    for j in 0..4 {
                        m[i as usize][j as usize] = row_arr.get(j).as_f64().unwrap_or(0.0);
                    }
                }
                Some(m)
            }
        };
        let cfg = fractal_life_simulation::world_stoch::WorldStochasticConfig {
            enabled: true,
            poisson_rate: get_opt("poissonRate")?.unwrap_or(40.0),
            ou_theta: get_opt("ouTheta")?.unwrap_or(0.01),
            ou_sigma: get_opt("ouSigma")?.unwrap_or(0.02),
            ou_band: get_opt("ouBand")?.unwrap_or(0.25),
            weather,
        };
        self.inner.set_world_stochastics(Some(cfg));
        Ok(())
    }

    /// Brain telemetry: `{ enabled, meanPlasticity, meanSurprise,
    /// plasticAgents }`.
    pub fn brain_stats_json(&self) -> Result<JsValue, JsValue> {
        let (mean_plasticity, mean_surprise, plastic_agents) = self.inner.brain_stats();
        let json = format!(
            "{{\"enabled\":{},\"meanPlasticity\":{},\"meanSurprise\":{},\"plasticAgents\":{}}}",
            self.inner.brain_config().enabled,
            mean_plasticity,
            mean_surprise,
            plastic_agents
        );
        JSON::parse(&json)
    }

    pub fn intervention_log_json(&self) -> Result<JsValue, JsValue> {
        let log = &self.inner.intervention_log;
        let mut json = String::from("[");
        for (i, (tick, iv)) in log.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            let tname = iv.itype.as_name();
            let x =
                iv.x.map(|v| format!("{v}"))
                    .unwrap_or_else(|| "null".to_string());
            let y =
                iv.y.map(|v| format!("{v}"))
                    .unwrap_or_else(|| "null".to_string());
            json.push_str(&format!(
                "{{\"tick\":{},\"intervention\":{{\"type\":\"{}\",\"x\":{},\"y\":{},\"sequence\":{}}}}}",
                tick, tname, x, y, iv.sequence
            ));
        }
        json.push(']');
        JSON::parse(&json)
    }

    pub fn build_lineage_json(&self) -> Result<JsValue, JsValue> {
        let lineage = self.inner.build_lineage();
        let mut json = String::from("[");
        for (i, n) in lineage.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "{{\"id\":{},\"parentId\":{},\"bornAtTick\":{},\"diedAtTick\":{},\"species\":{},\"finalFitness\":{},\"alive\":{}}}",
                n.id, n.parent_id, n.born_at_tick, n.died_at_tick,
                n.species, n.final_fitness, n.alive
            ));
        }
        json.push(']');
        JSON::parse(&json)
    }
}

#[wasm_bindgen]
pub struct WasmTickResult {
    tick: u32,
    delta_count: u32,
    delta: Vec<u8>,
    stats: SimStats,
    events: Vec<fractal_life_simulation::engine::SimEvent>,
}

#[wasm_bindgen]
impl WasmTickResult {
    pub fn tick(&self) -> u32 {
        self.tick
    }

    pub fn delta_count(&self) -> u32 {
        self.delta_count
    }

    pub fn delta_bytes(&self) -> Uint8Array {
        Uint8Array::from(&self.delta[..])
    }

    pub fn stats_json(&self) -> Result<JsValue, JsValue> {
        let s = &self.stats;
        let json = format!(
            "{{\
\"tick\":{},\"population\":{},\"aliveCount\":{},\"deadCount\":{},\"speciesCount\":{},\
\"avgEnergy\":{},\"avgWater\":{},\"tickRate\":{},\"stateHash\":{},\"timeScale\":{},\
\"energySum\":{},\"births\":{},\"deaths\":{},\"escapeDeaths\":{},\
\"entropy\":{},\"diversity\":{},\"complexity\":{},\"cooperation\":{},\"predatorFraction\":{},\
\"cultureCount\":{},\"meanAltruism\":{},\"memeEntropy\":{},\"speciesMemeMI\":{},\
\"meanAggression\":{},\"meanCooperation\":{},\"meanRisk\":{},\"meanDeception\":{},\
\"predatorGeneFraction\":{},\"preyGeneFraction\":{},\"energyInequality\":{},\"donationRatio\":{},\
\"lyapunovExponent\":{},\"selectionEntropy\":{},\"fixationIndex\":{},\"priceEquationSelection\":{},\
\"foodGradMagMean\":{},\"foodLapMean\":{},\"velocityDivMean\":{},\"velocityCurlMagMean\":{},\
\"caAliveFraction\":{},\"caComplexity\":{},\
\"traitTotalVariance\":{},\"traitEffectiveDim\":{},\"traitAnisotropy\":{},\
\"meanATP\":{},\"meanEnzyme\":{},\"meanToxin\":{},\"meanPH\":{},\"chemicalDiversity\":{},\
\"meanGlucose\":{},\"meanProtein\":{},\"activeSynthesisFraction\":{},\
\"terrainOxygen\":{},\"terrainPH\":{},\"terrainToxin\":{},\
\"meanDNAIntegrity\":{},\"meanPathogenLoad\":{},\"meanMembranePot\":{},\
\"meanBodyTemp\":{},\"meanTrophicLevel\":{},\
\"speciationRate\":{},\"extinctionRate\":{},\"biodiversityIndex\":{},\
\"meanFitness\":{},\"meanDivisionProgress\":{},\
\"meanPlasticity\":{},\"meanSurprise\":{},\"plasticAgents\":{},\
\"meanForce\":{},\"clusterCount\":{},\"clusterOrder\":{},\"rotationalOrder\":{},\
\"spatialEntropy\":{},\"dimensionalEntropy\":{},\"orgIndex\":{},\"massConservation\":{},\"symmetryDrift\":{},\
\"cascadeRate\":{},\"bondEnergy\":{},\"reactionEnthalpy\":{},\"entropyProduction\":{},\"carnotEfficiency\":{},\
\"heatWaste\":{},\"enginePower\":{},\"radiationField\":{},\"thermalBalance\":{},\
\"expressionEntropy\":{},\"transcriptActivity\":{},\"proteinDiversity\":{},\"proteomeLoad\":{},\
\"pathwayFlux\":{},\"fluxDiversity\":{},\"regulationGating\":{},\"ecCoupling\":{},\
\"nativeFraction\":{},\"misfoldLoad\":{},\"foldStability\":{},\"tfRegulation\":{},\
\"envRecognition\":{},\"expressionNoise\":{},\"libraryDiversity\":{},\
\"discoveryRate\":{},\"noveltyMean\":{},\"memoryDiversity\":{},\"explorationFraction\":{},\
\"behaviorNoise\":{},\"mutationBurstRate\":{},\"chaperoneLoad\":{},\"aggregateLoad\":{},\
\"foldFidelity\":{},\"proteotoxicity\":{},\"libraryCoverage\":{},\"bindingSpecificity\":{},\
\"combinatorialEntropy\":{}}}",
            s.tick,
            s.population,
            s.alive_count,
            s.dead_count,
            s.species_count,
            s.avg_energy,
            s.avg_water,
            s.tick_rate,
            s.state_hash,
            s.time_scale,
            s.energy_sum,
            s.births,
            s.deaths,
            s.escape_deaths,
            s.entropy,
            s.diversity,
            s.complexity,
            s.cooperation,
            s.predator_fraction,
            s.culture_count,
            s.mean_altruism,
            s.meme_entropy,
            s.species_meme_mi,
            s.mean_aggression,
            s.mean_cooperation,
            s.mean_risk,
            s.mean_deception,
            s.predator_gene_fraction,
            s.prey_gene_fraction,
            s.energy_inequality,
            s.donation_ratio,
            s.lyapunov_exponent,
            s.selection_entropy,
            s.fixation_index,
            s.price_equation_selection,
            s.food_grad_mag_mean,
            s.food_lap_mean,
            s.velocity_div_mean,
            s.velocity_curl_mag_mean,
            s.ca_alive_fraction,
            s.ca_complexity,
            s.trait_total_variance,
            s.trait_effective_dim,
            s.trait_anisotropy,
            s.mean_atp,
            s.mean_enzyme,
            s.mean_toxin,
            s.mean_ph,
            s.chemical_diversity,
            s.mean_glucose,
            s.mean_protein,
            s.active_synthesis_fraction,
            s.terrain_oxygen,
            s.terrain_ph,
            s.terrain_toxin,
            s.mean_dna_integrity,
            s.mean_pathogen_load,
            s.mean_membrane_pot,
            s.mean_body_temp,
            s.mean_trophic_level,
            s.speciation_rate,
            s.extinction_rate,
            s.biodiversity_index,
            s.mean_fitness,
            s.mean_division_progress,
            s.mean_plasticity,
            s.mean_surprise,
            s.plastic_agents,
            s.mean_force,
            s.cluster_count,
            s.cluster_order,
            s.rotational_order,
            s.spatial_entropy,
            s.dimensional_entropy,
            s.org_index,
            s.mass_conservation,
            s.symmetry_drift,
            s.cascade_rate,
            s.bond_energy,
            s.reaction_enthalpy,
            s.entropy_production,
            s.carnot_efficiency,
            s.heat_waste,
            s.engine_power,
            s.radiation_field,
            s.thermal_balance,
            s.expression_entropy,
            s.transcript_activity,
            s.protein_diversity,
            s.proteome_load,
            s.pathway_flux,
            s.flux_diversity,
            s.regulation_gating,
            s.ec_coupling,
            s.native_fraction,
            s.misfold_load,
            s.fold_stability,
            s.tf_regulation,
            s.env_recognition,
            s.expression_noise,
            s.library_diversity,
            // Phase D observables (opt-in via WorldConfig.discovery/folding/
            // stochasticDynamics). Mirrors engine.ts's crawlerParity JSON keys so
            // the TS ↔ Rust parity harness never sees spurious deltas.
            s.discovery_rate,
            s.novelty_mean,
            s.memory_diversity,
            s.exploration_fraction,
            s.behavior_noise,
            s.mutation_burst_rate,
            s.chaperone_load,
            s.aggregate_load,
            s.fold_fidelity,
            s.proteotoxicity,
            s.library_coverage,
            s.binding_specificity,
            s.combinatorial_entropy,
        );
        JSON::parse(&json)
    }

    pub fn events_json(&self) -> Result<JsValue, JsValue> {
        // serde-wasm-bindgen: SimEvent derives Serialize, payload fields come
        // through as plain camelCase JS objects (None fields omitted).
        serde_wasm_bindgen::to_value(&self.events).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
