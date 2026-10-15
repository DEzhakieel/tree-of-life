import type { BenchmarkModel } from '../types.js';
import { randomWalkBenchmark } from './a_randomWalk.js';
import { boidsBenchmark } from './b_boids.js';
import { gameOfLifeBenchmark } from './c_gameOfLife.js';
import { predatorPreyBenchmark } from './d_predatorPrey.js';
import { diffusionBenchmark } from './e_diffusion.js';
import { reactionDiffusionBenchmark } from './f_reactionDiffusion.js';
import { cooperationBenchmark } from './g_cooperation.js';
import { resourceCompetitionBenchmark } from './h_resourceCompetition.js';
import { collectiveNavigationBenchmark } from './i_collectiveNavigation.js';
import { novelCompositeBenchmark } from './j_novelComposite.js';

/** Canonical benchmark registry (A–J). Populated phase by phase. */
export const BENCHMARK_MODELS: BenchmarkModel[] = [
  randomWalkBenchmark,
  boidsBenchmark,
  gameOfLifeBenchmark,
  predatorPreyBenchmark,
  diffusionBenchmark,
  reactionDiffusionBenchmark,
  cooperationBenchmark,
  resourceCompetitionBenchmark,
  collectiveNavigationBenchmark,
  novelCompositeBenchmark,
];
