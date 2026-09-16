import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Executor } from "../runtime/executor.ts";
import { ConfigStore } from "../runtime/config-store.ts";
import { EventLog } from "../runtime/log.ts";
import { DiskStore, SessionRegistry } from "../runtime/store.ts";

function buildCorpus() {
	const orders = Array.from({ length: 40 }, (_, i) => ({
		id: 1000 + i,
		customer: `customer_${i}@example.com`,
		status: i % 3 === 0 ? "shipped" : "pending",
		total: (i * 13.37).toFixed(2),
		created_at: `2026-09-${String((i % 27) + 1).padStart(2, "0")}T10:00:00Z`,
		items: (i % 4) + 1,
	}));

	const grepOut =
		Array.from(
			{ length: 70 },
			(_, i) => `src/module_${i % 12}/file_${i}.ts:${10 + i}:  // TODO(#${100 + i}): handle the retry path for the ${i % 5 === 0 ? "uploader" : "downloader"}`,
		).join("\n") + "\n";

	const buildLog =
		Array.from({ length: 90 }, (_, i) => `webpack 5.91.0 compiled ${i % 3 === 0 ? "successfully" : "with warnings"} in ${1200 + i * 7} ms`).join("\n") +
		"\nWARN in ./src/index.ts\n" +
		Array.from({ length: 40 }, (_, i) => `  package_${i}: 1.2.${i} requires a peer of react@^18 but none is installed`).join("\n") +
		"\nERROR in ./src/broken.ts:12:5\n  TS2322: Type 'string' is not assignable to type 'number'.\n";

	const stack =
		"TypeError: Cannot read properties of undefined (reading 'pane')\n    at renderPane (/app/src/ui/pane.ts:412:18)\n" +
		Array.from({ length: 110 }, (_, i) => `    at node_modules/dep_${i}/index.js:${10 + i}:9`).join("\n") +
		"\n    at handleRequest (/app/src/server.ts:88:7)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)\n";

	const gitStatus =
		"On branch main\nYour branch is up to date with 'origin/main'.\n\nChanges not staged for commit:\n" +
		Array.from({ length: 35 }, (_, i) => `\tmodified:   src/features/feature_${i}/index.ts`).join("\n") +
		"\n\nUntracked files:\n" +
		Array.from({ length: 8 }, (_, i) => `\tnew_${i}.ts`).join("\n") +
		"\n";

	const largeText = Array.from(
		{ length: 120 },
		(_, i) =>
			`Segment ${i}: the pipeline writes ${i} records to the staging table and verifies the checksum 0x${(0xabcdef00 + i).toString(16)} against the manifest v2.${i % 9}.0 before publishing.`,
	).join("\n");

	const prose = Array.from(
		{ length: 60 },
		(_, i) =>
			`La réunion numéro ${i} a permis de valider le plan de migration. Il ne faut pas oublier de sauvegarder les données avant la bascule, et il est important de prévenir les équipes en amont. Le budget reste stable pour ce trimestre, mais nous devons surveiller la latence du service principal pendant le déploiement progressif.`,
	).join(" ");

	return [
		{ name: "api-json", tool: "shell_command", input: { command: "curl -s https://api.example.com/orders?page=1" }, content: JSON.stringify({ orders, page: 1, total: 812, next: "/api/orders?page=2" }, null, 2) },
		{ name: "grep", tool: "grep", input: { pattern: "TODO", path: "src" }, content: grepOut },
		{ name: "build-log", tool: "shell_command", input: { command: "npm run build" }, content: buildLog },
		{ name: "stack-trace", tool: "shell_command", input: { command: "node dist/server.js" }, content: stack },
		{ name: "git-status", tool: "shell_command", input: { command: "git status --porcelain=v1" }, content: gitStatus },
		{ name: "large-text", tool: "shell_command", input: { command: "./scripts/report.sh" }, content: largeText },
		{ name: "prose-fr", tool: "shell_command", input: { command: "./scripts/summary.sh" }, content: prose },
	];
}

export async function runBench() {
	const dir = mkdtempSync(join(tmpdir(), "deepskrin-bench-"));
	try {
		const exec = new Executor(
			{
				dir,
				configStore: new ConfigStore(dir),
				createLog: (sid, level) => new EventLog(`${dir}/events`, sid, level),
				store: new DiskStore(dir),
				registry: new SessionRegistry(`${dir}/sessions.json`),
			},
			{ sessionId: "bench" },
		);
		await exec.init();
		await exec.setEnabled(true);
		const items = [];
		for (const item of buildCorpus()) {
			const res = await exec.afterToolCall({ toolName: item.tool, input: item.input, content: item.content });
			const served = res?.content?.[0]?.text ?? item.content;
			items.push({
				name: item.name,
				before: item.content.length,
				after: served.length,
				pct: Math.round(1000 * (1 - served.length / item.content.length)) / 10,
			});
		}
		const totalBefore = items.reduce((a, i) => a + i.before, 0);
		const totalAfter = items.reduce((a, i) => a + i.after, 0);
		const totalPct = Math.round(1000 * (1 - totalAfter / totalBefore)) / 10;
		return { items, totalBefore, totalAfter, totalPct };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
	const r = await runBench();
	console.log("DeepSkrin compression bench (bundled corpus, real pipeline)\n");
	for (const it of r.items) {
		console.log(`  ${it.name.padEnd(12)} ${String(it.before).padStart(7)} -> ${String(it.after).padStart(7)} chars  (-${it.pct}%)`);
	}
	console.log(`\n  TOTAL        ${String(r.totalBefore).padStart(7)} -> ${String(r.totalAfter).padStart(7)} chars  (-${r.totalPct}%)`);
}
