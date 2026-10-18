import { useEffect, useState } from 'react';
import type { Experiment, ExperimentManifest } from '@fractal-life/simulation/research';
import { Panel } from './Panel.js';
import {
  fetchManifest,
  loadExperiments,
  pollJob,
  startReproduce,
  startRun,
  type ExperimentSource,
  type Job,
} from '../net/experiments.js';

function kindOf(e: Experiment): 'ladder' | 'ews' {
  return e.kind ?? 'ladder';
}

function ExperimentRow({
  experiment,
  selected,
  onSelect,
}: {
  experiment: Experiment;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const kind = kindOf(experiment);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(experiment.id)}
        className={`w-full rounded px-1.5 py-1 text-left hover:bg-white/5 ${selected ? 'bg-white/10' : ''}`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1 text-[9px] font-semibold ${
              kind === 'ews' ? 'bg-amber-400/20 text-amber-200' : 'bg-sky-400/20 text-sky-200'
            }`}
          >
            {kind}
          </span>
          <span className="truncate text-[11px] text-zinc-200">{experiment.name}</span>
          <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">{experiment.seeds.length}s</span>
        </div>
        {selected ? null : (
          <div className="mt-0.5 truncate text-[10px] leading-4 text-zinc-500">{experiment.hypothesis}</div>
        )}
      </button>
    </li>
  );
}

/** Interactive experiment directory: browse what is registered, run one on the
 *  server, watch per-seed progress, and inspect the recorded manifest. Without
 *  a server it renders the bundled catalog read-only (GitHub Pages). */
export function ExperimentDirectoryPanel() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [source, setSource] = useState<ExperimentSource | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ExperimentManifest | null>(null);
  const [doubleCheck, setDoubleCheck] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadExperiments().then((r) => {
      if (!alive) return;
      setExperiments(r.experiments);
      setSource(r.source);
    });
    return () => {
      alive = false;
    };
  }, []);

  const running = job !== null && job.status !== 'done' && job.status !== 'error';

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    return pollJob(
      job.id,
      (next) => {
        setJob(next);
        if (next.status === 'done' && next.mode === 'run' && next.manifest) setManifest(next.manifest);
      },
      (err) => setJobError(err.message),
    );
  }, [job?.id, running]);

  const selected = experiments.find((e) => e.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    setJob(null);
    setJobError(null);
    setManifest(null);
    void fetchManifest(id).then(setManifest);
  };

  const run = async () => {
    if (!selected) return;
    setJobError(null);
    try {
      setJob(await startRun(selected.id, doubleCheck));
    } catch (err) {
      setJobError((err as Error).message);
    }
  };

  const reproduce = async () => {
    if (!selected) return;
    setJobError(null);
    try {
      setJob(await startReproduce(selected.id));
    } catch (err) {
      setJobError((err as Error).message);
    }
  };

  return (
    <Panel
      title="Experiments"
      id="experiments"
      right={
        <span className="font-mono text-zinc-500">
          {source === 'offline' ? 'read-only' : source === null ? '…' : `${experiments.length}`}
        </span>
      }
    >
      {source === 'offline' ? (
        <div className="mb-2 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-[10px] leading-4 text-amber-200">
          No API server answering <span className="font-mono">/api/health</span> — showing the bundled catalog read-only.
          Run <span className="font-mono">npm run dev -w @fractal-life/server</span> to execute and reproduce experiments.
        </div>
      ) : null}

      {source === null ? (
        <div className="py-2 text-center text-[10px] text-zinc-600">loading catalog…</div>
      ) : (
        <ul className="mb-2 space-y-0.5">
          {experiments.map((e) => (
            <ExperimentRow key={e.id} experiment={e} selected={e.id === selectedId} onSelect={select} />
          ))}
        </ul>
      )}

      {selected ? (
        <div className="space-y-1.5 rounded-md border border-white/10 bg-white/[0.03] p-2">
          <div className="text-[11px] font-semibold text-zinc-200">{selected.name}</div>
          <p className="text-[10px] leading-4 text-zinc-400">{selected.hypothesis}</p>
          {selected.description ? (
            <p className="text-[10px] leading-4 text-zinc-500">{selected.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {selected.tags.map((t) => (
              <span key={t} className="rounded bg-white/5 px-1 text-[9px] text-zinc-500">
                {t}
              </span>
            ))}
          </div>
          <div className="font-mono text-[9px] leading-4 text-zinc-500">
            kind {kindOf(selected)}
            {kindOf(selected) === 'ews'
              ? ` · ramps ${(selected.ews?.ramps ?? []).join(', ')}`
              : ` · ${selected.ladder.ticks ?? '—'} ticks`}
            {' · '}
            {selected.seeds.length} seed{selected.seeds.length === 1 ? '' : 's'}
            {selected.objectiveIds && selected.objectiveIds.length > 0 ? ` · ${selected.objectiveIds.join(', ')}` : ''}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || source === 'offline'}
              className="rounded bg-emerald-500/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-400 disabled:opacity-40"
            >
              {running && job?.mode === 'run' ? 'running…' : 'Run'}
            </button>
            <button
              type="button"
              onClick={() => void reproduce()}
              disabled={running || manifest === null || source === 'offline'}
              title={manifest === null ? 'no recorded manifest yet' : 're-run and compare digests'}
              className="rounded bg-sky-500/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
            >
              Reproduce
            </button>
            <label className="flex items-center gap-1 text-[9px] text-zinc-500" title="re-run seed[0] and confirm bit-exact digests">
              <input
                type="checkbox"
                checked={doubleCheck}
                onChange={(e) => setDoubleCheck(e.target.checked)}
                disabled={running}
              />
              double-check
            </label>
            <span className="ml-auto text-[9px] text-zinc-600">
              {manifest ? `manifest ${new Date(manifest.ranAt).toISOString().slice(0, 10)}` : 'no manifest'}
            </span>
          </div>

          {jobError ? <div className="text-[10px] leading-4 text-rose-300">{jobError}</div> : null}

          {job ? <JobStatus job={job} /> : null}

          {manifest ? <ManifestSummary manifest={manifest} /> : null}
        </div>
      ) : null}
    </Panel>
  );
}

function JobStatus({ job }: { job: Job }) {
  const settled = job.status === 'done' || job.status === 'error';
  const tone =
    job.status === 'error' ? 'text-rose-300' : job.status === 'done' ? 'text-emerald-300' : 'text-zinc-300';
  const pct = job.progress ? Math.min(100, (job.progress.done / Math.max(1, job.progress.total)) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 font-mono text-[9px]">
        <span className={tone}>
          {job.mode === 'reproduce' ? 'reproduce' : 'run'} · {job.status}
        </span>
        {job.progress ? (
          <span className="text-zinc-500">
            {job.progress.done}/{job.progress.total} {job.progress.label}
          </span>
        ) : null}
        {settled && job.finishedAt ? <span className="ml-auto text-zinc-600">{new Date(job.finishedAt).toISOString().slice(11, 19)}</span> : null}
      </div>
      {job.progress ? (
        <div className="h-1 w-full overflow-hidden rounded bg-white/10">
          <div
            className={`h-1 transition-all ${job.status === 'error' ? 'bg-rose-400' : 'bg-emerald-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {job.error ? <div className="text-[10px] leading-4 text-rose-300">{job.error}</div> : null}
      {job.saveError ? (
        <div className="text-[10px] leading-4 text-amber-300">manifest not written: {job.saveError}</div>
      ) : null}
      {job.status === 'done' && job.mode === 'reproduce' && job.report ? (
        <div className="text-[10px] leading-4">
          <span className={job.report.matched ? 'text-emerald-300' : 'text-rose-300'}>
            {job.report.matched ? 'all seeds reproduced bit-for-bit' : 'DRIFT — digests differ from the record'}
          </span>
          <ul className="mt-0.5 space-y-0.5">
            {job.report.seeds.map((s) => (
              <li key={s.seed} className="flex gap-2 font-mono text-[9px] text-zinc-500">
                <span className={s.matched ? 'text-emerald-400' : 'text-rose-400'}>{s.matched ? '✓' : '✗'}</span>
                <span>{s.seed}</span>
                <span className="ml-auto">{s.rerun.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ManifestSummary({ manifest }: { manifest: ExperimentManifest }) {
  return (
    <div className="space-y-1 border-t border-white/10 pt-1">
      <div className="font-mono text-[9px] text-zinc-500">
        mean {manifest.aggregate.meanScore.toFixed(3)} · pass{' '}
        {(manifest.aggregate.passRate * 100).toFixed(0)}% ·{' '}
        <span className={manifest.reproducible ? 'text-emerald-400' : 'text-amber-300'}>
          {manifest.reproducible ? 'reproducible' : 'not double-checked'}
        </span>
      </div>
      <ul className="space-y-0.5">
        {manifest.perSeed.map((s) => (
          <li key={s.seed} className="flex items-center gap-2 font-mono text-[9px] text-zinc-500">
            <span className={s.thresholdsMet ? 'text-emerald-400' : 'text-zinc-600'}>{s.thresholdsMet ? '✓' : '·'}</span>
            <span className="truncate">{s.seed}</span>
            <span className="ml-auto">{s.score.toFixed(3)}</span>
            <span className="w-16 text-right text-zinc-600">{s.digest.slice(0, 8)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
