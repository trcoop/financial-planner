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
   violations (e.g., current age exceeding the planning horizon) — it does not trust its
   caller, since it's an isolated unit that could end up called from more than
   just this UI (tests, potentially a worker or another client later).
2. **UI** (`src/ui/`) — React components. Owns state via `useState`/`useReducer`.
   Does its own live validation for immediate user feedback, but that's a UX
   concern layered on top of — not a substitute for — the engine's validation.

A thin `src/storage/` module handles localStorage read/write, decoupled from both
the engine and the UI, with defensive error handling (quota exceeded, storage
disabled) that falls back to in-memory-only rather than crashing.

A thin `src/workers/` module owns Web Worker lifecycle for Tier 2 (instantiate,
`postMessage`, `terminate`/respawn on cancel), and reconstructs typed errors that
cross the worker boundary back into real engine error instances before resolving
or rejecting its promise-based API back to the UI. It wraps calls to a pure
per-trial function that lives in `src/engine/` and is executed inside the worker
script — the orchestration itself is impure (Worker lifecycle, Promise-based), so
it stays outside `src/engine/` rather than violating the engine's no-I/O rule.

## UI conventions

Full rationale: [UI Foundation Design](https://linear.app/travis-playground/document/ui-foundation-design-57ec12f039d3) (Linear).

- **Design tokens**: `src/ui/theme.css` defines color, spacing, typography,
  radii, and shadow as CSS custom properties on `:root`, plus a minimal
  reset. Components consume tokens for color, spacing, radii, shadows, and
  typography — no hardcoded hex/color values. Structural literals (e.g. 1px
  border widths, layout breakpoints) may stay as plain values where
  tokenizing them wouldn't serve a real redesign lever.
- **Component library**: reusable primitives live in `src/ui/components/`,
  one folder per component (`Component.tsx` + `Component.module.css` +
  `Component.test.tsx`), CSS Modules only, exported via a barrel
  `src/ui/components/index.ts`. Feature composition (forms, tables, the
  app shell) lives directly under `src/ui/`, not under `components/`.
  Primitives own only their own state/behavior — no engine or app-state
  knowledge.
- **Shared hooks**: `src/ui/hooks/` for cross-cutting UI behavior used by
  more than one component (e.g. the Tier 1 debounce).
- **Accessibility baseline**: real `<label htmlFor>` associations (not
  placeholder-as-label), validation wired via `aria-describedby` +
  `aria-invalid`, native `<details>`/`<summary>` for disclosure widgets.
  Component tests query by role/label as the primary interaction surface.
  WCAG AA contrast target (4.5:1 text, 3:1 UI components), enforced at
  write-time via oxlint's built-in `jsx-a11y` plugin. A `--focus-ring`
  token drives `:focus-visible` styling everywhere — never suppressed.
- **Testing**: co-located `Component.test.tsx`, Vitest + React Testing
  Library, behavior-focused — matches the engine's existing co-located
  test convention.

## Computation model (two-tier)

- **Tier 1 (base projection)**: recalculated on every input change, ~300ms
  debounced, runs synchronously on the main thread. Cheap enough (rough math:
  well under a millisecond) not to need a Web Worker.
- **Tier 2 (stress test / Monte Carlo)**: runs in a Web Worker on explicit user
  trigger, off the main thread. If the user changes any input while a run is
  in-flight, the run is cancelled (worker `terminate()`'d and respawned) and
  the trigger button re-enables — no auto-restart, no queueing. Previously
  completed results stay on screen; only the in-flight run is discarded.

## Open / deferred decisions

- Deployment target
- Charting library (relevant once results-visualization work starts)
- Server-backed sync (future phase, not MVP)
