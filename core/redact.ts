



const awsAccessKeyRE = /A(?:KIA|SIA)[0-9A-Z]{16}/;
const awsSecretRE = /\b(aws[_-]?secret[_-]?access[_-]?key)(\s*['"]?\s*[:=]\s*)(['"]?)([A-Za-z0-9/+=_-]{32,})(['"]?)/i;
const genericKVRE = /\b([\w.-]{0,64}?(?:api[_-]?key|secret[_-]?key|secret|token|passwd|password|authorization))(\s*['"]?\s*[:=]\s*)(['"]?)([A-Za-z0-9/+=._!@#$%^&*~-]{16,})(['"]?)/i;
const bearerRE = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{16,})/i;
const pemPrivateRE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/;
const providerRE = /\b(gh[opsur]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]*[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|xox[bpcs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/;
const jwtRE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/;
const connURLRE = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s/@:]*):([^\s]+)@([^\s]+)/;

const KV_HINTS = ['key', 'secret', 'token', 'passw', 'authorization'];
const PROVIDER_HINTS = ['gh', 'github_pat_', 'glpat-', 'sk_', 'rk_', 'sk-', 'gsk_', 'xai-', 'hf_', 'npm_', 'xox', 'AIza'];

export interface RedactResult {
	text: string;
	counts: Record<string, number>;
}


export function kvAssignmentNearby(lower: string): boolean {
	for (const hint of KV_HINTS) {
		let at = 0;
		while (true) {
			const i = lower.indexOf(hint, at);
			if (i < 0) break;
			
			let pos = i + hint.length;
			while (pos < lower.length && /[a-z0-9_-]/.test(lower[pos])) pos++;
			
			const window = lower.slice(pos, pos + 6);
			if (/^['"]?\s*[:=]/.test(window)) return true;
			at = i + 1;
		}
	}
	return false;
}

function containsAnyFold(s: string, hints: string[]): boolean {
	const lower = s.toLowerCase();
	return hints.some(h => lower.includes(h.toLowerCase()));
}

function shannonBits(s: string): number {
	const counts = new Map<string, number>();
	for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	let h = 0;
	const n = s.length;
	for (const c of counts.values()) {
		const p = c / n;
		h -= p * Math.log2(p);
	}
	return h;
}

function charClasses(s: string): number {
	let cls = 0;
	if (/[a-z]/.test(s)) cls++;
	if (/[A-Z]/.test(s)) cls++;
	if (/[0-9]/.test(s)) cls++;
	if (/[^a-zA-Z0-9]/.test(s)) cls++;
	return cls;
}

function isHexish(s: string): boolean {
	return /^[0-9a-fA-F]+$/.test(s);
}

function entropyCandidate(tok: string): boolean {
	if (tok.length > 256 || isHexish(tok) || charClasses(tok) < 3) return false;
	if (tok.includes('/') && tok.toLowerCase() === tok) return false;
	return shannonBits(tok) >= 4.5;
}

function assignmentValueNearby(s: string, idx: number, len: number): boolean {
	
	const before = s.slice(Math.max(0, idx - 80), idx);
	const m = /([A-Za-z0-9_.-]{3,})\s*['"]?\s*[:=]\s*$/.exec(before);
	if (m) return !/^(the|and|or|for|to|on|in|of|is|are|was|were)$/i.test(m[1]);
	return false;
}

function standaloneLine(s: string, lineStart: number, lineEnd: number, tokStart: number, tokEnd: number): boolean {
	const before = s.slice(lineStart, tokStart).trim();
	const after = s.slice(tokEnd, lineEnd).trim();
	return before === '' && after === '';
}


function entropyPass(text: string): { text: string; count: number } {
	const lines = text.split('\n');
	let count = 0;
	const tokenRE = /[A-Za-z0-9+/_-]{20,}={0,2}/g;
	const out = lines.map((line, li) => {
		
		const lineStartAbs = text.split('\n').slice(0, li).join('\n').length + (li > 0 ? 1 : 0);
		const lineEndAbs = lineStartAbs + line.length;
		let replaced = line;
		let m: RegExpExecArray | null;
		tokenRE.lastIndex = 0;
		while ((m = tokenRE.exec(line)) !== null) {
			const tok = m[0];
			if (tok.length < 20) continue;
			if (!entropyCandidate(tok)) continue;
			const absStart = lineStartAbs + m.index;
			const absEnd = absStart + tok.length;
			if (!assignmentValueNearby(text, absStart, tok.length) && !standaloneLine(text, lineStartAbs, lineEndAbs, absStart, absEnd)) continue;
			replaced = replaced.slice(0, m.index) + '[redacted:entropy]' + replaced.slice(m.index + tok.length);
			count++;
			tokenRE.lastIndex = m.index + '[redacted:entropy]'.length;
		}
		return replaced;
	});
	return { text: out.join('\n'), count };
}





export function redact(input: string): RedactResult {
	if (!input || input.length === 0) return { text: input, counts: {} };
	const counts: Record<string, number> = {};
	let text = input;

	const replaceAll = (re: RegExp, kind: string): void => {
		let m: RegExpExecArray | null;
		const fresh = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
		let n = 0;
		while ((m = fresh.exec(text)) !== null) {
			const full = m[0];
			text = text.slice(0, m.index) + `[redacted:${kind}]` + text.slice(m.index + full.length);
			fresh.lastIndex = m.index + `[redacted:${kind}]`.length;
			n++;
		}
		if (n > 0) counts[kind] = (counts[kind] ?? 0) + n;
	};

	const lower = text.toLowerCase();
	if (pemPrivateRE.test(text)) replaceAll(pemPrivateRE, 'pem');
	if (connURLRE.test(text)) replaceAll(connURLRE, 'conn-url');
	if (awsSecretRE.test(text)) replaceAll(awsSecretRE, 'aws-secret');
	if (awsAccessKeyRE.test(text)) replaceAll(awsAccessKeyRE, 'aws-access-key');
	if (/\bbearer\b|\bbasic\b/i.test(text) && bearerRE.test(text)) replaceAll(bearerRE, 'bearer');
	if (jwtRE.test(text)) replaceAll(jwtRE, 'jwt');
	if (kvAssignmentNearby(lower)) replaceAll(genericKVRE, 'kv');
	if (containsAnyFold(text, PROVIDER_HINTS)) replaceAll(providerRE, 'provider');
	const entropy = entropyPass(text);
	if (entropy.count > 0) {
		text = entropy.text;
		counts.entropy = (counts.entropy ?? 0) + entropy.count;
	}
	return { text, counts };
}


export function hasSecrets(input: string): boolean {
	const lower = input.toLowerCase();
	return pemPrivateRE.test(input) || connURLRE.test(input) || awsSecretRE.test(input)
		|| awsAccessKeyRE.test(input) || /\bbearer\b|\bbasic\b/i.test(input) || jwtRE.test(input)
		|| kvAssignmentNearby(lower) || containsAnyFold(input, PROVIDER_HINTS);
}
