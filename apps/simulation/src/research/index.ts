/** Research harness surface for the server's experiment API.
 *
 * Deliberately a *subpath* (`@fractal-life/simulation/research`) rather than
 * part of the package index: this barrel pulls in `node:crypto`/`node:fs`, and
 * the browser bundle already imports the root index (AgentInspector) where
 * Node builtins would break Vite.
 */
export * from './experiment.js';
export * from './ews.js';
export { ExperimentRegistry, defaultExperiments } from './experimentRegistry.js';
