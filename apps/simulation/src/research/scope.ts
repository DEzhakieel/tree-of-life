/**
 * Research scope — the project's pre-registration.
 *
 * This module is the single source of truth for what the project claims to
 * investigate, what it explicitly does not, and what result would falsify each
 * claim. Everything downstream (the rigor layer, the known-systems registry,
 * the AI research loop) reports against the claim IDs declared here, so
 * "supported" and "refuted" always mean something specific that was fixed
 * before the experiment ran.
 *
 * Three rules govern the registry:
 *   1. Every claim carries a falsifiability criterion with a pre-registered
 *      threshold. A claim with no possible refuting outcome is not a claim.
 *   2. Per-model and per-system claims are *derived* from the benchmark and
 *      known-systems registries, never hand-listed, so they cannot drift.
 *   3. `validateScope` must pass for the scope to be usable; the scope CLI
 *      refuses to emit a report from an inconsistent registry.
 *
 * The scope is deliberately falsifiable in places. A claim that currently fails
 * is reported as failing — that is the function of the document, not a defect
 * in it.
 */

import { BENCHMARK_MODELS } from './benchmarks/models/index.js';
import { KNOWN_SYSTEMS } from './benchmarks/knownSystems/index.js';
import type { BenchId } from './benchmarks/types.js';

export type ScopeDecision = 'in' | 'conditional' | 'out';

export type ClaimStatus = 'supported' | 'refuted' | 'inconclusive';

export type ClaimKind =
  /** a statement about the engine's own behaviour (determinism, conservation) */
  | 'deterministic'
  /** a statement about reproducing a canonical model */
  | 'behavioral'
  /** a statement about agreement with published measurements */
  | 'empirical'
  /** a statement backed by a statistical test */
  | 'statistical'
  /** a statement produced by the AI layer but scored by the harness */
  | 'ai-generated';

/** where the evidence for a claim comes from */
export type EvidenceBasis =
  | 'fingerprint-equality'
  | 'closed-form'
  | 'harness-gate'
  | 'measured-literature'
  | 'literature-threshold'
  | 'harness-scored-llm-proposal';

export interface FalsifiabilityCriterion {
  /** what would falsify this claim, in words */
  statement: string;
  /** directional numeric gate, when the claim is quantitative */
  test?: 'gte' | 'gt' | 'lte' | 'lt' | 'range' | 'eqAbs';
  value?: number;
  lo?: number;
  hi?: number;
  /** error rate the claim is tested at, where a statistical test applies */
  alpha?: number;
}

export interface ResearchClaim {
  /** stable id; the ledger keys on this, so ids are never renumbered */
  id: string;
  /** the research question this claim answers */
  question: string;
  claim: string;
  kind: ClaimKind;
  evidence: EvidenceBasis;
  falsifiability: FalsifiabilityCriterion;
  /** research modules that produce the evidence */
  evidenceModules: string[];
  /** artifacts where the evidence is written */
  artifacts: string[];
  citation?: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  /** how the question is actually answered, in method terms */
  method: string;
  /** modules that implement the method */
  modules: string[];
  status: 'open' | 'answered' | 'partly-answered';
}

export interface ScopeBoundary {
  id: string;
  area: string;
  decision: ScopeDecision;
  rationale: string;
}

export interface MethodCommitment {
  id: string;
  name: string;
  /** what this method commits us to, and what it cannot establish */
  commitment: string;
}

export interface ResearchScope {
  version: string;
  title: string;
  purpose: string;
  questions: ResearchQuestion[];
  boundaries: ScopeBoundary[];
  methods: MethodCommitment[];
  /** fixed claims; per-model/per-system claims are appended by `assembleScope` */
  claims: ResearchClaim[];
}

