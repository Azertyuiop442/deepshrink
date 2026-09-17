export interface PlaybookEntry {
	path: string;
	ref?: string;
	helpful: number;
	harmful: number;
	lastAt: number;
	stale: boolean;
}

export interface PlaybookState {
	entries: PlaybookEntry[];
}

export function emptyPlaybook(): PlaybookState {
	return { entries: [] };
}

function sortEntries(entries: PlaybookEntry[]): PlaybookEntry[] {
	return [...entries].sort((a, b) => b.helpful - a.helpful || b.lastAt - a.lastAt || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function touchServe(state: PlaybookState, path: string, ref: string | undefined, now: number, cap: number): PlaybookState {
	if (!path) return state;
	const entries = state.entries.map((e) => ({ ...e }));
	const found = entries.find((e) => e.path === path);
	if (found) {
		found.helpful++;
		found.lastAt = now;
		found.stale = false;
		if (ref) found.ref = ref;
	} else {
		entries.push({ path, ref, helpful: 1, harmful: 0, lastAt: now, stale: false });
	}
	return { entries: sortEntries(entries).slice(0, Math.max(1, cap)) };
}

export function touchStale(state: PlaybookState, path: string, now: number): PlaybookState {
	if (!path) return state;
	const found = state.entries.find((e) => e.path === path);
	if (!found) return state;
	const entries = state.entries.map((e) => (e.path === path ? { ...e, harmful: e.harmful + 1, stale: true, lastAt: now } : { ...e }));
	return { entries: sortEntries(entries) };
}

export function topEntries(state: PlaybookState, n: number): PlaybookEntry[] {
	return sortEntries(state.entries).slice(0, Math.max(0, n));
}

export function renderPlaybook(state: PlaybookState, n = 8): string[] {
	return topEntries(state, n).map((e) => {
		const stale = e.stale ? ', needs re-read' : '';
		const harmful = e.harmful > 0 ? `, stale ${e.harmful}x` : '';
		const ref = e.ref ? ` [blob:${e.ref}]` : '';
		return `- ${e.path} (served ${e.helpful}x${harmful}${stale}${ref})`;
	});
}

export function parsePlaybook(raw: unknown): PlaybookState {
	if (!raw || typeof raw !== 'object') return emptyPlaybook();
	const items = (raw as { playbook?: unknown }).playbook;
	if (!Array.isArray(items)) return emptyPlaybook();
	const entries: PlaybookEntry[] = [];
	for (const it of items) {
		if (!it || typeof it !== 'object') continue;
		const o = it as Record<string, unknown>;
		if (typeof o.path !== 'string' || o.path.length === 0) continue;
		entries.push({
			path: o.path,
			ref: typeof o.ref === 'string' ? o.ref : undefined,
			helpful: typeof o.helpful === 'number' && Number.isFinite(o.helpful) ? o.helpful : 0,
			harmful: typeof o.harmful === 'number' && Number.isFinite(o.harmful) ? o.harmful : 0,
			lastAt: typeof o.lastAt === 'number' && Number.isFinite(o.lastAt) ? o.lastAt : 0,
			stale: o.stale === true,
		});
	}
	return { entries: sortEntries(entries) };
}
