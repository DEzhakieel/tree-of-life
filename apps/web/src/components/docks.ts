import type { ComponentType } from 'react';
import { ModelPanel } from './ModelPanel.js';
import { StatsPanel } from './StatsPanel.js';
import { EventTimelinePanel } from './EventTimelinePanel.js';
import { EventSchedulerPanel } from './EventSchedulerPanel.js';
import { EmergenceAtlasPanel } from './EmergenceAtlasPanel.js';
import { EmergenceRadarPanel } from './EmergenceRadarPanel.js';
import { ExperimentDirectoryPanel } from './ExperimentDirectoryPanel.js';
import { ObservablesChart } from './ObservablesChart.js';
import { SpeciesPanel } from './SpeciesPanel.js';
import { LayerPanel } from './LayerPanel.js';

export interface DockEntry {
  /** stable id — also the key into store.panelCollapsed */
  id: string;
  Component: ComponentType<{ id?: string }>;
}

/**
 * Rails are grouped by instrument function, not by chronology:
 *   left  = model + intervention (what you build and do to the world)
 *   right = observation + analysis (what you measure back out)
 * Order within a rail is display order, top to bottom.
 */
export const LEFT_DOCK: readonly DockEntry[] = [
  { id: 'model', Component: ModelPanel },
  { id: 'events', Component: EventTimelinePanel },
  { id: 'scheduler', Component: EventSchedulerPanel },
  { id: 'experiments', Component: ExperimentDirectoryPanel },
];

/** Right rail: telemetry, emergence analysis, population, canvas layers. */
export const RIGHT_DOCK: readonly DockEntry[] = [
  { id: 'vitals', Component: StatsPanel },
  { id: 'signals', Component: ObservablesChart },
  { id: 'atlas', Component: EmergenceAtlasPanel },
  { id: 'radar', Component: EmergenceRadarPanel },
  { id: 'species', Component: SpeciesPanel },
  { id: 'display', Component: LayerPanel },
];
