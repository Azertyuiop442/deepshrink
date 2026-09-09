


export interface ActiveFileEntry {
	path: string;
	mentionedAt: number;
}


export function extractFilePaths(text: string): string[] {
	const out = new Set<string>();
	
	const tickRe = /[`'"]([^`'"]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|json|md|css|html|sh|mjs|vue|svelte|toml|yaml|yml))[`'"]/g;
	let m: RegExpExecArray | null;
	while ((m = tickRe.exec(text)) !== null) out.add(m[1]);
	
	const bareRe = /(?:^|[\s,])((?:\.{0,2}\/|~\/|\/|(?:[A-Za-z0-9_-]+\/)+)[^\s`'"<>|&;()]{0,120}\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|json|md|css|html|sh|vue|svelte|toml|yaml|yml))/g;
	while ((m = bareRe.exec(text)) !== null) out.add(m[1].trim());
	
	const hostRe = /(?:^|[\s,])(\/(?:etc|usr|var|opt|bin|sbin|lib|dev)\/[A-Za-z0-9_.\/-]+)/g;
	while ((m = hostRe.exec(text)) !== null) out.add(m[1].trim());
	return [...out];
}

export interface ActiveFilesState {
	entries: Map<string, ActiveFileEntry>;
	ttlMs: number;
}

export function newActiveFiles(ttlMs: number): ActiveFilesState {
	return { entries: new Map(), ttlMs };
}


export function updateActiveFiles(state: ActiveFilesState, userText: string, now = Date.now()): string[] {
	for (const p of extractFilePaths(userText)) state.entries.set(p, { path: p, mentionedAt: now });
	
	for (const [p, e] of state.entries) {
		if (now - e.mentionedAt > state.ttlMs) state.entries.delete(p);
	}
	return [...state.entries.keys()];
}

export function isActiveFile(state: ActiveFilesState, path: string, now = Date.now()): boolean {
	const e = state.entries.get(path);
	if (!e) return false;
	return now - e.mentionedAt <= state.ttlMs;
}