const FIXED_CLAIMS: ResearchClaim[] = [
  {
    id: 'C-DET-01',
    question: 'RQ1',
    claim: 'Every seeded experiment in the research stack reproduces bit-for-bit when re-run with the same seed, timestep, population and world parameters.',
    kind: 'deterministic',
    evidence: 'fingerprint-equality',
    falsifiability: {
      statement: 'Any full-state fingerprint mismatch across a re-run of an identical configuration falsifies the claim.',
      test: 'eqAbs',
      value: 0,
    },
    evidenceModules: ['cli', 'modes', 'snapshot'],
    artifacts: ['first-order.json', 'second-order.json', 'third-order.json', 'conservation.json', 'modes.json'],
  },
  {
    id: 'C-DET-02',
    question: 'RQ1',
    claim: 'Every model in the A–J benchmark suite passes the harness double-run fingerprint gate at both scales.',
    kind: 'deterministic',
    evidence: 'fingerprint-equality',
    falsifiability: { statement: 'A single model whose two runs disagree on fingerprint refutes the claim.', test: 'eqAbs', value: 0 },
    evidenceModules: ['benchmarks/harness', 'benchmarks/rigor/reproducibility'],
    artifacts: ['bench.json', 'rigor.json'],
  },
  {
    id: 'C-BENCH-ALL',
    question: 'RQ2',
    claim: 'All ten A–J benchmark models meet every pre-registered gating acceptance check at the evaluated scale.',
    kind: 'behavioral',
    evidence: 'harness-gate',
    falsifiability: { statement: 'One failing gating check on any model refutes the claim.', test: 'gte', value: 1 },
    evidenceModules: ['benchmarks/harness', 'benchmarks/benchRun'],
    artifacts: ['bench.json', 'bench.md'],
  },
  {
    id: 'C-ABL-01',
    question: 'RQ4',
    claim: 'Every declared mechanism intervention moves its predicted signature key in its predicted direction.',
    kind: 'behavioral',
    evidence: 'closed-form',
    falsifiability: { statement: 'An intervention that leaves its target key unchanged, or moves it the wrong way, refutes the claim.', test: 'gte', value: 1 },
    evidenceModules: ['benchmarks/rigor/ablation'],
    artifacts: ['rigor.json'],
  },
  {
    id: 'C-SIG-01',
    question: 'RQ5',
    claim: 'Every model family’s directional gating claims survive one-sided Student-t testing with Holm–Bonferroni correction at FWER 0.05.',
    kind: 'statistical',
    evidence: 'harness-gate',
    falsifiability: { statement: 'A family whose Holm-adjusted one-sided p exceeds 0.05, or whose effect sign is wrong, refutes the claim.', test: 'gte', value: 1, alpha: 0.05 },
    evidenceModules: ['benchmarks/rigor/significance', 'statistics'],
    artifacts: ['rigor-hypotheses.json', 'rigor.json'],
  },
  {
    id: 'C-NOV-01',
    question: 'RQ5',
    claim: 'The benchmark suite has non-trivial novelty: it covers the canonical phenomenon space, discriminates the mechanisms it claims to separate, and reproduces them at high fidelity.',
    kind: 'statistical',
    evidence: 'harness-gate',
    falsifiability: { statement: 'A discrimination score below 0.6 or a coverage score below 0.9 refutes the claim.', test: 'gte', value: 0.6 },
    evidenceModules: ['benchmarks/rigor/novelty'],
    artifacts: ['rigor.json'],
  },
  {
    id: 'C-AI-01',
    question: 'RQ6',
    claim: 'Every research-loop verdict is produced by the deterministic benchmark harness, never by the language model.',
    kind: 'ai-generated',
    evidence: 'harness-scored-llm-proposal',
    falsifiability: {
      statement: 'Any verdict in the loop ledger that is not traceable to a harness run over models A–J refutes the claim.',
      test: 'eqAbs',
      value: 0,
    },
    evidenceModules: ['ai/researchAgent', 'aiRun', 'benchmarks/harness'],
    artifacts: ['ai-loop.json', 'ai-loop-ledger.json'],
  },
  {
    id: 'C-AI-02',
    question: 'RQ6',
    claim: 'An open-source model can generate at least one falsifiable experiment per loop that the harness scores as supported.',
    kind: 'ai-generated',
    evidence: 'harness-scored-llm-proposal',
    falsifiability: { statement: 'A loop in which every round yields zero supported proposals refutes the claim.', test: 'gte', value: 1 },
    evidenceModules: ['ai/researchAgent', 'aiRun'],
    artifacts: ['ai-loop.json', 'ai-loop-ledger.json'],
  },
  {
    id: 'C-AI-03',
    question: 'RQ7',
    claim: 'The AI world controller improves the measured objective against an unsteered control over the same seed and tick budget.',
    kind: 'ai-generated',
    evidence: 'harness-scored-llm-proposal',
    falsifiability: {
      statement: 'A steered trajectory whose aliveCount at the final tick is at or below the unsteered control refutes the claim.',
      test: 'gt',
      value: 0,
    },
    evidenceModules: ['ai/controller', 'ai/world', 'aiRun'],
    artifacts: ['ai-world.json', 'ai-world.md'],
  },
  {
    id: 'C-EMP-AGG',
    question: 'RQ3',
    claim: 'Every measured or derivable literature target attached to a replicated known system is reproduced by the linked benchmark.',
    kind: 'empirical',
    evidence: 'measured-literature',
    falsifiability: {
      statement: 'A single measured or derivable target falling outside its published band refutes the claim.',
      test: 'gte',
      value: 1,
    },
    evidenceModules: ['benchmarks/rigor/validation', 'benchmarks/knownSystems'],
    artifacts: ['known.json', 'rigor.json'],
  },
];

