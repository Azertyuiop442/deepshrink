# Stats

**Measured, not assumed.** Every figure below comes from replays and benchmarks run on
real usage data, tied to the release that changed the behavior. Only aggregates are
published here: counts, byte totals, percentages. No file paths, file names, project
names, or stored content, and the store itself stays local.

---

## Protocol

- Before/after: the same data is replayed through two builds (before = the previous
  release, rebuilt from its archived source; after = the current release), in isolated
  store copies. No network, no mocks.
- Replay: one access per file, on the initial filesystem state. Files are classified
  intact (still matching the stored metadata), modified, or deleted.
- A same-session replay restores the store state a live session would have; a
  new-session replay starts from a fresh session.
- Each headline aggregate is re-derived from the raw per-file records, independently of
  the reporting harness.

## Data snapshot (2026-10-10)

| Metric | Value |
|---|---|
| Stored tool outputs | 2,101 |
| File reads with full metadata (freshness-proof candidates) | 561 |
| Unique files | 292 |
| Sessions | 10 |
| Workspaces | 5 |
| Traffic span | 5 days (2026-10-05 to 2026-10-10) |
| Store size on disk | ~13 MB |

Source mix: shell commands 840, file reads 574, edits 323, greps 187, writes 49,
directory reads 46, other 82.

Reproduce from the repository: `node tools/freshness-audit.mjs`

---

## v1.1.2 - Freshness proof includes kernel ctime (2026-10-14)

The freshness proof for `read_file` blobs is now `mtime + size + ctime`. `ctime` is set
by the kernel and cannot be rewritten from userland (`touch -r`, `utimes` only move
`mtime`), so a file whose timestamps were restored no longer passes as fresh. Blobs
written by earlier versions are re-verified against the file on first access and
upgraded; serving then costs a single stat per file, with no content read.

Replay of the snapshot (292 files), previous release vs current:

| File class | Files | Before (v1.1.1) | After (v1.1.2) |
|---|---|---|---|
| Intact, same session | 116 | 114 reads served from the store - 597,161 chars | 112 verified deltas + 4 real reads - 18,997 chars |
| Intact, new session | 116 | 114 reads served on metadata alone - 597,161 chars | 0 reads served without the full proof |
| Modified | 92 | 74 deltas (150,881 chars) + 18 real reads | identical |
| Deleted | 84 | 84 real reads | identical |

Re-verified reads of unchanged files now deliver 18,997 chars instead of 597,161
(-96.8%). Reads with an incomplete proof (new sessions, blobs from earlier versions)
fall back to the real tool instead of being answered from the store.

Audit of the same snapshot under the previous proof:

| Previous metadata check | Blobs |
|---|---|
| Passed as metadata-fresh | 232 |
| Content-identical in the bytes served | 228 |
| Stored in transformed form by design (redaction), not byte-comparable | 4 |
| Stale content served as fresh | 0 |

On this snapshot the failure class v1.1.2 closes produced 0 incidents: it is closed
structurally, not statistically.

Cost: no extra I/O on the serve path - `ctime` rides the existing `stat()` call
(24 µs per file measured on this snapshot). The one-time upgrade of pre-1.1.2 blobs
reads each file once.

Reproduce from the repository:

```
node tools/freshness-replay.mjs . A   # same session (store warm)
node tools/freshness-replay.mjs . B   # new session (store cold)
```

---

## Compression baseline (v1.1.2)

Bundled realistic corpus, measured through the real pipeline (the same code path a live
session uses), no network:

| Category | Raw output | Compressed | Gain |
|---|---|---|---|
| API JSON | 7,622 chars | 704 chars | -90.8% |
| Grep results | 5,922 chars | 2,450 chars | -58.6% |
| Build log | 7,353 chars | 1,493 chars | -79.7% |
| Stack trace | 4,762 chars | 3,206 chars | -32.7% |
| git status | 1,791 chars | 1,280 chars | -28.5% |
| Large text | 17,779 chars | 2,035 chars | -88.6% |
| French prose | 19,309 chars | 2,035 chars | -89.5% |
| **Total** | **64,538 chars** | **13,203 chars** | **-79.5%** |

Shell output above 6,000 chars is squashed to a header plus the first 2,000 chars,
which is why the two large fixtures land on the same size; the full original stays
recallable with its confidence score. Every compression ships only when strictly
smaller than the input.

Reproduce from the repository: `node bench/run.mjs`
