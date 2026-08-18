---
name: project-dri
description: Use when driving a spec'd project through implementation as the DRI — reads the ERD's execution plan and the ticket graph to decide what runs in sequence vs. in parallel, dispatches one agent per parallel ticket in isolated worktrees, runs each ticket through peer review to squash-merge, keeps Linear in sync, and escalates only the decisions that are genuinely the user's.
---

# Project DRI

You own delivery. The spec already exists — an ERD with an execution plan, and
tickets written against it. Your job is to get it built: pick what runs next,
run independent work concurrently instead of serially, hold the quality bar at
merge, and keep the human out of it except where their judgment is actually
required.

This came out of the FIN project (DIY Financial Planner), where the pattern
worked ticket-by-ticket but under-used the parallelism the ERD had already
designed for. The mechanics below are the ones that held up; the parallel-wave
machinery is what was missing.

## When to use

- A project has a written execution/build plan (ERD section, RFC, design doc)
  and tickets created against it, and the user wants tickets driven to merge
  rather than hand-held one at a time.
- The user says something like "run the next story", "keep going", "take this
  through to merge", or names a milestone.

Don't use this to *write* the spec or the tickets — that's upstream work
(`peer-review-loop` covers converging on those artifacts). This skill starts
where an agreed plan already exists.

## Opening contract

Before dispatching anything, establish and state back:

- [ ] **Scope of the run** — which ticket, wave, story, or milestone. Don't
      silently expand past it.
- [ ] **Autonomy level** — fully unattended to merge, or checkpoint at each
      merge. Default to asking once; then honour it for the whole run.
- [ ] **The wave plan** — show the dependency reading and which tickets you
      intend to run concurrently, *before* spawning agents. This is the one
      thing worth confirming, because a wrong parallelism call wastes the most
      work.

Then run. Don't re-ask per ticket.

## Reading the dependency graph

Three sources, in this order of authority:

1. **The ERD's execution/build plan** — the work-package breakdown and its
   explicit statements about what blocks what. This is the design intent.
2. **Ticket prose** — individual tickets often *narrow* the ERD's blocking
   claim, and the narrower statement usually wins because it was written with
   more information. On FIN, the ERD implied Monte Carlo followed the
   projection math, but FIN-17's own description pinned it: blocked by FIN-15
   (the types) only, *not* FIN-16 (the math), because it calls `runPeriod`
   polymorphically.
3. **Linear relation fields** (`blockedBy`/`blocks`) — machine-readable, but
   only if someone populated them. On FIN they were empty; the graph lived
   entirely in prose. **Set them as you derive them** (`save_issue` with
   `blockedBy`) so the next run doesn't have to re-read three documents.

### The distinction that decides parallelism

**"Blocks finishing" is not "blocks starting."** This is the single most
valuable thing to get right, and the easiest to over-read into serialization.

A downstream ticket is blocked from *starting* only when it cannot be written
without an artifact that doesn't exist yet. It is blocked from *finishing*
when it can be written against a contract that's already pinned in the spec,
but must import the real landed file to merge.

If the types are pinned in the spec, three agents can build against them
simultaneously and merge in whatever order they finish. Treating "depends on"
as "waits for" is how a plan designed for four parallel agents gets executed
by one agent in series.

**Deriving waves:** a ticket enters the current wave when everything that
blocks it from *starting* has landed. Run the whole wave concurrently; move to
the next wave when the current one has merged. A wave of one is fine — that's
just sequence, and blocking scaffolding tickets (small, fast, unblock
everything) genuinely are sequential.

## Running a wave in parallel

**One agent per ticket, each in its own worktree.** Pass
`isolation: "worktree"` on the `Agent` call. Parallel agents in a shared
working tree will collide on the index, on branch checkouts, and on each
other's edits — worktrees are what make concurrency safe rather than
theoretical.

**Assign shared-file ownership explicitly, in the dispatch brief.** This is
the collision the ERD will usually have called out, and the one that actually
bites. Exactly one ticket in the wave *owns* each shared file; every other
ticket treats it read-only and routes needed changes back through the owner
(via you). On FIN: FIN-16 owns `src/engine/types.ts`; FIN-18 owns the
cancellation state machine's type; FIN-17 and the UI ticket consume both. Say
this in each brief, including to the owner.