/** per-model claims, derived from the benchmark registry so they cannot drift */
export function benchmarkClaims(): ResearchClaim[] {
  const claims = BENCHMARK_MODELS.map<ResearchClaim>((m) => ({
    id: `C-BENCH-${m.id}`,
    question: 'RQ2',
    claim: `Benchmark ${m.id} (${m.name}) reproduces the canonical behaviour of ${m.reference}`,
    kind: 'behavioral',
    evidence: 'harness-gate',
    falsifiability: {
      statement: `Any gating check failing on model ${m.id} refutes this claim.`,
      test: 'gte',
      value: 1,
    },
    evidenceModules: ['benchmarks/harness'],
    artifacts: ['bench.json'],
  }));
  return claims;
}

/** per-system claims, derived from the known-systems registry */
export function empiricalClaims(): ResearchClaim[] {
  return KNOWN_SYSTEMS.filter((s) => s.replicated && s.benchId && (s.targets?.length ?? 0) > 0).map<ResearchClaim>((s) => ({
    id: `C-EMP-${s.id.toUpperCase().replace(/-/g, '_')}`,
    question: 'RQ3',
    claim: `Benchmark ${s.benchId as BenchId} reproduces the published reference values for ${s.name}.`,
    kind: 'empirical',
    evidence: 'measured-literature',
    falsifiability: {
      statement: `A measured or derivable target for ${s.name} falling outside its published band refutes this claim.`,
      test: 'gte',
      value: 1,
    },
    evidenceModules: ['benchmarks/knownSystems/targets', 'benchmarks/rigor/validation'],
    artifacts: ['known.json', 'rigor.json'],
    citation: s.reference,
  }));
}

