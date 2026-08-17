/**
 * Public surface of Web Worker orchestration (architecture.md). UI code (FIN-19) imports from
 * here rather than reaching into individual modules.
 */

export {
  createMonteCarloOrchestrator,
  MonteCarloCancelledError,
} from './monteCarloOrchestrator';
export type {
  MonteCarloOrchestrator,
  StressTestState,
  WorkerFactory,
  WorkerLike,
} from './monteCarloOrchestrator';
