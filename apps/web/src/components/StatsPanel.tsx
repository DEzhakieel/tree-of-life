import { useStore } from '../store/useStore.js';
import { Panel } from './Panel.js';
import { EVENT_TEXT } from '../lib/eventFeed.js';

type Row = [label: string, value: string];

const SECTION_LABEL = 'text-[10px] font-semibold uppercase tracking-widest text-zinc-500';

export function StatsPanel() {
  const stats = useStore((s) => s.stats);
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);

  const sections: { label: string; rows: Row[] }[] = stats
    ? [
        {
          label: 'Population',
          rows: [
            ['Alive', String(stats.aliveCount)],
            ['Population', String(stats.population)],
            ['Species', String(stats.speciesCount)],
            ['Births', String(stats.births)],
            ['Deaths', String(stats.deaths)],
            ['Escaped', String(stats.escapeDeaths)],
          ],
        },
        {
          label: 'Energy & culture',
          rows: [
            ['Avg energy', stats.avgEnergy.toFixed(3)],
            ['Predators', `${(stats.predatorFraction * 100).toFixed(1)}%`],
            ['Cultures', String(stats.cultureCount)],
            ['Altruism', stats.meanAltruism.toFixed(3)],
          ],
        },
        {
          label: 'Signals',
          rows: [
            ['Entropy', `${stats.entropy.toFixed(2)} bits`],
            ['Diversity', stats.diversity.toFixed(3)],
            ['Complexity', stats.complexity.toFixed(4)],
            ['Cooperation', stats.cooperation.toFixed(4)],
            ['Meme entropy', stats.memeEntropy.toFixed(3)],
            ['Culture-sp. MI', stats.speciesMemeMI.toFixed(3)],
          ],
        },
      ]
    : [];

  return (
    <Panel title="Vitals" right={<span className="font-mono text-zinc-500">t {status?.currentTick ?? 0}</span>}>
      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <div key={section.label}>
            <div className={`mb-0.5 ${SECTION_LABEL}`}>{section.label}</div>
            <table className="w-full text-zinc-400">
              <tbody>
                {section.rows.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-2">{k}</td>
                    <td className="text-right font-mono text-zinc-200">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className={`mb-1 ${SECTION_LABEL}`}>Events</div>
          <ul className="space-y-1">
            {events.slice(0, 5).map((e) => (
              <li key={e.id} className="truncate">
                <span className={`font-mono ${EVENT_TEXT[e.type] ?? 'text-zinc-300'}`}>
                  t{e.tick} {e.type}
                </span>
                <span className="text-zinc-600"> {e.significance.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && (
        <div className="mt-2 border-t border-white/10 pt-1.5 text-right font-mono text-[10px] text-zinc-600">
          #{((stats.stateHash >>> 0) >>> 0).toString(16).padStart(8, '0')}
        </div>
      )}
    </Panel>
  );
}
