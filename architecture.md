# Architecture

Status: agreed, MVP scope. Requirements live in Linear (project: DIY Financial
Planner - MVP); this doc covers how the system is structured, not what it does.

## Stack

- React + TypeScript + Vite
- No backend for MVP — pure client-side SPA
- No external state management library (React state is sufficient for this scope)
- Vitest + React Testing Library

Deployment target not yet decided — not needed until there's something to deploy.

## Core principle: zero network calls after initial load

All data stays in the browser. No CDN-loaded scripts, no analytics/telemetry/error-
reporting SDKs — everything bundled at build time. This is a deliberate privacy
stance (ProjectionLab-style), not an oversight, so treat any future addition of a
network call as a decision that needs to be made explicitly, not something that
sneaks in via a dependency.

A future phase may add opt-in server-backed features (e.g., cross-device sync,
likely Node.js). Not designed for yet — YAGNI until it's actually being built.

## Structure

Two layers, kept strictly separate:

1. **Engine** (`src/engine/`) — pure, framework-agnostic TypeScript functions
   (projection calculation, Monte Carlo simulation). No React dependency, no I/O.
   The engine validates its own inputs and throws typed errors on invariant
   violations (e.g., retirement age ≤ current age) — it does not trust its
   caller, since it's an isolated unit that could end up called from more than
   just this UI (tests, potentially a worker or another client later).
2. **UI** (`src/ui/`) — React components. Owns state via `useState`/`useReducer`.
   Does its own live validation for immediate user feedback, but that's a UX
   concern layered on top of — not a substitute for — the engine's validation.

A thin `src/storage/` module handles localStorage read/write, decoupled from both
the engine and the UI, with defensive error handling (quota exceeded, storage
disabled) that falls back to in-memory-only rather than crashing.

## Computation model (two-tier)

- **Tier 1 (base projection)**: recalculated on every input change, ~300ms
  debounced, runs synchronously on the main thread. Cheap enough (rough math:
  well under a millisecond) not to need a Web Worker.
- **Tier 2 (stress test / Monte Carlo)**: runs synchronously on explicit user
  trigger, not tied to the debounced input flow. Stays independent of Tier 1 —
  changing inputs afterward doesn't re-trigger or clear it.

If real performance data later shows either tier needs to move off the main
thread, the engine's pure-function design ports to a Web Worker without a
rewrite — deferred until there's evidence it's needed.

## Open / deferred decisions

- Deployment target
- Charting library (relevant once results-visualization work starts)
- Server-backed sync (future phase, not MVP)
