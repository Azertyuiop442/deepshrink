export interface CommitmentReport {
	total: number;
	preserved: number;
	missed: string[];
	byKind: Record<CommitmentKind, number>;
}

export type CommitmentKind = 'negation' | 'error' | 'url' | 'version' | 'hash' | 'path';

export interface CommitmentMeter {
	checks: number;
	atoms: number;
	preserved: number;
	missed: number;
	samples: Array<{ at: number; kind: string; item: string; tool?: string }>;
}

export const EMPTY_COMMITMENT_METER: CommitmentMeter = {
	checks: 0,
	atoms: 0,
	preserved: 0,
	missed: 0,
	samples: [],
};

const NEGATION_RE = /\b(?:ne|n|pas|jamais|aucun|aucune|sans|ni|non|not|no|never|without|cannot|can't|don't|doesn't|didn't|isn't|aren't|won't|wouldn't|shouldn't|couldn't|neither|nor|nunca|jamas|jamás|sin|tampoco|nicht|keine|keiner|keinen|nie|niemals|ohne)\b/gi;
const ERROR_LINE_RE = /(^|\n)([ \t]*(?:✗|×|not ok)[^\n]*|[^\n]*(?:\bERROR\b|ERR_|\bErrno\b|\bFAIL(?:ED|URE)?\b|\bpanic\b|Traceback \(most recent|Exception\b|\bfatal\b)[^\n]*)/g;
const URL_RE = /https?:\/\/[^\s<>"'\)\]]+/gi;
const VERSION_RE = /(?:\bv?\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b|\b[a-z][\w-]*@[\^~]?\d+(?:\.\d+){1,2}\b)/gi;
const HASH_RE = /\b(?:0x[a-f0-9]+|[a-f0-9]{10,64})\b/g;
const PATH_RE = /(?:\/[\w.@%+-]+){2,}\/?|\b[\w.-]+\/[\w./-]+\.[a-z0-9]{1,6}\b/gi;

const MAX_PER_KIND = 40;

function collect(text: string, re: RegExp, cap = MAX_PER_KIND): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(re)) {
		const value = m[0].trim();
		if (value.length < (re === URL_RE ? 8 : 4)) continue;
		out.push(value);
		if (out.length >= cap) break;
	}
	return out;
}

function normalization(text: string): string {
	return text.replace(/\s+/g, ' ');
}

export function countNegations(text: string): number {
	return text.match(NEGATION_RE)?.length ?? 0;
}

export function extractErrorLines(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(ERROR_LINE_RE)) {
		const line = m[2]?.trim();
		if (!line || line.length < 4) continue;
		out.push(line);
		if (out.length >= MAX_PER_KIND) break;
	}
	return out;
}

export function compareCommitments(original: string, compressed: string): CommitmentReport {
	const byKind: Record<CommitmentKind, number> = { negation: 0, error: 0, url: 0, version: 0, hash: 0, path: 0 };
	const missed: string[] = [];
	let total = 0;
	let preserved = 0;

	const normCompressed = normalization(compressed);
	const negIn = countNegations(original);
	const negOut = countNegations(compressed);
	byKind.negation = negIn;
	total += negIn;
	preserved += Math.min(negIn, negOut);
	if (negOut < negIn) missed.push(`negation: ${negIn} attendues, ${negOut} presentes`);

	const errors = extractErrorLines(original);
	byKind.error = errors.length;
	for (const line of errors) {
		total++;
		if (normCompressed.includes(normalization(line))) preserved++;
		else missed.push(`error: ${line.slice(0, 80)}`);
	}

	const checks: Array<[CommitmentKind, string[]]> = [
		['url', collect(original, URL_RE)],
		['version', collect(original, VERSION_RE)],
		['hash', collect(original, HASH_RE)],
		['path', collect(original, PATH_RE)],
	];
	for (const [kind, values] of checks) {
		const unique = [...new Set(values)];
		byKind[kind] = unique.length;
		for (const value of unique) {
			total++;
			if (compressed.includes(value)) preserved++;
			else missed.push(`${kind}: ${value}`);
		}
	}

	return {
		total,
		preserved,
		missed: missed.slice(0, MAX_PER_KIND),
		byKind,
	};
}

export function recordCommitments(meter: CommitmentMeter, report: CommitmentReport, tool?: string, at = Date.now()): void {
	if (report.total === 0) return;
	meter.checks += 1;
	meter.atoms += report.total;
	meter.preserved += report.preserved;
	meter.missed += report.missed.length;
	for (const item of report.missed.slice(0, 3)) {
		meter.samples.push({ at, kind: item.split(':')[0], item: item.slice(0, 120), tool });
	}
	while (meter.samples.length > 20) meter.samples.shift();
}
