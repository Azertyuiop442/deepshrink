# Changelog

Notable changes per release, following semantic versioning.

## [1.1.2] - 2026-10-14

### Changed

- Freshness proof strengthened: `read_file` blobs are re-verified by `mtime + size + ctime` at serve time. The kernel `ctime` cannot be set from userland, so a restored `mtime` no longer passes as fresh.
- Blobs ingested before 1.1.2 are re-verified against the file on first access (served as a delta when small), then upgraded with the full proof.

### Added

- `tools/freshness-replay.mjs` - replays the on-disk store through a given build and reports intact / modified / deleted file classes.
- `tools/freshness-audit.mjs` - audits a store snapshot: file-eligible blobs, filesystem state, agreement under the previous proof, divergent content.
- `STATS.md` - public measurement log: protocol, data snapshot, per-version before/after tables, reproduce commands.
- `adapters/antigravity/` - self-contained Antigravity plugin (manifest, agent skill, MCP server) sharing the same store and freshness proof.
