---
name: peer-review-loop
description: Use when two distinct roles/personas need to iteratively review and refine a shared artifact (a PRD, an ERD, a batch of Linear tickets, a design doc) before it's consumed by a downstream step — orchestrates a bounded, rubric-driven back-and-forth between two agent personas until convergence or a round cap, keeping edits additive and escalating genuine open decisions instead of guessing at them.
---

# Peer Review Loop

Two personas go back and forth on one artifact until it's actually good enough
to build from — not until either side gets tired or starts agreeing to be
agreeable.

This came out of a PM/Engineer loop that clarified three PRDs before an ERD
was written from them (FIN project). The mechanics below are what made that
loop trustworthy rather than theater; they're not specific to PRDs.

## When to use

- A domain-owner persona and a reviewer persona need to converge on one
  artifact before something else gets built from it: PM x Engineer on a PRD,
  Engineer x Engineer on an ERD's implementability, PM x Engineer on a batch
  of tickets, Architect x Security/Ops on a design doc's failure modes, QA x
  Engineer on a test plan's coverage.
- The artifact is concrete and editable in place (a Linear document, a set of
  Linear issues, a repo file) — not a free-floating discussion.

Don't use this for a single reviewer with no real second perspective (that's
just a review), and don't use it for code review (a different concern with
its own tooling).

## Core principles

These are the load-bearing lessons — skipping any one of them is how this
degrades into either an infinite loop or synthetic agreement that didn't
actually improve anything.

1. **Rubric over vagueness.** The reviewing persona works from a concrete,
   written checklist specific to this artifact type — not "any concerns?".
   "Check for missing edge cases, ambiguous data contracts, and untestable
   acceptance criteria" produces real findings. "Review this PRD" produces
   either nothing or manufactured disagreement to look useful. Write the
   rubric before starting the loop, not on the fly inside round 1.
2. **Bounded rounds.** Agree an explicit round cap with the user before
   starting — don't default one silently, since it trades thoroughness for
   time/cost and that's the user's call. The loop must terminate at the cap
   even without full convergence.
3. **Additive edits only.** The persona editing the artifact never rewrites
   or restructures existing content — only adds clarifying inserts,
   superseding notes, or new clauses that preserve the original text and
   history. In Linear, this means `save_document`/`save_issue` with `patch`
   operations (`insert_after`, `insert_before`, `append`, targeted
   `replace`), not wholesale `content` replacement.
4. **Escalate, don't guess.** When a raised issue is a genuine product or
   engineering decision — not a clarity gap — the responding persona flags it
   explicitly (e.g. prefix with `OPEN DECISION:`) instead of resolving it
   unilaterally. These get surfaced to the user after the loop, not decided
   inside it.
5. **Scope discipline.** The loop's deliverable is a clarified version of the
   *input* artifact — nothing more. A PRD-review loop must not start drafting
   the ERD; an ERD-review loop must not start writing code — even if a
   persona feels ready to, and even if the user's eventual goal is exactly
   that next step. The next step is separate work, gated on the user
   reviewing this loop's output first.
6. **Explicit convergence signal.** Define a "done" signal (e.g. the
   reviewing persona replies `READY` with no new issues) that's distinct from
   "hit the round cap," so it's unambiguous afterward why the loop stopped.

## Setup checklist

Gather all of this with the user before spawning anything:

- [ ] Name both personas and give each a **distinct rubric**, not just a job
      title — a title isn't a rubric.
- [ ] Identify the target artifact(s): Linear document id(s), issue id(s), or
      file path(s).
- [ ] Confirm the round cap.
- [ ] Confirm which persona owns edit rights to the artifact (usually the
      domain owner — PM for a PRD, ticket owner for tickets) and that
      additive-only applies to them.
- [ ] Confirm whether the loop should run unattended and report only at the
      end, or surface each round for the user to see as it goes. Both are
      reasonable; ask rather than assume.

## Orchestration mechanics

**Round structure:** reviewer persona checks the current artifact against its
rubric and produces concrete, specific issues (not vague feedback) → owner
persona resolves each one: either an additive edit, or an explicit
`OPEN DECISION` flag if it's a real unresolved call → reviewer re-checks the
updated artifact. Repeat.

**Using the Agent tool for personas:**
- Each persona turn is an `Agent` call. These are asynchronous even for
  non-fork agents — the result arrives later as a separate task-notification,
  not inline. Plan orchestration around that; don't expect a synchronous
  reply.
- To continue a persona across rounds, use `SendMessage` to that persona's
  returned agent id — a fresh `Agent` call starts a new agent with no memory
  of the prior rounds, which defeats the loop.
- Track the round count yourself; stop at the earlier of the convergence
  signal or the agreed cap.

**On hitting the cap without convergence:** don't present it as success.
Report the remaining unresolved issues to the user as unfinished business.

## After the loop

Report to the user: rounds actually used, what was found and resolved, and
any `OPEN DECISION` items needing their input. Stop there. Do not proceed to
whatever comes next (writing the next artifact, implementing, opening
tickets) without the user explicitly saying to — regardless of what either
persona concluded about readiness.

## Example persona/rubric pairs

Not exhaustive — a reference for calibrating a new rubric, not a menu to pick
from verbatim.

- **PRD clarity** — PM (domain owner, additive editor) x Engineer (rubric:
  missing edge cases, ambiguous data contracts, untestable acceptance
  criteria, internal contradictions).
- **ERD implementability** — ERD author (domain owner, additive editor) x a
  second Engineer (rubric: does this actually specify enough to implement
  without guessing — unpinned types, missing algorithms, unhandled error
  paths, parallel-execution hazards between work packages).
- **Ticket quality** — PM x Engineer (rubric: is each ticket correctly
  scoped/sized, does it reference the right spec sections instead of
  duplicating them, are acceptance criteria testable, are cross-ticket
  dependencies called out).
- **Design-doc risk** — Architect x Security/Ops (rubric: failure modes,
  blast radius, operational burden). Not yet used on this project, but the
  same mechanics apply.
