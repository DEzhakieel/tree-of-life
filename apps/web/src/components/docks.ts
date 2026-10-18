import type { ComponentType } from 'react';
import { ModelPanel } from './ModelPanel.js';
import { StatsPanel } from './StatsPanel.js';
import { EventTimelinePanel } from './EventTimelinePanel.js';
import { EventSchedulerPanel } from './EventSchedulerPanel.js';
import { EmergenceAtlasPanel } from './EmergenceAtlasPanel.js';
import { EmergenceRadarPanel } from './EmergenceRadarPanel.js';
import { ObservablesChart } from './ObservablesChart.js';
import { SpeciesPanel } from './SpeciesPanel.js';
import { LayerPanel } from './LayerPanel.js';

export interface DockEntry {
  /** stable id — also the key into store.panelCollapsed */
  id: string;
  Component: ComponentType;
}

/** Left dock: the analysis column. Order is display order, top to bottom. */
export const LEFT_DOCK: readonly DockEntry[] = [
  { id: 'model', Component: ModelPanel },
  { id: 'vitals', Component: StatsPanel },
  { id: 'events', Component: EventTimelinePanel },
  { id: 'scheduler', Component: EventSchedulerPanel },
  { id: 'atlas', Component: EmergenceAtlasPanel },
  { id: 'radar', Component: EmergenceRadarPanel },
  { id: 'signals', Component: ObservablesChart },
];

/** Right dock: population + display. */
export const RIGHT_DOCK: readonly DockEntry[] = [
  { id: 'species', Component: SpeciesPanel },
  { id: 'display', Component: LayerPanel },
];
