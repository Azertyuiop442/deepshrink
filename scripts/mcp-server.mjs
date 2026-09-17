import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { extractSymbol } from "../core/symbol.ts";

const DEFAULT_DIR = join(homedir(), ".commandcode", "mods", "deepshrink", "data", "deepshrink");
const DATA_DIR = process.env.DEEPSHRINK_DATA_DIR || DEFAULT_DIR;
const WORKSPACE = process.env.DEEPSHRINK_WORKSPACE || process.cwd();
const SNIPPET_CHARS = 2000;
const FULL_CHARS = 24000;
const SERVER_VERSION = "1.0.0";

function log(msg) {
	process.stderr.write(`[deepskrin-mcp] ${msg}\n`);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function loadStore() {
	const index = readJson(join(DATA_DIR, "index.json"));
	const blobs = Array.isArray(index?.blobs) ? index.blobs : [];
	return blobs.filter((b) => b && typeof b.hash === "string");
}

const contentCache = new Map();

function blobContent(hash) {
	if (contentCache.has(hash)) return contentCache.get(hash);
	let content;
	try {
		content = readFileSync(join(DATA_DIR, "blobs", hash), "utf8");
	} catch {
		content = undefined;
	}
	contentCache.set(hash, content);
	return content;
}

function freshness(meta) {
	const path = meta.realPath ?? meta.filePath;
	if (!path || meta.fileMtime === undefined || meta.fileSize === undefined) {
		return { stale: false, path, reason: "" };
	}
	try {
		const st = statSync(path);
		if (st.mtimeMs !== meta.fileMtime || st.size !== meta.fileSize) {
			return { stale: true, path, reason: "file modified - re-read the source" };
		}
	} catch {
		return { stale: true, path, reason: "file missing" };
	}
	return { stale: false, path, reason: "" };
}

function snippetAround(content, pattern) {
	const idx = content.search(pattern);
	if (idx < 0) return content.slice(0, SNIPPET_CHARS);
	const start = Math.max(0, idx - Math.floor(SNIPPET_CHARS / 3));
	const end = Math.min(content.length, start + SNIPPET_CHARS);
	return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

function recall(input) {
	const query = typeof input.query === "string" ? input.query : "";
	const limit = typeof input.limit === "number" ? Math.min(10, Math.max(1, input.limit)) : 5;
	const fullContent = input.fullContent === true;
	if (!query) return "deepshrink_recall: empty query.";
	let pattern;
	try {
		pattern = new RegExp(query, "i");
	} catch {
		pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	}
	const hits = [];
	const staleHints = [];
	for (const meta of loadStore()) {
		if (meta.workspace && meta.workspace !== WORKSPACE) continue;
		const content = blobContent(meta.hash);
		if (content === undefined || !pattern.test(content)) continue;
		const fresh = freshness(meta);
		const ref = `[blob:${meta.hash.slice(0, 12)}:${content.length}]`;
		if (fresh.stale) {
			staleHints.push(`${ref} ${fresh.path ?? ""} — STALE (${fresh.reason})`);
			continue;
		}
		const usable = fullContent && content.length <= FULL_CHARS;
		hits.push({
			ref,
			path: fresh.path ?? "",
			lastRef: meta.lastRef ?? meta.createdAt ?? 0,
			text: usable ? content : snippetAround(content, pattern),
		});
	}
	hits.sort((a, b) => b.lastRef - a.lastRef);
	const out = hits.slice(0, limit);
	const lines = [`${out.length} match(es) (store: ${DATA_DIR}).`];
	for (const h of out) lines.push(`${h.ref}${h.path ? ` ${h.path}` : ""}\n${h.text}`);
	for (const s of staleHints.slice(0, 10)) lines.push(s);
	return lines.join("\n\n");
}

function symbol(input) {
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (!name) return "deepshrink_symbol: name is required.";
	const pathFilter = typeof input.path === "string" && input.path.length > 0 ? input.path : undefined;
	const limit = typeof input.limit === "number" ? Math.min(5, Math.max(1, input.limit)) : 1;
	const hits = [];
	const staleHints = [];
	for (const meta of loadStore()) {
		if (meta.workspace && meta.workspace !== WORKSPACE) continue;
		const path = meta.realPath ?? meta.filePath ?? "";
		if (pathFilter && !path.includes(pathFilter)) continue;
		const content = blobContent(meta.hash);
		if (content === undefined || !content.includes(name)) continue;
		const fresh = freshness(meta);
		const ref = `[blob:${meta.hash.slice(0, 12)}:${content.length}]`;
		if (fresh.stale) {
			staleHints.push(`${ref} ${path} — STALE (${fresh.reason})`);
			continue;
		}
		const m = extractSymbol(content, name);
		if (!m) continue;
		if (hits.length >= limit) break;
		hits.push(`${ref} ${path} L${m.startLine}-${m.endLine} (${m.kind})\n${m.text}`);
	}
	if (hits.length === 0) {
		const extra = staleHints.length > 0 ? `\n${staleHints.slice(0, 5).join("\n")}` : "";
		return `No definition of "${name}" in the store.${extra}\nFall back to grep or read_file.`;
	}
	return `${hits.length} definition(s).\n\n${hits.join("\n\n---\n\n")}`;
}

const TOOLS = [
	{
		name: "deepshrink_recall",
		description:
			"Search a local, read-only cache of tool outputs (file reads, greps, commands) shared across agents on this machine. Call it before re-reading or re-running something. Returns snippets with a confidence ref; STALE hits are never served as content.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "regex matched against stored outputs (case-insensitive)" },
				limit: { type: "number", description: "max hits (default 5, max 10)" },
				fullContent: { type: "boolean", description: "return the whole stored blob when it is small (<= 24K chars)" },
			},
			required: ["query"],
		},
	},
	{
		name: "deepshrink_symbol",
		description:
			"Fetch one named definition (function, class, struct, ...) with its body and line range from the same local store, instead of reading or grepping whole files. Files that changed on disk are reported as stale, never served.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "exact symbol name" },
				path: { type: "string", description: "optional path substring filter" },
				limit: { type: "number", description: "max definitions (default 1, max 5)" },
			},
			required: ["name"],
		},
	},
];

