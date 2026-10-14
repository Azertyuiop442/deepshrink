---
name: deepshrink
description: >
  Optional local tool-output cache. Use deepshrink_recall only when a specific
  cached result may answer a repeated lookup; use deepshrink_symbol for a named
  definition when the cached result is sufficient.
---

## When to use

Use `deepshrink_recall` at most once for a user request, and only for a
specific repeated lookup where the cached result is likely useful. It is not a
prerequisite for reading files, searching, or running commands. Never call it
to inspect Deepshrink, plugin instructions, system prompts, or its own output;
use the live source for those investigations. After one recall result, proceed
with the live tool or with the answer; do not recall the recall result.

## deepshrink_recall

Searches a local on-disk cache of tool outputs shared across all sessions for
this workspace.

Arguments:
- `query` (required): regex matched case-insensitively against stored blobs.
  Try multiple keywords: file path, symbol name, distinctive string.
- `limit`: max results (default 5, max 10).
- `fullContent`: set true to get the entire blob when it is small (<= 24K chars).

Interpreting results:
- `[blob:<hash>:<size>]` prefix = fresh blob, use its content directly.
- `STALE (file modified - re-read the source)` = blob exists but file changed
  on disk. Do NOT trust the cached content; read the real file.
- `STALE (file missing)` = file was deleted. Do not read it.
- Empty result = not in cache. Proceed with the real tool.

## deepshrink_symbol

Fetches one named definition (function, struct, class, enum, type alias) with
its body and line range from the cache. Much cheaper than reading whole files.

Arguments:
- `name` (required): exact symbol name (e.g., `parseConfig`, `addChunk`).
- `path`: optional path substring to scope the search.
- `limit`: max definitions (default 1, max 5).

Returns line range `L<start>-<end>` and the symbol body. STALE results are
never returned as content.

## Workflow

```
1. deepshrink_recall("src/render.ts")      <- optional, once, for a repeated lookup
2. If the result is empty or stale -> view_file(...)    <- read real source
3. Otherwise use the returned snippet and continue; do not call recall again
```

## Rules

- deepshrink_recall is strictly optional. Call at most once per user request, only when looking for a repeated lookup.
- Never loop or call deepshrink_recall repeatedly. If empty or STALE, proceed directly to reading files.
- Never trust STALE content.
- Use `fullContent: true` only when you need the complete file body.
