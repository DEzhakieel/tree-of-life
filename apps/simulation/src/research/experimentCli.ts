/** Experiment CLI: document, run, and reproduce experiments.
 *
 *   npx tsx src/research/experimentCli.ts --list
 *   npx tsx src/research/experimentCli.ts --run l3-baseline [--ticks 2000]
 *   npx tsx src/research/experimentCli.ts --verify l3-baseline
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExperiments } from './experimentRegistry.js';
import {
  runExperiment,
  reproduceExperiment,
  saveManifest,
  loadManifest,
  availableObjectives,
  type Experiment,
} from './experiment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const OUT_DIR = resolve(ROOT, 'apps', 'simulation', 'research', 'experiments');

interface CliOpts {
  list: boolean;
  run?: string;
  verify?: string;
  ticks?: number;
  outDir: string;
}

function parse(argv: string[]): CliOpts {
  const o: CliOpts = { list: false, outDir: OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--list': o.list = true; break;
      case '--run': o.run = argv[++i]; break;
      case '--verify': o.verify = argv[++i]; break;
      case '--ticks': o.ticks = parseInt(argv[++i]!, 10); break;
      case '--out': o.outDir = resolve(argv[++i]!); break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return o;
}

function manifestPath(o: CliOpts, id: string): string {
  return resolve(o.outDir, `${id}.json`);
}

function main(): void {
  const o = parse(process.argv.slice(2));
  const reg = defaultExperiments();

  if (o.list || (!o.run && !o.verify)) {
    console.log('Registered experiments:');
    for (const e of reg.list()) {
      console.log(`  ${e.id.padEnd(18)} ${e.name}`);
      console.log(`  ${''.padEnd(18)} H: ${e.hypothesis}`);
      console.log(`  ${''.padEnd(18)} seeds=${e.seeds.length} tags=${e.tags.join(',')}`);
    }
    console.log(`Available objectives: ${availableObjectives().join(', ')}`);
    return;
  }

  if (o.run) {
    const exp: Experiment = reg.require(o.run);
    if (o.ticks !== undefined) exp.ladder = { ...exp.ladder, ticks: o.ticks };
    console.log(`running '${exp.id}' (${exp.seeds.length} seed(s), ticks=${exp.ladder.ticks})...`);
    const m = runExperiment(exp);
    for (const p of m.perSeed) {
      console.log(`  ${p.seed}  score=${p.score.toFixed(3)}  pass=${p.thresholdsMet}  digest=${p.digest.slice(0, 12)}…`);
      console.log(`    verdicts: ${Object.entries(p.verdicts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    console.log(`  aggregate: mean=${m.aggregate.meanScore.toFixed(3)} sd=${m.aggregate.sdScore.toFixed(3)} passRate=${(m.aggregate.passRate * 100).toFixed(0)}%`);
    console.log(`  reproducible (double-run): ${m.reproducible ? 'YES' : 'NO'}`);
    const path = manifestPath(o, exp.id);
    saveManifest(m, path);
    console.log(`  manifest: ${path}`);
    if (!m.reproducible) process.exitCode = 1;
    return;
  }

  if (o.verify) {
    const path = manifestPath(o, o.verify);
    const m = loadManifest(path);
    console.log(`reproducing '${m.experiment.id}' recorded ${m.ranAt}...`);
    const rep = reproduceExperiment(m);
    for (const s of rep.seeds) {
      console.log(`  ${s.seed}  ${s.matched ? 'MATCH' : 'MISMATCH'}  ${s.recorded.slice(0, 12)}… vs ${s.rerun.slice(0, 12)}…`);
    }
    console.log(rep.matched ? 'REPRODUCED: all digests bit-identical' : 'FAILED: digests differ');
    if (!rep.matched) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('experimentCli.ts')) {
  main();
}
