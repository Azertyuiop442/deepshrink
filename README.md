<p align="center">
  <img src="assets/Title.png" alt="DeepSkrin" width="100%"/>
</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://shieldcn.dev/badge/deepshrink-v1.0.0-24837b.svg?variant=outline" alt="DeepSkrin v1.0.0"/></a>
  <a href="LICENSE.md"><img src="https://shieldcn.dev/badge/license-AGPL--3.0-d14d41.svg?variant=outline" alt="License"/></a>
  <img src="https://shieldcn.dev/badge/savings-50--90%25-879a39.svg?variant=outline" alt="Token savings"/>
  <img src="https://shieldcn.dev/badge/runtime-100%25_local-8b7ec8.svg?variant=outline" alt="Local"/>
</p>

> **"Compression never changes the meaning."**

DeepSkrin is a context-compression engine for coding agents. Tool outputs (file reads,
greps, commands) are cached in a content-addressable store and re-served with proof
they are still valid. Savings: 50 to 90% of tool-output tokens on a realistic mix.

The core constraint: a compressed output must never mean anything different from the
original. "The hook must not suppress errors" must never become "The hook must suppress
errors", whatever the token cost of preserving it.

---

---

## Why naive caching fails

A naive cache answers "I have seen this read before" and returns the stub. Three failure
modes, all observed in the wild:

1. The file changed since the cached read. The model reasons over stale content with no
   way to know.
2. The stub replaces content the model no longer has in context (post-compaction). It
   believes it has read what it has not.
3. The compression itself inverts meaning: dropping "not" saves 1 token and inverts the
   instruction. The resulting repair loop costs more than the token saved.

DeepSkrin addresses each one structurally, not statistically.

---

## Comparison with existing approaches

An agent's bill is O(reads), not O(edits). Existing approaches, and what they leave on
the table:

| Approach | What it does | What it does not do |
|---|---|---|
| Prompt caching (provider API) | Reuses the already-billed prefix within the same session | Does not reduce volume: the model still re-reads everything in context. Useless cross-session. |
| Anti-reread hooks (tutorials) | Intercepts a previously-seen read, returns a short stub | Exact-key cache without freshness proof. No persistent store, no recall, no metrics. |
| Persistent agent memories | Multi-layer memory for reasoning | Not a tool-output cache. No staleness detection, no elision, no fidelity guarantee. |
| Context compaction | Summarizes history when context overflows | Destructive: the original tool output is gone. DeepSkrin is lossless (everything stays recallable) and acts before compaction. |
| Model handoff (prewalk) | Frontier model plans, cheap model executes | Moves reads to a cheaper model, does not eliminate them. Orthogonal: the two combine. |

Full write-up in [DIFFERENTIATION.md](./DIFFERENTIATION.md).

---

## Architecture

<p align="center">
  <img src="assets/architecture.svg" alt="DeepSkrin architecture" width="100%"/>
</p>

Tool outputs enter through the host's hooks. `afterToolCall` ingests each output into
the content-addressable store with mtime + size provenance. On the next identical
`read_file`, `beforeToolCall` asks the confidence scorer: proof still valid means the
stored content is served and the tool never runs; anything stale means the tool re-runs
for real. `transformContext` keeps the context view lossless across compactions, and
the meter verifies every compression actually saved tokens.

---

## Guarantees

| Guarantee | Mechanism |
|---|---|
| Meaning never changes | Negation words (`ne/pas/jamais/not/never/nicht/kein...`) are structurally impossible to drop. Numbers, dates, amounts, versions, URLs, identifiers are never candidates for removal. |
| Freshness is proven | `read_file` blobs are re-verified by mtime + size at serve time. Identical: serve. Different: score drops by 60 and the blob is never served as content. Web and git results get their own volatility policies and time decay. |
| Stale content is never served | A blob below the stale threshold (score < 40) returns as a hint (reference + reason, no content). Tool elision (`beforeToolCall`) lets the real tool run. |
| Zero information loss | Every tool output is stored in full (sha256 content-addressable store) and recoverable via `deepshrink_recall` with a confidence score. |
| Measured, not assumed | Every compression verifies the result is smaller and the net token gain is positive; otherwise the original is kept. The chars-per-token estimator self-calibrates on real API usage events (OLS fit, ASCII and CJK priced separately). |
| Multi-language | English, French, Spanish, German, accent-normalized (`décision` = `decision`). |
| 100% local, zero dependencies | Pure TypeScript. No binaries, no ML libraries. |