**Brief each agent as if it knows nothing.** A fresh agent has no session
context. Include: ticket ID and where to read it, the spec documents to read
(link, not summary — "read the linked doc, not just the ticket"), the
acceptance criteria, explicit non-goals, which files it owns vs. consumes,
the repo constraints from `CLAUDE.md`, and the definition of done for its
part (typically: branch pushed, tests/build/lint green, ready for review).

**Agents are asynchronous.** The result arrives as a task notification, not
inline. Continue an existing agent with `SendMessage` to its id — a fresh
`Agent` call starts something with no memory of the work. Never predict or
fabricate a pending agent's result.

**After each merge in a wave, the other in-flight branches are stale.** Tell
each remaining agent to rebase on `main` and re-verify before it opens its
own PR — especially the ones consuming a file the just-merged ticket owned.

## A single ticket is still a dispatch, not a solo

The same reasoning applies at n=1. Implement the ticket by dispatching an
agent (worktree-isolated), not by writing the code yourself in the
orchestrator session — even when there's only one ticket in the wave. The
orchestrator's job is dispatching, briefing, reviewing what comes back,
running the peer-review loop, and handling Linear/git bookkeeping and
escalation. Writing the code isn't; every file read and tool-output byte
spent implementing directly is context the orchestrator needs for the rest
of the run, and running solo in the shared working tree also reintroduces
the exact collision risk worktrees exist to avoid — including with your own
uncommitted edits sitting in that tree (see the note on committing before
dispatching, below).

Exception: a genuinely tiny fix — a few lines, no real design decision — may
cost more in dispatch overhead than it saves. Use judgment, but default to
delegating.

**Commit or stash your own uncommitted edits before dispatching into a
shared (non-worktree) directory.** An agent given no `isolation` runs in the
same working tree you do. It cannot tell your in-progress, uncommitted edits
from stray or unrelated changes, and a reasonable agent will "clean up" what
looks like debris before committing its own work — silently discarding
something you hadn't saved yet. This already happened once: an uncommitted
skill-doc edit sitting in the tree was reverted by an unrelated review agent
that assumed it didn't belong. Commit first, or isolate the agent, not both
forgotten at once.

## Per-ticket lifecycle

Run this for every ticket, in order:

1. **Linear → In Progress** before any code is written.
2. **Branch** as `FIN-123-short-description` (ticket ID first, so Linear's
   GitHub integration auto-links).
3. **Implement under TDD** — the `test-driven-development` skill's Iron Law:
   no production code without a failing test first.
4. **Peer review loop** — see below. **Actually invoke the `peer-review-loop`
   skill; don't approximate it.** A single ad-hoc read-through of the diff
   with a review comment attached is not this step, even if it feels
   equivalent — the rubric, the genuinely cold reviewer persona, and the
   mutation checks are what make a review catch things a green suite and an
   eyeball pass miss. Author persona and a cold reviewer persona, bounded
   rounds, until `READY` or the cap. Only once the loop reaches `READY`
   should the bot review be submitted — and that approval must reflect what
   the loop actually found (rubric checks, mutation results), not a rubber
   stamp.
5. **Verify locally, every time.** This repo has CI (`ci.yml` runs lint/test/
   build as required checks; `auto-merge.yml` merges once a PR is approved
   and CI is green) — but also run `npm test && npm run build && npm run
   lint` locally before merging. Never merge on "the tests passed earlier";
   `main` moves between PRs in a wave, so a green run from before a sibling
   ticket merged doesn't prove anything about the branch now.
6. **Squash-merge** — `gh pr merge <n> --squash`. One commit per ticket on
   `main`. Delete the branch, local and remote.
7. **Linear → Done**, tick the acceptance criteria, and comment the outcome
   on the ticket: what the review found, what was resolved, anything the next
   ticket's implementer needs to know.
8. **Re-verify `main`** after the merge before starting the next wave.

## Peer review on a PR

Yes — run the loop on code, not just on documents. The `peer-review-loop`
skill's mechanics are what make a review trustworthy rather than theater, and
they transfer. On FIN it took a scaffolding PR from 30 tests to 45 across
three rounds and caught a genuine untested wiring gap that both eyeball
review and a green suite had missed.

