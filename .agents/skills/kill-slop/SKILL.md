---
name: kill-slop
description: >-
  Stop AI coding agents from shipping sloppy code — over-abstraction, drive-by
  refactors, obvious comments, extra files, unrequested deps, giant unreadable
  files, or fishing outside the workspace for “inspiration”. Use when writing or
  editing code, implementing features, fixing bugs, splitting or organizing
  files, or when the user mentions slop, cleanup, keep it simple, minimal diff,
  file too big, hard to navigate, or stay in the repo.
---

# Kill Slop

Force a minimal, merge-ready diff. Prefer the smallest change that fully solves the stated task.

## Hard rules

- NEVER create a file unless the task clearly needs it **or** a navigability split below applies
- NEVER add a dependency unless the user asked or existing code already requires it
- NEVER refactor unrelated code "while you're here"
- NEVER add comments that restate what the code already says
- NEVER introduce abstractions (wrappers, helpers, factories, "utils") for a single use
- NEVER expand scope beyond the user's request
- NEVER invent TODOs, stubs, or "for later" scaffolding
- NEVER search, list, or read outside the workspace root unless the user explicitly asks
- NEVER browse sibling projects, home, Desktop, or prior chats for “patterns” or inspiration
- NEVER invent Clean Architecture / SOLID folder trees (`domain/`, `application/`, `infrastructure/`, `usecases/`, …) unless the repo already uses that layout
- MUST match existing project patterns before inventing new ones
- MUST prefer editing an existing file over adding a new one
- MUST delete dead code you introduce; do not leave unused imports/vars

## User intent wins

Default to minimal. If the user **explicitly** asks for more structure, obey that request.

Examples of explicit asks (do what they asked):

- "use Clean Architecture / hexagonal / feature folders"
- "scaffold the full project layout"
- "add dependency X" / "set up Prisma / NextAuth / …"
- "extract a shared abstraction" / "add a utils module"
- "write tests" / "add comments explaining this"

Do **not** override an explicit ask in the name of kill-slop. Minimalism applies when they did **not** request the heavier shape. If the ask is ambiguous, prefer minimal and say what you skipped.

## File shape (navigability)

Goal: easy to walk for humans and agents — without architecture theater.

**Default:** colocate. Edit the file/folder that already owns this concern.

**Split only when ALL of these hold:**

1. **Pain now** — the file is already hard to navigate (rough guide: ≳300–400 lines, or clearly mixed unrelated concerns), **and** your change would make it worse
2. **One unit** — you’re extracting a single cohesive piece (one component, one route handler, one pure helper) with a clear name
3. **Local fit** — the new file follows an existing nearby pattern (same folder / naming). If there is no pattern, still colocate beside the caller — do not invent a new layer

If only (2) is true (“I could extract this”), **do not split**.

**When you split:**

- MUST put the new file **next to** related code (same directory)
- MUST fix imports; no dead re-exports “for convenience”
- MUST keep the diff on this task — no repo-wide re-org
- NEVER split for SOLID, cleanliness, or “future features”
- NEVER create `utils/` / `helpers/` / `common/` / `lib/` for a single function unless that folder is already the repo convention
- If unsure: **don’t split** — say so in the summary

Greenfield: prefer flat under one root (`src/` is enough) until real navigability pain appears.

## Diff budget

Before writing code, decide:

1. **Goal** — one sentence: what changes for the user
2. **Touch list** — the fewest files that can achieve it
3. **Non-goals** — what you will not do

If the touch list grows past ~5 files for a small task, stop and shrink the plan.

If the workspace is empty or has no prior pattern, implement the smallest reasonable solution **in-repo**. Do not leave the workspace to find examples.

### Measure before finishing

From the **project being edited** (cwd = that repo), run the bundled read-only checker (never modifies the tree):

```bash
bash <path-to-this-skill>/scripts/check-diff.sh
```

Optional: `--max-files 5` (default), `--base HEAD`.

- `STATUS: OK` — within soft file budget; still apply the self-check below
- `STATUS: OVER_BUDGET` — shrink before ending (edit existing files, drop drive-bys)
- `STATUS: SKIP` — no git / no base; count files manually with the same ~5-file rule

If the user **explicitly** asked for a large scaffold or many files, obey that ask (see User intent wins); do not treat OVER_BUDGET as a reason to ignore them.

## Style

- Prefer boring, readable code over cleverness
- Handle real error paths the task needs; skip speculative ones
- Names should explain intent; if you need a comment, rename instead
- Tests: only when the repo already tests this area, or the user asks

## Self-check (before finishing)

Answer these. If any fails, fix before ending:

- [ ] Every changed line serves the stated goal
- [ ] No new files that could be inlined into an existing one
- [ ] Any new file exists only for navigability (or explicit need) — not architecture cosplay
- [ ] New files sit beside related code and match repo layout
- [ ] No new deps
- [ ] No drive-by renames/moves/refactors
- [ ] No obvious comments (`// import x`, `// return result`)
- [ ] No out-of-workspace reads or “inspiration” fishing
- [ ] Diff is something a senior would merge without asking "why is this here?"
- [ ] Explicit user asks for architecture / deps / tests / layout were honored (not “killed” away)
- [ ] Ran `scripts/check-diff.sh` (or manual file count) and addressed OVER_BUDGET if the user did not ask for a large scaffold

## Output

When summarizing, say what you changed and what you deliberately did **not** change. If you split a file, say **why** (navigability), in one sentence. If the user asked for a heavier shape, say that you followed that ask.
