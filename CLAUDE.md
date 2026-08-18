# DIY Financial Planner — MVP

Browser-based financial planning engine with real-time projection and Monte
Carlo simulation. See `architecture.md` for how the system is structured.

Requirements, specs, and tickets live in Linear (project: DIY Financial
Planner - MVP, team: FIN) — this repo doesn't duplicate them.

## Commands

- `npm run dev` — start dev server
- `npm test` — run tests (Vitest)
- `npm run build` — typecheck + production build
- `npm run lint` — lint (oxlint)

## CI

GitHub Actions run on every PR and push to `main` (`.github/workflows/ci.yml`):
`lint`, `test`, and `build` as separate required checks. `auto-merge.yml`
enables auto-merge once a PR is approved, and it merges as soon as CI is
green. `deploy.yml` deploys `main` after merge. Branch protection requires
these checks to pass and the branch to be up to date with `main` before
merging — don't assume "tests passed earlier" is still true if `main` has
moved; nudge the PR's branch update if CI shows it as behind.

## Stack

React + TypeScript + Vite. No backend. No external state management library.
Vitest + React Testing Library for tests.

## Key constraint

Zero network calls after initial page load — no CDN scripts, no analytics/
telemetry. See `architecture.md` for rationale before adding any dependency
that talks to the network.

## Structure

- `src/engine/` — pure calculation functions (projection, Monte Carlo). No
  React, no I/O. Validates its own inputs — throws typed errors rather than
  trusting callers.
- `src/ui/` — React components. Own state, do live validation for UX, wire
  into the engine.
- `src/storage/` — localStorage persistence, decoupled from engine and UI.

## Linear

- Team: Financial Planning (key `FIN`) — this is the durable home for all
  phases of this product, not just this repo's current scope.
- Current phase's project: "DIY Financial Planner - MVP"
  https://linear.app/travis-playground/project/diy-financial-planner-mvp-3da6fbaac5ff
  — later phases get their own project under the same team, so don't assume
  this is the only project relevant to this codebase over time.
- Tickets are lean and reference the linked spec document rather than
  duplicating requirements — read the linked doc, not just the ticket
  description, before implementing.
- Branch naming: `FIN-123-short-description` (ticket ID first) so Linear's
  GitHub integration (already connected) auto-links the branch/PR to the
  ticket and auto-transitions its status.
- Workflow: when starting a ticket, move it to "In Progress" in Linear
  before writing code. When opening a PR, comment on the ticket with the
  PR link. Don't rely solely on the GitHub integration's branch-name
  parsing to catch every transition — update status directly via Linear
  when it's not obvious from the PR lifecycle (e.g., blocked, needs
  follow-up, scope changed mid-ticket).