export const RESEARCH_SCOPE: ResearchScope = {
  version: '1.0.0',
  title: 'Fractal Life — research scope',
  purpose:
    'To determine whether a seeded, fully deterministic artificial-life engine reproduces the canonical phenomena of complex-systems science ' +
    '— and to state, before each experiment, what result would refute that determination. The engine is the instrument; the benchmark suite, ' +
    'the known-systems registry and the rigor layer are the calibration, validation and error-control procedure around it.',
  questions: [
    {
      id: 'RQ1',
      question: 'Is the engine deterministic and reproducible to the bit?',
      method: 'Full-state hashing of identical re-runs across first-order, second-order and third-order experiments, plus a double-run fingerprint gate inside the benchmark harness.',
      modules: ['snapshot', 'modes', 'cli', 'benchmarks/harness', 'benchmarks/rigor/reproducibility'],
      status: 'answered',
    },
    {
      id: 'RQ2',
      question: 'Does the engine reproduce canonical artificial-life phenomena?',
      method: 'Ten purpose-built micro-models (A–J) spanning diffusion, flocking, cellular automata, population dynamics, transport, pattern formation, evolutionary game theory, resource competition and swarm navigation, each scored against pre-registered gating checks over a fixed seed cohort.',
      modules: ['benchmarks/models', 'benchmarks/harness', 'benchmarks/benchRun'],
      status: 'answered',
    },
    {
      id: 'RQ3',
      question: 'Does the engine match what the literature actually reports, independently of the thresholds we chose?',
      method: 'Quantitative reference values with their published uncertainty are attached to each replicated known system; the linked benchmark is scored against those bands, not against its own gates.',
      modules: ['benchmarks/knownSystems/targets', 'benchmarks/rigor/validation'],
      status: 'partly-answered',
    },
    {
      id: 'RQ4',
      question: 'Are the emergent collective behaviours causal consequences of the mechanisms claimed to produce them?',
      method: 'Declared interventions with a predicted effect direction on a named signature key, each paired against the untouched baseline on the same seed; plus 2^n-arm causal decomposition in the event layer.',
      modules: ['benchmarks/rigor/ablation', 'causal', 'eventCausal', 'perturb'],
      status: 'partly-answered',
    },
    {
      id: 'RQ5',
      question: 'Are the effects statistically robust, and does the suite generalise?',
      method: 'One-sided Student-t per gating claim with Holm–Bonferroni FWER control, Sellke–Berger–Pericchi Bayes factors, exact Clopper–Pearson per-seed consistency, and a novelty scorecard over coverage, discrimination, fidelity, grounding and reproducibility.',
      modules: ['benchmarks/rigor/significance', 'benchmarks/rigor/novelty', 'statistics', 'bayes'],
      status: 'partly-answered',
    },
    {
      id: 'RQ6',
      question: 'Can an open-source language model propose falsifiable experiments whose verdicts come from the harness rather than the model?',
      method: 'A multi-round loop of propose → evaluate → feed back, where proposals are deduplicated, scored by the deterministic benchmark harness, and compared against a parsimony penalty so extra free parameters cannot win on accuracy alone.',
      modules: ['ai/researchAgent', 'aiRun', 'benchmarks/parsimony'],
      status: 'partly-answered',
    },
    {
      id: 'RQ7',
      question: 'Can an open-source model steer the world controller usefully?',
      method: 'A closed observe → direct → actuate → measure loop over a live engine, judged against an unsteered control run of the same seed and tick budget.',
      modules: ['ai/controller', 'ai/world', 'aiRun'],
      status: 'open',
    },
  ],
  boundaries: [
    {
      id: 'SB-01',
      area: 'System scope',
      decision: 'in',
      rationale: 'A seeded, single-process, torus-bounded artificial-life engine with agents, cells and a shared WorldParams surface, exercised through A–J micro-models and the known-systems registry.',
    },
    {
      id: 'SB-02',
      area: 'Empirical validation',
      decision: 'conditional',
      rationale: 'In scope only where a source reports a measured value, a closed-form consequence, or a qualitative regime we can conservatively quantify. Where a system reports nothing numeric, it stays documentation-only and is never counted as validated.',
    },
    {
      id: 'SB-03',
      area: 'Language-model involvement',
      decision: 'conditional',
      rationale: 'Permitted only as a proposer and a meta-level governor over whitelisted WorldParams. Never as the source of a verdict: every supported/refuted call is produced by deterministic benchmark code.',
    },
    {
      id: 'SB-04',
      area: 'Stochasticity',
      decision: 'in',
      rationale: 'Stochastic models are evaluated across a fixed seed cohort with bootstrap CIs; stochasticity is a property of the world, not of the measurement. The engine itself remains bit-deterministic given a seed.',
    },
    {
      id: 'SB-05',
      area: 'Emergence ladder claims',
      decision: 'in',
      rationale: 'Level attainment claims (EMERGENT / PARTIAL / ABSENT) are reported with their supporting first-, second- and third-order evidence bundles.',
    },
    {
      id: 'SB-06',
      area: 'Real-world biological systems',
      decision: 'out',
      rationale: 'The engine is an artificial-life instrument. It is not calibrated to, and makes no claim about, any actual organism, ecosystem or observed dataset. Real-world data enters only as grounding parameters, never as a measured target.',
    },
    {
      id: 'SB-07',
      area: 'Open-ended evolution and unbounded complexity growth',
      decision: 'out',
      rationale: 'Systems whose defining claim is unbounded novelty production (Tierra, Avida, Lenia) are inventoried but not instrumented: the engine has no mechanism that would let them be tested honestly here.',
    },
    {
      id: 'SB-08',
      area: 'Performance and scaling',
      decision: 'out',
      rationale: 'Throughput, parallelism and GPU scaling are engineering concerns, not scientific claims, and are excluded from the evidence ledger.',
    },
    {
      id: 'SB-09',
      area: 'Predictive claims about the future state of the engine',
      decision: 'conditional',
      rationale: 'Forecasts over engine trajectories are in scope only as a tested capability of the forecasting module, never as a claim about the real world.',
    },
    {
      id: 'SB-10',
      area: 'Language-model-generated claims',
      decision: 'conditional',
      rationale: 'A model may propose a hypothesis; it may not assert a result. Any claim whose evidence is an LLM output is excluded from the ledger unless a harness run scores it.',
    },
  ],
  methods: [
    {
      id: 'M-DET',
      name: 'Determinism discipline',
      commitment: 'Every experiment is re-run and compared by full-state hash. This establishes bit-reproducibility; it says nothing about whether the modelled behaviour is correct.',
    },
    {
      id: 'M-VER',
      name: 'Verification against closed forms',
      commitment: 'Where the reference model has an analytic solution, the engine is checked against it. This establishes internal correctness; it says nothing about correspondence to nature.',
    },
    {
      id: 'M-VAL',
      name: 'Validation against published measurements',
      commitment: 'Where a source reports a number, the engine is scored against that number with the source’s own uncertainty. Establishes correspondence for the specific quantities tested only.',
    },
    {
      id: 'M-SIG',
      name: 'Statistical error control',
      commitment: 'One-sided tests with Holm–Bonferroni FWER control and Bayes factors. This controls false positives within a declared family; it does not make an effect large or important.',
    },
    {
      id: 'M-ABL',
      name: 'Interventional ablation',
      commitment: 'Each claimed mechanism is switched off and the predicted effect direction checked. This supports a causal reading within the model; it does not transfer causality to the real system.',
    },
    {
      id: 'M-PAR',
      name: 'Parsimony control',
      commitment: 'Competing configurations are compared with AIC/BIC, charging 2k / k·ln n for free parameters. A configuration that fits only by retuning more knobs is penalised, so support cannot be purchased with complexity.',
    },
    {
      id: 'M-AI',
      name: 'Language models as proposers, not judges',
      commitment: 'LLM output is cached, deduplicated and clamped to whitelisted knobs; every verdict is harness-derived. This bounds the model’s authority but does not make its proposals meaningful on their own.',
    },
  ],
  claims: FIXED_CLAIMS,
};

