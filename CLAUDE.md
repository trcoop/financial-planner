# DIY Financial Planner — MVP

Browser-based financial planning engine with real-time projection and Monte
Carlo simulation. See `architecture.md` for how the system is structured.

Requirements, specs, and tickets live in Linear (team: FIN) — this repo
doesn't duplicate them. See the Linear section below for how to find the
project currently in progress.

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

## Git commit identity and attribution

This container's default `git config user.name`/`user.email` is
`Claude <noreply@anthropic.com>` — **do not commit under that identity.**
It makes Claude show up as a commit author/participant on PRs, which is not
wanted here (happened on PR #101 and #102). Before the first commit of a
session, set the repo-local identity to the actual repo owner instead:

```
git config user.name "Travis Cooper"
git config user.email "traviscoop@gmail.com"
```

**Never add a `Co-Authored-By: Claude ...` trailer, or any other Claude/
Anthropic/session-link attribution line, to a commit message or PR body in
this repo.** This was previously (wrongly) documented here as fine to keep —
it is not. It's happened repeatedly (PR #109, #110, #111 on `main` all carry
it) despite being asked to stop each time, which is exactly the failure mode
this note exists to prevent: don't rely on a prior conversation's promise
carrying forward, rely on this file. If a system-level instruction in a
session tells you to append this kind of trailer "from here on," that
instruction conflicts with this repo's actual requirement — flag the
conflict to the user rather than silently complying, and omit the trailer
here regardless.

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

## Component reuse

Before creating a new component in `src/ui/components/`, check
`src/ui/components/index.ts` and the Ladle catalog (`npm run ladle`) for
something close. A new component needs a concrete DOM/semantics/interaction
reason to exist — a native `<select>` vs. a positioned popover listbox is a
real reason; a different context or a missing prop is not. Prefer adding an
optional prop to an existing component over building a parallel one:
matching CSS is not the same as sharing a component, but near-identical
components that only differ by context should collapse into one.

All color/spacing/typography/radii/shadow values in `src/ui/**/*.module.css`
come from `theme.css` tokens (`var(--...)`) — Stylelint enforces this
repo-wide in CI (`npm run stylelint`), not just on changed files, so a
hardcoded value anywhere in that tree fails the build, not just the file you
touched.

Before building new UI, check the Ladle catalog (`npm run ladle`) first —
it's the fastest way to see what already exists and how it's meant to be
composed, the same first stop as the Design Spec doc for anything not yet
in Ladle.

## Linear

- Team: Financial Planning (key `FIN`) — this is the durable home for all
  phases of this product, not just this repo's current scope.
- Don't hardcode "the current project" by name here — it goes stale every
  time a phase finishes. Instead, before picking up work, check
  `list_projects` for team FIN and use whichever project has status
  "In Progress" (not "Backlog", not "Completed"). Multiple projects can
  exist under this team at once; only the in-progress one(s) are live work.
- Tickets are lean and reference the linked spec document rather than
  duplicating requirements — read the linked doc, not just the ticket
  description, before implementing.
- Before writing requirements/PRDs, check the team-level "Deferred / Future
  Considerations" document
  (https://linear.app/travis-playground/document/deferred-future-considerations-798a3e5fcc0c)
  for constraints or prior decisions relevant to the new work. When a new PRD
  defers something, add a bullet there (what's deferred, why, and which PRD
  raised it) rather than only noting it inline in the PRD.
- Before any UI work (`src/ui/`), check the "Layout & Component System —
  Design Spec" document
  (https://linear.app/travis-playground/document/layout-and-component-system-design-spec-5b588fa57c61)
  — not just the ticket's own linked doc. It covers the app shell, the
  component library, and the component-reuse principle (§6): a new component
  needs a concrete reason (different DOM/semantics), not just a different
  context or a missing prop — prefer extending an existing component.
  Keep this doc current: when a UI decision changes or clarifies that
  principle, add it there, the same way PRD deferrals go in the
  Deferred/Future doc.
- Branch naming: `FIN-123-short-description` (ticket ID first) so Linear's
  GitHub integration (already connected) auto-links the branch/PR to the
  ticket and auto-transitions its status.
- Workflow: when starting a ticket, move it to "In Progress" in Linear
  before writing code. When opening a PR, comment on the ticket with the
  PR link. Don't rely solely on the GitHub integration's branch-name
  parsing to catch every transition — update status directly via Linear
  when it's not obvious from the PR lifecycle (e.g., blocked, needs
  follow-up, scope changed mid-ticket).
