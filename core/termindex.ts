






import { foldAscii } from './language.ts';











export function tokenizeIdentifier(term: string): string[] {
	const atoms = term
		.trim()
		.split(/[\s]+/)
		.filter(t => t.length > 0)
		.map(t => foldAscii(t.toLowerCase()));
	const tokens = new Set<string>();
	for (const atom of atoms) {
		if (!atom) continue;
		tokens.add(atom); 
		
		
		
		const parts = atom.split(/[_./\\-]+/).filter(p => p.length >= 3);
		for (const p of parts) {
			tokens.add(p);
		}
	}
	return [...tokens];
}






export function tokenizePath(term: string): string[] {
	return term
		.trim()
		.split(/[\s]+/)
		.filter(t => t.length > 0)
		.map(t => foldAscii(t.toLowerCase()));
}


export type TermIndex = Map<string, Map<string, number>>;

export interface IndexedEntry {
	hash: string;
	content: string;
	
	path?: string;
}

export function emptyIndex(): TermIndex {
	return new Map();
}


export function indexAdd(index: TermIndex, entry: IndexedEntry): void {
	for (const term of tokenizeIdentifier(entry.content)) {
		let postings = index.get(term);
		if (!postings) {
			postings = new Map();
			index.set(term, postings);
		}
		postings.set(entry.hash, (postings.get(entry.hash) ?? 0) + 1);
	}
	if (entry.path) {
		
		
		for (const term of tokenizePath(entry.path)) {
			let postings = index.get(term);
			if (!postings) {
				postings = new Map();
				index.set(term, postings);
			}
			postings.set(entry.hash, (postings.get(entry.hash) ?? 0) + 1);
		}
	}
}



export function indexRemove(index: TermIndex | undefined, hash: string): void {
	if (!index) return;
	for (const [, postings] of index) {
		postings.delete(hash);
	}
	
	for (const [term, postings] of index) {
		if (postings.size === 0) index.delete(term);
	}
}










export function indexQuery(index: TermIndex, terms: string[]): string[] {
	const counts = new Map<string, number>();
	const seenTerm = new Set<string>();
	for (const term of terms) {
		const clean = term.trim().toLowerCase();
		if (!clean) continue;
		if (seenTerm.has(clean)) continue;
		seenTerm.add(clean);
		const tok = tokenizeIdentifier(clean);
		const visited = new Set<string>();
		for (const t of tok) {
			if (visited.has(t)) continue;
			visited.add(t);
			const postings = index.get(t);
			if (!postings) continue;
			for (const h of postings.keys()) {
				counts.set(h, (counts.get(h) ?? 0) + 1);
			}
		}
	}
	return [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}










export function indexPathLookup(index: TermIndex, pathTerm: string): string[] {
	const tok = tokenizePath(pathTerm);
	if (tok.length === 0) return [];
	const union = new Set<string>();
	for (const t of tok) {
		
		const postings = index.get(t);
		if (postings) {
			for (const h of postings.keys()) union.add(h);
			continue;
		}
		
		for (const [key, postings] of index) {
			if (key.length <= t.length) continue;
			if (key.endsWith(t)) {
				
				for (const h of postings.keys()) union.add(h);
				continue;
			}
			const segments = key.split('/');
			const last = segments[segments.length - 1];
			if (last.startsWith(t) || last.endsWith(t) || last.includes(t)) {
				for (const h of postings.keys()) union.add(h);
			}
		}
	}
	return [...union];
}
