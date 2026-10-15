// Quick smoke test: simulate the worker boot path
import { Engine } from '@fractal-life/simulation';
import { encodeStats, encodeEvent, encodeAck, encodeWorld, encodeSetMap } from '@fractal-life/shared';

const world = {
  id: 'smoke-test',
  seed: 'test123',
  fractalType: 'mandelbrot',
  params: {
    cReal: -0.8, cImag: 0.156, maxIter: 256, escapeRadius: 65536,
    centerX: -0.6, centerY: 0, worldScale: 4, spawnCount: 50,
    metabolismBase: 1, maxPopulation: 4000, foodRegenRate: 0.0003,
    energyCapacity: 100, agentMaxAge: 4000, timeScale: 1,
    dayLength: 2400, seasonLength: 20000,
  },
  createdAt: Date.now(),
  currentTick: 0,
};

try {
  console.log('1. Creating engine...');
  const engine = new Engine(world);
  console.log('   OK');

  console.log('2. encodeSnapshotMessage...');
  const snap = engine.encodeSnapshotMessage();
  console.log('   OK, length:', snap.length);

  console.log('3. encodeSetMapMessage...');
  const setMap = engine.encodeSetMapMessage();
  console.log('   OK, length:', setMap.length);

  console.log('4. engine.tick() x10...');
  for (let i = 0; i < 10; i++) {
    const r = engine.tick();
    if (i === 0) {
      console.log('   tick 0 OK, delta length:', r.delta.length, 'events:', r.events.length);
    }
  }
  console.log('   10 ticks OK');

  console.log('5. engine.stats()...');
  const s = engine.stats();
  console.log('   OK, alive:', s.aliveCount, 'species:', s.speciesCount);
  console.log('   biology: dnaIntegrity=', s.meanDNAIntegrity, 'pathogen=', s.meanPathogenLoad,
    'membrane=', s.meanMembranePot, 'bodyTemp=', s.meanBodyTemp,
    'trophic=', s.meanTrophicLevel, 'fitness=', s.meanFitness, 'divProgress=', s.meanDivisionProgress);

  console.log('6. encodeStats...');
  const statsBytes = encodeStats(s);
  console.log('   OK, length:', statsBytes.length);

  console.log('7. worldStatus...');
  const status = engine.worldStatus(false);
  console.log('   OK');

  console.log('8. encodeWorld...');
  const worldBytes = encodeWorld(engine.config, status);
  console.log('   OK, length:', worldBytes.length);

  console.log('\n=== ALL SMOKE TESTS PASSED ===');
} catch (err) {
  console.error('\n=== SMOKE TEST FAILED ===');
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
}