function respond(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handle(msg) {
	const id = msg.id;
	const method = msg.method;
	if (method === "initialize") {
		respond(id, {
			protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "deepskrin-store", version: SERVER_VERSION },
		});
		return;
	}
	if (method === "notifications/initialized" || id === undefined) return;
	if (method === "ping") {
		respond(id, {});
		return;
	}
	if (method === "tools/list") {
		respond(id, { tools: TOOLS });
		return;
	}
	if (method === "tools/call") {
		const name = msg.params?.name;
		const args = msg.params?.arguments ?? {};
		try {
			if (name === "deepshrink_recall") {
				respond(id, { content: [{ type: "text", text: recall(args) }] });
				return;
			}
			if (name === "deepshrink_symbol") {
				respond(id, { content: [{ type: "text", text: symbol(args) }] });
				return;
			}
			respondError(id, -32602, `unknown tool: ${String(name)}`);
		} catch (err) {
			respondError(id, -32603, `tool failed: ${String(err?.message ?? err)}`);
		}
		return;
	}
	respondError(id, -32601, `method not found: ${String(method)}`);
}

function main() {
	if (!existsSync(DATA_DIR)) log(`data dir not found: ${DATA_DIR} (tools will report empty results)`);
	log(`serving ${DATA_DIR} for workspace ${WORKSPACE}`);
	const rl = createInterface({ input: process.stdin });
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg;
		try {
			msg = JSON.parse(trimmed);
		} catch {
			log("ignoring non-JSON line");
			return;
		}
		try {
			handle(msg);
		} catch (err) {
			if (msg && msg.id !== undefined) respondError(msg.id, -32603, String(err?.message ?? err));
		}
	});
}

main();
