# DeepSkrin - Differentiation vs existing approaches

> This document compares DeepSkrin to known approaches to the "cost of reads" problem
> (an agent's bill is O(reads), not O(edits)). Last updated: 2026-09-09.

## The problem, shared by everyone

The insight is now public: the vast majority of an agent's tokens go to reading tool
outputs (files, greps, commands), not to writing. Several projects approach this problem
from different angles. None of them combine a persistent cache, proven freshness, and
faithful compression.

## Comparison table

| Approach | What it does | What it lacks compared to DeepSkrin |
|---|---|---|
| **Prompt caching** (provider API, native in Claude Code) | Reuses the already-billed prefix within the same session (TTL in minutes) | Does NOT reduce volume: the model still re-reads everything in context. It is a price cache, not a meaning cache. Expires in minutes - dead cross-session. |
| **Naive PreToolUse anti-reread hooks** (community tutorials, e.g. docs.bswen.com 2026-03) | Intercepts a previously-seen read and returns a short stub | Naive exact-key cache WITHOUT freshness proof: the file may have changed and the model is never told. No persistent store, no recall, no metrics. |
| **claude-code-memory-cache** (GitHub, jushayden) | Persistent multi-layer memory (vector store, facts, vault) | This is memory for reasoning, not a tool-output cache. No staleness detection, no tool elision, no fidelity guarantee. |
| **Generic context compression** (snapcompact, native compaction) | Summarizes/truncates history when context overflows | Destructive: the original tool output is gone. DeepSkrin compresses WITHOUT loss (everything stays recallable) and does not wait for compaction to act. |
| **Prewalk / model handoff** (Stencil, 2026-07) | The frontier model plans, the cheap model executes with the context | Moves reads to a cheaper model, does not eliminate them. Reads keep being paid (twice). Orthogonal to DeepSkrin: the two combine. |

## The 5 differentiators none of the above has

1. **Proven freshness, not age heuristics.** Every `read_file` blob is re-verified by
   mtime + size at serve time. Identical = "file unchanged". Different = score -60 and
   never served. Web and git get their own volatility policies. Stale content is never
   served as truth.

2. **Elision proven by instrumentation.** The `beforeToolCall` hook returns the stored
   output and the tool does not run; every elision is counted (`elide-flush`,
   `fidelityServes`, `stubServes`) and visible to both model and user. No silent magic:
   ground truth lives on disk.

3. **Deltas, not repeats.** A file re-read after an edit is re-served as a patch (real
   Myers diff, hunks with context) instead of the whole file.

4. **Post-compaction fidelity by epoch.** After a compaction, the first re-read of each
   file is served for real (the agent cannot believe it has read what it no longer has),
   then elision resumes. Hash-epoch mechanism, absent from every naive cache approach.

5. **Compression that never lies.** Negations are structurally impossible to drop,
   numbers/dates/URLs/identifiers preserved, any compression that does not save enough
   is discarded, errors are always shown. The store is content-addressable (sha256),
   100% local, zero dependencies.

## Positioning in one sentence

Naive caches answer "I have seen this somewhere before"; DeepSkrin answers "I have read
this, the file has not changed since, here is the proof, and if you want everything,
here is the exact reference".

---

## Deep dive: DeepSkrin vs prewalk (Stencil, 2026-07)

Prewalk is the closest published work in spirit: it starts from the same observation
(an agent's bill is O(reads)) and ships a measured optimization (92% of frontier pass
rate at 53% of the cost on SWE-bench-class tasks). But it optimizes a different axis
entirely.

**What prewalk does.** A frontier model starts the task, explores, writes a plan as a
todo list and lands the first edit. At that moment the run swaps to a cheap executor
that inherits the live context window. The savings come from who pays for the reads:
the expensive model stops reading early, the cheap model finishes.

**What prewalk does not do.** The reads still happen - all of them. Within a single
run, every file is read exactly once anyway, so a within-run read cache has nothing to
eliminate. And across runs, the whole trajectory dies with the session: the next task
on the same repo re-reads the same files at full price. Prewalk also requires a
handoff-capable harness (two models, swap-on-first-edit machinery) and inherits its
failure modes (small models forgetting the plan, todo-list drift, the 60-item todo
pathology they had to patch).

**What DeepSkrin does instead.** Reads are not moved, they are eliminated: every
re-read of an unchanged file is elided for the whole life of the workspace, and
re-reads of modified files cost only their diff:

1. **Cross-session, not cross-model.** The store persists between sessions. The second
   task on the same repo starts with the first task's reads already paid for. Prewalk
   has no memory beyond its single handoff.
2. **Proof-carrying reuse.** A cached blob is re-served only if its mtime/size still
   match. Prewalk's context transfer has no freshness notion - if a file changes
   mid-run, the cheap model reasons over stale context with no signal.
3. **Faithful compression on top.** Prewalk transfers the context verbatim; the token
   volume is untouched. DeepSkrin shrinks compressible tool outputs (up to 50-90% on
   structured JSON) before they enter context, and passes through anything that does
   not compress by at least 10% - so even the reads that DO happen cost less, for the
   frontier model during planning and for the cheap model during execution.
4. **Minimal harness requirements.** DeepSkrin needs hooks (beforeToolCall /
   afterToolCall / transformContext), not a two-model swap - single model, fail-open
   degradation. It runs wherever those hooks exist (Command Code today). Port note:
   Claude Code's shell hooks cover the first two (PreToolUse / PostToolUse) but
   expose no context-rewrite hook, so live compression requires a harness at
   Command Code's level.

**The two combine.** A prewalk run whose frontier exploration and cheap execution both
sit on a DeepSkrin store pays each unchanged file's read cost once per workspace
instead of once per run (mtime-verified elision), pays only the Myers diff when a file
does change, and compresses every read that still happens before it enters context.
Prewalk optimizes who reads; DeepSkrin optimizes whether reading is needed at all.
