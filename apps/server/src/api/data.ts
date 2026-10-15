import { Router, type Request, type Response } from 'express';
import type { GroundingService } from '../data/groundingService.js';

/**
 * REST endpoints exposing the open-source scientific data that grounds the
 * simulation (PubChem chemistry, GBIF ecology, Kazusa genetics). All data comes
 * from the offline enrichment snapshot served by `GroundingService`.
 */
export function createDataApi(grounding: GroundingService): Router {
  const api = Router();

  const notFound = (res: Response, what: string) => {
    res.status(404).json({ error: `no enrichment snapshot — ${what} unavailable` });
  };

  // Status / metadata ---------------------------------------------------------

  api.get('/grounding/status', (_req, res) => {
    if (!grounding.hasSnapshot) {
      res.status(404).json({ error: 'no enrichment snapshot loaded', ...grounding.metadata });
      return;
    }
    res.json({
      loaded: true,
      ...grounding.metadata,
      domains: { chemistry: true, ecology: true, genetics: true },
    });
  });

  api.get('/grounding', (_req, res) => {
    const snap = grounding.snapshotJson();
    if (!snap) return notFound(res, 'full snapshot');
    res.json(snap);
  });

  api.get('/grounding/sources', (_req, res) => {
    const sources = grounding.sources();
    if (!sources) return notFound(res, 'sources');
    res.json(sources);
  });

  // Chemistry -----------------------------------------------------------------

  api.get('/grounding/chemistry', (_req, res) => {
    const chem = grounding.chemistry();
    if (!chem) return notFound(res, 'chemistry');
    res.json(chem);
  });

  api.get('/grounding/chemistry/molecules', (_req, res) => {
    const molecules = grounding.moleculesCompact();
    if (!molecules) return notFound(res, 'molecules');
    res.json(molecules);
  });

  api.get('/grounding/chemistry/molecules/:index', (req, res) => {
    const chem = grounding.chemistry();
    const index = Number(req.params.index);
    const molecule = chem?.molecules.find((m) => m.index === index);
    if (!molecule) {
      res.status(404).json({ error: 'molecule not found' });
      return;
    }
    res.json(molecule);
  });

  api.get('/grounding/chemistry/stoichiometry', (_req, res) => {
    const chem = grounding.chemistry();
    if (!chem) return notFound(res, 'stoichiometry');
    res.json(chem.stoichiometry);
  });

  // Ecology -------------------------------------------------------------------

  api.get('/grounding/ecology', (_req, res) => {
    const eco = grounding.ecology();
    if (!eco) return notFound(res, 'ecology');
    res.json(eco);
  });

  api.get('/grounding/ecology/taxa', (_req, res) => {
    const taxa = grounding.taxaCompact();
    if (!taxa) return notFound(res, 'taxa');
    res.json(taxa);
  });

  api.get('/grounding/ecology/priors', (_req, res) => {
    const eco = grounding.ecology();
    if (!eco) return notFound(res, 'priors');
    res.json(eco.priors);
  });

  // Genetics ------------------------------------------------------------------

  api.get('/grounding/genetics', (_req, res) => {
    const gen = grounding.genetics();
    if (!gen) return notFound(res, 'genetics');
    res.json(gen);
  });

  api.get('/grounding/genetics/codons', (req: Request, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const codons = grounding.codons(search);
    if (!codons) return notFound(res, 'codons');
    res.json(codons);
  });

  api.get('/grounding/genetics/codons/:codon', (req, res) => {
    const gen = grounding.genetics();
    const codon = gen?.codons.find((c) => c.codon === req.params.codon.toUpperCase());
    if (!codon) {
      res.status(404).json({ error: 'codon not found' });
      return;
    }
    res.json(codon);
  });

  return api;
}
