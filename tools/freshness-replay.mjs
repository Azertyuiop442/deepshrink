import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function resolveDataDir() {
	if (process.env.DEEPSHRINK_DATA_DIR) return process.env.DEEPSHRINK_DATA_DIR;
	const neutral = join(homedir(), ".deepshrink");
	if (existsSync(neutral)) return neutral;
	return join(homedir(), ".commandcode", "mods", "deepshrink", "data", "deepshrink");
}

export function usageText() {
	return [
		"DeepShrink freshness replay - serves the real on-disk store through a given mod build.",
		"",
		"usage: node tools/freshness-replay.mjs <modDir> [A|B] [out.json]",
		"",
		"  <modDir>   mod build to exercise ('.' = working tree; HEAD snapshot via git archive)",
		"  A          same-session: blobs of the served path are marked served and preloaded",
		"  B          new-session: fresh executor, no preload (default)",
		"  out.json   write per-path results (paths included: keep out of the repo)",
		"",
		"  data dir   $DEEPSHRINK_DATA_DIR || ~/.deepshrink || mod default",
		"",
		"One toolHit per unique file path on the initial state (sibling blobs are only",
		"preloaded, never re-served): re-runs after a heal would measure the healed blob,",
		"not the migration.",
	].join("\n");
}

export async function replay(modDir, scenario = "B", dataDir = resolveDataDir()) {
	const mod = resolve(modDir);
	const { Executor } = await import(pathToFileURL(join(mod, "runtime/executor.ts")).href);
	const { ConfigStore } = await import(pathToFileURL(join(mod, "runtime/config-store.ts")).href);
	const { EventLog } = await import(pathToFileURL(join(mod, "runtime/log.ts")).href);
	const { DiskStore, SessionRegistry } = await import(pathToFileURL(join(mod, "runtime/store.ts")).href);

	const idx = JSON.parse(readFileSync(join(dataDir, "index.json"), "utf-8"));
	const blobs = Object.values(idx.blobs).filter((b) => b.filePath && b.fileMtime !== undefined && b.fileSize !== undefined);

	const groups = new Map();
	for (const b of blobs) {
		const ws = b.workspace ?? "";
		if (!groups.has(ws)) groups.set(ws, new Map());
		const g = groups.get(ws);
		const p = b.realPath ?? b.filePath;
		if (!g.has(p)) g.set(p, []);
		g.get(p).push(b);
	}

	const results = {};
	for (const [ws, pathsMap] of groups) {
		const dir = mkdtempSync(join(tmpdir(), "ds-replay-"));
		cpSync(join(dataDir, "index.json"), join(dir, "index.json"));
		cpSync(join(dataDir, "blobs"), join(dir, "blobs"), { recursive: true });
		const exec = new Executor(
			{
				dir,
				configStore: new ConfigStore(dir),
				createLog: (sid, level) => new EventLog(`${dir}/events`, sid, level),
				store: new DiskStore(dir),
				registry: new SessionRegistry(`${dir}/sessions.json`),
				host: { notify: () => {}, showEntry: () => {}, select: async () => null },
			},
			{ sessionId: `replay-${scenario}`, workspace: ws || process.cwd() },
		);
		await exec.init();
		await exec.setEnabled(true);

		for (const [p, siblings] of pathsMap) {
			let st = null;
			try {
				st = statSync(p);
			} catch {}
			const metaMatch = st !== null && siblings.some((b) => st.mtimeMs === b.fileMtime && st.size === b.fileSize);
			if (scenario === "A") {
				for (const b of siblings) {
					exec.markServed(b.hash);
					try {
						exec.blobContents.set(b.hash, readFileSync(join(dataDir, "blobs", b.hash), "utf-8"));
					} catch {}
				}
			}
			let hit;
			let error;
			try {
				hit = await exec.toolHit("read_file", { file_path: p });
			} catch (e) {
				error = String(e);
			}
			results[p] = {
				path: p,
				siblings: siblings.length,
				metaMatch,
				outcome: error ? "error" : hit === undefined ? "not-served" : hit.deltaServe ? "delta" : "serve",
				servedBytes: hit ? hit.content.length : 0,
				error,
			};
		}
		rmSync(dir, { recursive: true, force: true });
	}

	const classes = { intact: [], modified: [], deleted: [] };
	for (const r of Object.values(results)) {
		if (r.metaMatch) classes.intact.push(r);
		else {
			try {
				statSync(r.path);
				classes.modified.push(r);
			} catch {
				classes.deleted.push(r);
			}
		}
	}
	const aggClass = (rs) => {
		const o = { n: rs.length, serve: 0, serveBytes: 0, delta: 0, deltaBytes: 0, notServed: 0, error: 0 };
		for (const r of rs) {
			if (r.outcome === "serve") { o.serve++; o.serveBytes += r.servedBytes; }
			else if (r.outcome === "delta") { o.delta++; o.deltaBytes += r.servedBytes; }
			else if (r.outcome === "not-served") o.notServed++;
			else o.error++;
		}
		return o;
	};
	const agg = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, aggClass(v)]));
	const totals = aggClass(Object.values(results));
	return { mod: modDir, scenario, dataDir, agg, totals, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const modDir = process.argv[2];
	if (!modDir || modDir === "--help" || modDir === "-h") {
		console.log(usageText());
		process.exit(modDir ? 0 : 2);
	}
	const scenario = process.argv[3] ?? "B";
	const out = process.argv[4];
	const r = await replay(modDir, scenario);
	console.log(`freshness-replay: ${r.mod} scenario ${scenario}`);
	console.log(`  paths ${r.totals.n} (intact ${r.agg.intact.n}, modified ${r.agg.modified.n}, deleted ${r.agg.deleted.n})`);
	for (const [k, a] of Object.entries(r.agg)) {
		console.log(`  ${k.padEnd(8)} serve ${a.serve} (${a.serveBytes}), delta ${a.delta} (${a.deltaBytes}), not-served ${a.notServed}, error ${a.error}`);
	}
	console.log(`  totals   serve ${r.totals.serve} (${r.totals.serveBytes}), delta ${r.totals.delta} (${r.totals.deltaBytes}), not-served ${r.totals.notServed}`);
	if (out) {
		writeFileSync(out, JSON.stringify(r, null, 1));
		console.log(`  results -> ${out}`);
	}
}