/** assemble the full scope: fixed claims + registry-derived per-model and per-system claims */
export function assembleScope(): ResearchScope {
  return {
    ...RESEARCH_SCOPE,
    claims: [...RESEARCH_SCOPE.claims, ...benchmarkClaims(), ...empiricalClaims()],
  };
}

export interface ScopeIssue {
  id: string;
  severity: 'error' | 'warn';
  detail: string;
}

/** internal consistency of the assembled scope; errors block report generation */
export function validateScope(scope: ResearchScope = assembleScope()): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  const questionIds = new Set(scope.questions.map((q) => q.id));
  const seen = new Set<string>();

  for (const c of scope.claims) {
    if (seen.has(c.id)) {
      issues.push({ id: c.id, severity: 'error', detail: 'duplicate claim id' });
    }
    seen.add(c.id);
    if (!questionIds.has(c.question)) {
      issues.push({ id: c.id, severity: 'error', detail: `claim references unknown question ${c.question}` });
    }
    const f = c.falsifiability;
    if (!f.statement || f.statement.trim().length === 0) {
      issues.push({ id: c.id, severity: 'error', detail: 'claim has no falsifiability statement' });
    }
    if (f.test && typeof f.value !== 'number' && (f.test === 'gte' || f.test === 'gt' || f.test === 'lte' || f.test === 'lt' || f.test === 'eqAbs')) {
      issues.push({ id: c.id, severity: 'error', detail: `directional test ${f.test} has no numeric threshold` });
    }
    if (f.test === 'range' && (typeof f.lo !== 'number' || typeof f.hi !== 'number')) {
      issues.push({ id: c.id, severity: 'error', detail: 'range test needs numeric lo and hi' });
    }
    if (c.evidenceModules.length === 0) {
      issues.push({ id: c.id, severity: 'warn', detail: 'claim names no evidence module' });
    }
    if (c.artifacts.length === 0) {
      issues.push({ id: c.id, severity: 'warn', detail: 'claim names no artifact' });
    }
  }

  for (const q of scope.questions) {
    if (!scope.claims.some((c) => c.question === q.id)) {
      issues.push({ id: q.id, severity: 'warn', detail: 'research question has no associated claim' });
    }
    if (q.modules.length === 0) {
      issues.push({ id: q.id, severity: 'warn', detail: 'research question names no module' });
    }
  }

  const methodIds = new Set(scope.methods.map((m) => m.id));
  if (!methodIds.has('M-PAR')) {
    issues.push({ id: 'M-PAR', severity: 'warn', detail: 'parsimony control is not declared as a method commitment' });
  }

  return issues;
}

/** true when the scope has no blocking issues */
export function scopeIsSound(scope: ResearchScope = assembleScope()): boolean {
  return validateScope(scope).every((i) => i.severity !== 'error');
}

export function claimsForQuestion(scope: ResearchScope, questionId: string): ResearchClaim[] {
  return scope.claims.filter((c) => c.question === questionId);
}

export function claimById(scope: ResearchScope, id: string): ResearchClaim | undefined {
  return scope.claims.find((c) => c.id === id);
}
