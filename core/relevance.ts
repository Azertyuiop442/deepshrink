





import { foldAscii, stopwordsFor, detectLanguage } from './language.ts';


export function queryTerms(query: string): string[] {
	const lang = detectLanguage(query, 10);
	const stop = stopwordsFor(lang === 'unknown' ? 'en' : lang);
	const folded = foldAscii(query.toLowerCase());
	const terms = folded.match(/[a-z][a-z0-9]{2,}/g) ?? [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of terms) {
		if (stop.has(t)) continue;
		if (seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

export interface RelevanceResult {
	score: number;       
	matchedTerms: string[];
}




export type IdfTable = Map<string, number>;




export const IDF_MIN_CORPUS = 20;











export function scoreRelevance(text: string, terms: string[], idf?: IdfTable, corpusSize = 0): RelevanceResult {
	if (terms.length === 0) return { score: 0, matchedTerms: [] };
	const folded = foldAscii(text.toLowerCase());
	const matchedTerms: string[] = [];
	const useIdf = idf !== undefined && corpusSize >= IDF_MIN_CORPUS;
	let raw = 0;
	for (const term of terms) {
		let count = 0;
		let idx = 0;
		while ((idx = folded.indexOf(term, idx)) !== -1) {
			count++;
			idx += term.length;
		}
		if (count > 0) {
			
			
			const tf = Math.min(count, 3);
			const idfVal = useIdf ? (idf.get(term) ?? 0) : 1 + Math.log1p(term.length - 2);
			raw += tf * idfVal;
			matchedTerms.push(term);
		}
	}
	if (raw === 0) return { score: 0, matchedTerms };
	
	const maxRaw = useIdf
		? terms.length * 3 * Math.max(...terms.map(t => idf.get(t) ?? 0), 0.01)
		: terms.length * 3 * (1 + Math.log1p(10));
	return { score: Math.min(1, raw / maxRaw), matchedTerms };
}




export function buildIdf(postings: Map<string, Map<string, unknown>>, corpusSize: number): IdfTable {
	const idf = new Map<string, number>();
	for (const [term, docs] of postings) {
		const df = docs.size;
		idf.set(term, Math.log(1 + (corpusSize - df + 0.5) / (df + 0.5)));
	}
	return idf;
}


export function rankByRelevance<T extends { content: string }>(hits: T[], query: string): Array<T & { relevance: number; matchedTerms: string[] }> {
	const terms = queryTerms(query);
	const scored = hits.map((h) => {
		const r = scoreRelevance(h.content, terms);
		return { ...h, relevance: r.score, matchedTerms: r.matchedTerms };
	});
	scored.sort((a, b) => b.relevance - a.relevance);
	return scored;
}