---

## What it compresses

- API JSON: repetitive arrays become compact tables (`[N=12]{id:int,name:str}` + CSV), up to -90%.
- Stack traces: keeps the error and application frames, folds runtime frames (`[... N frames collapsed]`).
- Grep results: grouped per file with counts (`[Search results: N matches in M files]`).
- git status: compact modified-file lists (names always kept).
- Large texts: keeps salient segments (errors, figures, keywords), drops filler.
- Prose: drops filler words in fr/en/es/de, preserves negations and content words.

## The numbers

- ~76% average savings on a realistic mix of tool outputs (JSON + grep + logs + large files).
- ~8,000 tokens saved per typical session.
- Every byte remains recoverable via recall with a confidence score (0-100%) and staleness detection.
- Recall runs on an in-memory inverted index with code-aware tokenization:
  from O(total bytes) to O(candidates), measurable in `/deepshrink status`.

---

## How it works (animated)

| Episode | What it shows |
|---|---|
| Proven Freshness | Every cached blob is re-verified by mtime + size. Stale content is never served. |
| ![Proven Freshness](./assets/ProvenFreshness.gif) | |
| Delta Ratio | A re-read file is re-served as a Myers-diff patch, not the whole file. |
| ![Delta Ratio](./assets/DeltaRatio.gif) | |
| RRF Fuse | Recall ranking: the blob both query signals agree on wins. |
| ![RRF Fuse](./assets/RrfFuse.gif) | |
| Net Gain | The meter is calibrated on the real API bill. A compression ships only if net > 0. |
| ![Net Gain](./assets/NetGain.gif) | |
| Negation Guard | Negations are structurally undeletable. Compression can never invert meaning. |
| ![Negation Guard](./assets/NegationGuard.gif) | |

---

## Install

```bash
# macOS / Linux
git clone https://github.com/Azertyuiop442/deepshrink.git
cd deepshrink
bash install.sh
```

```powershell
# Windows (PowerShell)
git clone https://github.com/Azertyuiop442/deepshrink.git
cd deepshrink
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer copies only the runtime files (`core/`, `runtime/`, `entry/`,
`package.json`) into `~/.commandcode/mods/deepshrink`. Assets, tests and docs stay out
of your machine: they are useless at runtime. Restart your Command Code session, then
verify with `/deepshrink status`.

---

## Commands

```
/deepshrink            Main menu (status, stats, recall, store, config, clean...)
/deepshrink on|off     Enable / disable compression
/deepshrink recall     Search stored content (regex + confidence)
/deepshrink stats      Real savings (net token gain)
/deepshrink clean      Purge the store (workspace or everything)
/deepshrink-log        Detailed compression logs
```

## Fail-open rules

- Any doubt: keep the original.
- Output below threshold: untouched.
- Compression saving < 10%: discarded.
- Errors are never hidden, always shown to the model.
- Credentials are redacted before anything is stored.

<details>
<summary>Engineering notes (post-compaction fidelity guard, rolling-hash debt)</summary>

Post-compaction fidelity guard: re-reads of unchanged files are elided to a short stub,
but only while the model still has the content in context. After a compaction boundary
(`compaction_start` event or a new summary in `transformContext`) an epoch counter
increments; a blob is stub-eligible only if re-served since the last boundary
(`servedSinceEpoch[hash] === epoch`, LRU ~256). The first re-read after compaction is
always served for real (~24K fidelity budget, bypassing the 2 KB recall budget), then
elision resumes. Telemetry: `fidelityServes`, `stubServes`, `postCompactionStubs`
(must stay ~0), `recallCalls` in `metrics.json` and `/deepshrink status`.
Bootstrap note: numeric-only (~400 chars, filename allowlist, no raw content), injected
once per session via `appendCustomMessageEntry`. `compactGuard` is ON by default.
Known limit: windowed output without compaction ("seen = still in context") remains an
unverifiable-by-hook heuristic.

</details>

---

## Community

<p align="center">
  <img src="https://shieldcn.dev/badge/discord-9990007-4385be.svg?variant=outline" alt="Discord"/>
  &#160;
  <a href="https://x.com/astra442"><img src="https://shieldcn.dev/badge/x-%40astra442-CECDC3.svg?variant=outline" alt="X"/></a>
</p>

Issues and pull requests welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

AGPL-3.0. Any fork or redistribution (including as a network service) must republish
the modified source under AGPL-3.0 and retain attribution notices. Commercial license
available on request: contact the author.
