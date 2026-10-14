import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const DATA = process.env.DEEPSHRINK_DATA_DIR || join(homedir(), ".deepshrink");

const sha = (s) => createHash("sha256").update(s).digest("hex");
const rtrim = (t) => t.replace(/\n+$/, "");

function lineVerified(stored, raw) {
	let s = stored.replace(/<repair_note>[\s\S]*?<\/repair_note>\n/, "");
	s = s.replace(/^Read \d+\/\d+ files?, \d+ lines\n/, "");
	s = s.replace(/^Note: showing lines[^\n]*\n/, "");
	s = s.replace(/^Read \d+\/\d+ files\n/, "");
	s = s.replace(/^--- File Contents ---\n?/, "");
	if (s.trim() === "") return { verdict: "non-comparable" };
	const rawLines = raw.split("\n");
	let checkable = 0;
	let verified = 0;
	let failures = 0;
	let redactedFailures = 0;
	for (const l of s.split("\n")) {
		if (l === "" || l.startsWith("… [output truncated")) continue;
		const m = l.match(/^(\d{1,9}): ([\s\S]*)$/);
		if (!m) return { verdict: "non-comparable" };
		checkable++;
		const n = Number(m[1]);
		const body = m[2];
		const rawLine = (rawLines[n - 1] ?? "\u0000").replace(/\r$/, "");
		const trunc = body.match(/… \[\d+ chars truncated\]$/);
		const ok = trunc ? rawLine.startsWith(body.slice(0, body.length - trunc[0].length)) : body === rawLine;
		if (ok) verified++;
		else {
			failures++;
			if (body.includes("[redacted:")) redactedFailures++;
		}
		if (failures > 2) break;
	}
	if (checkable === 0) return { verdict: "non-comparable" };
	const nonEmpty = rtrim(raw) === "" ? 0 : rtrim(raw).split("\n").length;
	if (failures > 0) {
		return { verdict: failures === redactedFailures ? "transform-redacted" : "divergent" };
	}
	return { verdict: checkable < nonEmpty ? "window-identical" : "identical" };
}

function classify(stored, raw, b) {
	if (stored === raw || b.hash === sha(raw)) return "identical";
	if (stored.startsWith("Read image ") || stored.startsWith("Read 0/0 files")) return "non-comparable";
	return lineVerified(stored, raw).verdict;
}

function audit() {
	const idx = JSON.parse(readFileSync(join(DATA, "index.json"), "utf-8"));
	const blobs = Object.values(idx.blobs);
	const fileBlobs = blobs.filter((b) => b.filePath && b.fileMtime !== undefined && b.fileSize !== undefined);
	const v = { total: blobs.length, fileEligible: fileBlobs.length, fileDeleted: 0, fileChanged: 0, freshOldContract: 0, identical: 0, windowIdentical: 0, nonComparable: 0, redacted: 0, divergent: 0, divergentChars: 0, withCtime: 0, divergentExamples: [] };
	let statNs = 0n;
	let hashNs = 0n;
	let hashedBytes = 0;
	for (const b of fileBlobs) {
		const p = b.realPath ?? b.filePath;
		let st;
		const t0 = process.hrtime.bigint();
		try {
			st = statSync(p);
		} catch {
			v.fileDeleted++;
			continue;
		}
		statNs += process.hrtime.bigint() - t0;
		if (st.mtimeMs !== b.fileMtime || st.size !== b.fileSize) {
			v.fileChanged++;
			continue;
		}
		v.freshOldContract++;
		if (b.fileCtime !== undefined) v.withCtime++;
		let raw;
		try {
			raw = readFileSync(p, "utf-8");
		} catch {
			v.fileDeleted++;
			continue;
		}
		const t1 = process.hrtime.bigint();
		const h = sha(raw);
		hashNs += process.hrtime.bigint() - t1;
		hashedBytes += Buffer.byteLength(raw);
		let stored;
		try {
			stored = readFileSync(join(DATA, "blobs", b.hash), "utf-8");
		} catch {
			v.nonComparable++;
			continue;
		}
		const cls = classify(stored, raw, b);
		if (cls === "identical" || h === b.hash) v.identical++;
		else if (cls === "window-identical") v.windowIdentical++;
		else if (cls === "non-comparable") v.nonComparable++;
		else if (cls === "transform-redacted") v.redacted++;
		else {
			v.divergent++;
			v.divergentChars += Buffer.byteLength(raw);
			if (v.divergentExamples.length < 14) v.divergentExamples.push({ path: p, size: b.size, created: b.createdAt });
		}
	}
	v.statUs = v.fileEligible ? Number(statNs) / v.fileEligible / 1e3 : 0;
	v.hashUs = v.fileEligible ? Number(hashNs) / v.fileEligible / 1e3 : 0;
	v.hashedMb = hashedBytes / 1048576;
	return v;
}

export function report(v) {
	const lines = [];
	lines.push(`freshness-audit: ${v.total} blobs, ${v.fileEligible} file-eligible (filePath + mtime + size)`);
	lines.push("");
	lines.push(`  deleted                ${v.fileDeleted}`);
	lines.push(`  changed under both     ${v.fileChanged}`);
	lines.push(`  fresh (old contract)   ${v.freshOldContract}   <- mtime+size say fresh`);
	lines.push(`    identical            ${v.identical}`);
	lines.push(`    window-identical     ${v.windowIdentical}`);
	lines.push(`    non-comparable       ${v.nonComparable}`);
	lines.push(`    transform-redacted   ${v.redacted}`);
	lines.push(`    divergent            ${v.divergent}   <- stale served as fresh (content proof)`);
	lines.push(`    divergent bytes      ${v.divergentChars}`);
	lines.push(`    with ctime stored    ${v.withCtime}`);
	lines.push("");
	lines.push(`cost: stat ${v.statUs.toFixed(1)} us/blob, read+sha256 ${v.hashUs.toFixed(1)} us/blob (${v.hashedMb.toFixed(1)} MB)`);
	for (const e of v.divergentExamples) lines.push(`  divergent: ${String(e.size).padStart(7)}B ${e.path}`);
	return lines.join("\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
	console.log(report(audit()));
}
