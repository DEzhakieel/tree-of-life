import {
  decodeServerFrame,
  STATE,
  type WorldConfig,
  type WorldStatus,
  type SimStats,
} from '@fractal-life/shared';
import type { AgentBuffer } from './agentBuffer.js';
import type { SimState } from '../store/useStore.js';
import type { StoreApi } from 'zustand';

type Store = StoreApi<SimState>;

/**
 * Decode a binary server/worker frame and apply it to the store + agent
 * buffer. Shared by the local Web Worker path and the remote WS path, so both
 * modes behave identically.
 */
export function applyFrame(bytes: Uint8Array, store: Store, agents: AgentBuffer): void {
  const frame = decodeServerFrame(bytes);
  switch (frame.kind) {
    case 'world': {
      store.getState().setWorld(frame.world);
      store.getState().setStatus(frame.status);
      store.getState().setPaused(frame.status.paused);
      break;
    }
    case 'snapshot': {
      store.getState().setStatus({
        id: store.getState().world?.id ?? '',
        seed: store.getState().world?.seed ?? '',
        fractalType: store.getState().world?.fractalType ?? 'mandelbrot',
        params: store.getState().world?.params as WorldConfig['params'],
        currentTick: frame.msg.tick,
        population: frame.msg.aliveCount,
        aliveCount: frame.msg.aliveCount,
        speciesCount: frame.msg.speciesCount,
        createdAt: store.getState().world?.createdAt ?? 0,
        interventions: 0,
        paused: store.getState().paused,
      } as WorldStatus);
      agents.reset(frame.msg.aliveCount + 16);
      fillAgents(agents, frame.msg.agents);
      break;
    }
    case 'delta': {
      agents.reset(Math.max(agents.count, frame.msg.agents.length) + 16);
      fillAgents(agents, frame.msg.agents);
      break;
    }
    case 'stats': {
      const s: SimStats = frame.msg;
      const cur = store.getState();
      store.getState().setStats(s);
      store.getState().pushStatsHistory({
        tick: s.tick,
        population: s.population,
        entropy: s.entropy,
        diversity: s.diversity,
        complexity: s.complexity,
        speciesCount: s.speciesCount,
        cooperation: s.cooperation,
        predatorFraction: s.predatorFraction,
        memeEntropy: s.memeEntropy,
        speciesMemeMI: s.speciesMemeMI,
        meanAltruism: s.meanAltruism,
        meanAggression: s.meanAggression,
        meanCooperation: s.meanCooperation,
        meanRisk: s.meanRisk,
        meanDeception: s.meanDeception,
        predatorGeneFraction: s.predatorGeneFraction,
        preyGeneFraction: s.preyGeneFraction,
        energyInequality: s.energyInequality,
        donationRatio: s.donationRatio,
        lyapunovExponent: s.lyapunovExponent,
        selectionEntropy: s.selectionEntropy,
        fixationIndex: s.fixationIndex,
        priceEquationSelection: s.priceEquationSelection,
        foodGradMagMean: s.foodGradMagMean,
        foodLapMean: s.foodLapMean,
        velocityDivMean: s.velocityDivMean,
        velocityCurlMagMean: s.velocityCurlMagMean,
        caAliveFraction: s.caAliveFraction,
        caComplexity: s.caComplexity,
        traitTotalVariance: s.traitTotalVariance,
        traitEffectiveDim: s.traitEffectiveDim,
        traitAnisotropy: s.traitAnisotropy,
        meanATP: s.meanATP,
        meanEnzyme: s.meanEnzyme,
        meanToxin: s.meanToxin,
        meanPH: s.meanPH,
        chemicalDiversity: s.chemicalDiversity,
        meanGlucose: s.meanGlucose,
        meanProtein: s.meanProtein,
        activeSynthesisFraction: s.activeSynthesisFraction,
        terrainOxygen: s.terrainOxygen,
        terrainPH: s.terrainPH,
        terrainToxin: s.terrainToxin,
        meanForce: s.meanForce,
        clusterCount: s.clusterCount,
        clusterOrder: s.clusterOrder,
        rotationalOrder: s.rotationalOrder,
        spatialEntropy: s.spatialEntropy,
        dimensionalEntropy: s.dimensionalEntropy,
        orgIndex: s.orgIndex,
        massConservation: s.massConservation,
        symmetryDrift: s.symmetryDrift,
        cascadeRate: s.cascadeRate,
        bondEnergy: s.bondEnergy,
        reactionEnthalpy: s.reactionEnthalpy,
        entropyProduction: s.entropyProduction,
        carnotEfficiency: s.carnotEfficiency,
        heatWaste: s.heatWaste,
        enginePower: s.enginePower,
        radiationField: s.radiationField,
        thermalBalance: s.thermalBalance,
        expressionEntropy: s.expressionEntropy,
        transcriptActivity: s.transcriptActivity,
        proteinDiversity: s.proteinDiversity,
        proteomeLoad: s.proteomeLoad,
        pathwayFlux: s.pathwayFlux,
        fluxDiversity: s.fluxDiversity,
        regulationGating: s.regulationGating,
        ecCoupling: s.ecCoupling,
        nativeFraction: s.nativeFraction,
        misfoldLoad: s.misfoldLoad,
        foldStability: s.foldStability,
        tfRegulation: s.tfRegulation,
        envRecognition: s.envRecognition,
        expressionNoise: s.expressionNoise,
        libraryDiversity: s.libraryDiversity,
      });
      if (cur.status) {
        store.getState().setStatus({
          ...cur.status,
          currentTick: s.tick,
          population: s.population,
          aliveCount: s.aliveCount,
          speciesCount: s.speciesCount,
        });
      }
      break;
    }
    case 'set': {
      store.getState().setSetMap({
        tick: frame.msg.tick,
        size: frame.msg.size,
        depth: new Uint8Array(frame.msg.depth),
        escape: new Uint8Array(frame.msg.escape),
      });
      break;
    }
    case 'event': {
      store.getState().pushEvent(frame.event);
      break;
    }
    case 'ack':
      // interventions acknowledged — nothing to render
      break;
  }
}

function fillAgents(agents: AgentBuffer, list: { id: number; x: number; y: number; energy: number; state: number; species: number; meme: number }[]): void {
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.state === STATE.DEAD) continue;
    agents.push(a.id, a.x, a.y, a.energy, a.species, a.state, a.meme);
  }
}
