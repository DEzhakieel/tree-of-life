export interface RigorStudy {
  id: string;
  label: string;
}

export type RigorOutcome = 'PASS' | 'FAIL' | 'WARN';
export type RigorModule = 'verification' | 'validation' | 'reproducibility' | 'sensitivity' | 'ablation' | 'significance' | 'novelty';

export interface RigorCheck {
  module: RigorModule;
  key: string;
  label: string;
  outcome: RigorOutcome;
  value: number | string | boolean;
  threshold?: number | string;
  detail: string;
}

export interface RigorSection {
  id: string;
  title: string;
  summary: string;
  checks: RigorCheck[];
  plots?: string[];
}

export interface RigorResult {
  generatedAt: string;
  repo: string;
  studies: RigorSection[];
  overall: RigorOutcome;
  summary: string;
  plotsDir: string;
  jsonPath: string;
  mdPath: string;
  csvPath: string;
}
