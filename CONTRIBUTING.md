# Contributing to DeepSkrin

Thank you for your interest in contributing. Bug reports, benchmark results, and code
contributions are all welcome.

---

## 1. Bug Reports

Before opening an issue, search existing issues to check whether the problem is already
documented.

When filing an issue, please provide:

- **Environment**: OS, runtime (node version), and how the mod is loaded (Command Code
  version, or other host).
- **Version**: DeepSkrin version or commit hash.
- **Reproduction**: the exact tool calls and inputs that triggered the behavior.
- **Expected vs. Actual**: what the store should have served versus what it served.
- **Telemetry**: the output of `/deepshrink status` and `metrics.json`
  (`fidelityServes`, `stubServes`, `postCompactionStubs`, `recallCalls`). These counters
  are the ground truth for every serve/stub decision; an issue without them is much
  harder to diagnose.

---

## 2. Design Principles (non-negotiable)

Any contribution must preserve these properties. A PR that violates them will be
rejected regardless of its other merits:

1. **Fail-open**: any doubt keeps the original. Compression is never allowed to risk
   correctness for savings.
2. **Stale content is never served as truth**: freshness proofs (mtime + size, source
   volatility policies) are load-bearing. Loosening them is a correctness regression.
3. **Lossless recall**: everything dropped from context must remain recoverable in the
   store.
4. **Zero dependencies**: pure TypeScript, no binaries, no ML runtimes.
5. **No comments in code**: the codebase is comment-free by convention; symbols, types,
   and tests must carry the intent.

---

## 3. Development Workflow

### Prerequisites

- Node 18+
- A Command Code host for live testing (unit tests run without one)

### Testing

Every core module has a paired test file in `test/` (e.g. `core/confidence.ts` and
`test/confidence.test.mjs`).

```bash
# Run the full unit suite
node --test test/

# Run a single module's tests
node --test test/confidence.test.mjs
```

When adding or changing logic in a core module, add or update the paired test file.
Compression and freshness behavior changes must include a test that fails when the
guarantee is removed (a test you have not seen fail proves nothing).

### Adding a compression rule

New compression rules live in `core/rules.ts` / `core/compress.ts` and must:

1. Preserve negations and critical data (numbers, dates, URLs, identifiers).
2. Prove a net token gain (the meter rejects smaller-than-threshold wins).
3. Come with before/after fixtures in the paired test.

---

## 4. Pull Requests

- One PR per concern. Keep refactors separate from behavior changes.
- CI must pass: full unit suite green, no new dependencies.
- Describe the guarantee your change touches (see section 2) and how the tests prove it
  is preserved.
