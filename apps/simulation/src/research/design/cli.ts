#!/usr/bin/env node
/** Design CLI: engineer emergence by searching candidate configs and scoring. */
import process from "node:process";
import { objectives } from "./objectives.js";
import { type DesignParam } from "./candidate.js";
import { randomSearch } from "./search.js";

function parseArgs(argv: string[]): { budget: number; ticks: number; seeds: string[] } {
  let budget = 5;
  let ticks = 2000;
  const seeds: string[] = ["ladder-seed-0001"];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--budget" && argv[i+1]) { budget = parseInt(argv[i+1]); i++; continue; }
    if (a === "--ticks" && argv[i+1]) { ticks = parseInt(argv[i+1]); i++; continue; }
    if (a === "--seed" && argv[i+1]) { seeds[0] = argv[i+1]; i++; continue; }
    if (a === "--seeds" && argv[i+1]) { seeds.splice(0, seeds.length, ...argv[i+1].split(",").filter(Boolean)); i++; continue; }
  }
  return { budget, ticks, seeds };
}

async function main() {
  const { budget, ticks, seeds } = parseArgs(process.argv);
  const params: DesignParam[] = [
    { key: "spawnCount", min: 40, max: 200, integer: true },
  ];
  const objs = [
    objectives.l1Emergent(),
    objectives.l2Emergent(),
    objectives.l3Emergent(),
    objectives.adaptation(100),
    objectives.speciation(20),
  ];
  const top = await randomSearch(params, {
    budget,
    elite: 3,
    seeds,
    ladder: { seed: seeds[0], ticks, spawnCount: 100, maxPopulation: 600, sampleEvery: 30 },
    objectives: objs,
  });
  console.log(`top ${top.length} (budget=${budget}, ticks=${ticks}, seeds=${seeds.join(",")})`);
  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    console.log(`#${i+1} mean=${e.meanScore.toFixed(2)} std=${e.stdScore.toFixed(2)} allPass=${e.allPass} cand=${e.candidate.id} params=${JSON.stringify(e.candidate.params)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