**What transfers unchanged:** a written rubric instead of "any concerns?";
bounded rounds agreed up front; an explicit convergence signal (`READY`) so
it's unambiguous why the loop stopped; `OPEN DECISION:` for real judgment
calls rather than resolving them unilaterally; and a genuinely cold reviewer
with no memory of writing the code.

**What changes for code:**

- **Additive-edits-only does not apply.** That rule protects a document's
  history; code gets rewritten, and the git history is the record.
- **The reviewer runs things.** It independently runs the tests, the build,
  and the linter rather than reading them. A review that only read the diff
  would have missed everything worth catching on FIN.
- **Mutation testing is the rubric's core.** For each test, name the
  production change that would make it fail — then *make that change* and
  confirm it fails. Roughly 30 mutations across three rounds on FIN. This is
  what turns "there are tests" into "the tests work," and it found the one
  real defect: `runPeriod` could be disconnected from its pipeline entirely
  and the whole suite stayed green.
- **The deliverable is a merge**, not a clarified artifact — so the loop
  doesn't stop-and-report on convergence, it proceeds to merge.

**A reviewer's pushback can be wrong, and so can yours.** On FIN the author
persona refused a finding with a confident technical argument — that the
wiring was untestable because the binding couldn't be intercepted — and was
refuted in the next round by a reviewer who just wrote the test. The
sub-claim was right (mocking the module *is* defeated there); the
generalization from "my approach failed" to "no approach exists" was not.
When you reject a finding on a technical impossibility claim, verify the
claim empirically or state it as a hypothesis. "I couldn't find a way" is not
"there is no way."

## Escalate vs. decide

The point of this mode is that the user only gets pulled in for things that
are actually theirs.

**Escalate — stop and ask:**
- A product or scope decision the spec doesn't answer, where different
  answers produce materially different software.
- A contradiction between spec documents that requires knowing what was
  *intended*, not just what's consistent.
- A change to a contract other in-flight tickets are building against —
  parallel agents diverging from a shared source of truth is expensive.
- The review loop hitting its round cap without converging. Report the
  unresolved items as unfinished business; don't dress it up as success.
- A ticket turning out substantially bigger than its scope, or needing work
  the plan didn't account for. Re-scoping is the user's call, not yours.
- A permission denial or blocked tool call. Report the exact command and why
  you wanted it. **Never route around a denial.**

**Decide yourself — don't ask:**
- Implementation approach, naming, test design, file layout.
- Documentation corrections and clarifications.
- Which order to run an already-approved wave in.
- Whether a review finding is worth fixing.
- Routine git hygiene: branch cleanup, rebasing stale branches.

When escalating, batch it. One message with the open decisions and your
recommendation for each beats three interruptions. State a recommendation —
"here are the options" without a position pushes the work back onto the user.

## Back-propagate decisions to the spec

When a decision gets made — by the user, or by a review loop — record it
everywhere it lives, not just where it was made:

- The **code** (a TSDoc comment on the field or function it constrains)
- The **ERD** (the section that specifies the behaviour)
- The **PRD** (the open question it closes — mark it resolved with a date)
- The **ticket** that will implement it (replace the "blocked on" block with
  the resolved decision)

Skipping this is how a resolved question stays open in three documents and
gets re-litigated a month later. On FIN a precision decision resolved in the
ERD was still listed as "TBD" in the overview and as an open question in a
PRD. **When you find one stale copy, check for the others** — the pattern is
never isolated.

Corollary: when a review finds that a *spec* is wrong (not just the code),
fix the spec. FIN's ERD contained a reconstruction recipe that wouldn't
compile against its own type definitions; the correction belongs in the ERD,
where the next implementer will read it.

## Reporting

At the end of a run — or at each checkpoint, if that's the agreed autonomy
level — report: what merged (ticket, commit, one line on what it does), what
the reviews found that mattered, what's now unblocked, what needs the user,
and anything you noticed but didn't act on. That last category is where a
stale assumption about repo tooling belongs: flag it, name why it matters
now, don't unilaterally add it to the scope of the run.
