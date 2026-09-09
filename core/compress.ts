











import { detectLanguage, stopwordsFor, isProtectedToken, foldAscii, type Language } from './language.ts';




const NEGATION_WORDS = new Set([
	'ne', 'pas', 'jamais', 'rien', 'aucun', 'aucune', 'personne', 'ni', 'sans', 'plus',
	'not', 'no', 'never', 'none', 'nothing', 'nor', 'neither', 'without',
	'nunca', 'nada', 'ningun', 'ninguna', 'nadie', 'tampoco',
	'nicht', 'nie', 'nichts', 'kein', 'keine', 'keinen', 'niemals', 'ohne',
]);

export interface CompressOptions {
	minChars: number;        
	targetRatio: number;     
	language: Language | 'auto';
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
	minChars: 500,
	targetRatio: 0.65,
	language: 'auto',
};

export interface CompressResult {
	text: string;
	wasCompressed: boolean;
	ratio: number;           
	lang: Language;
}


export function isCodeLine(line: string): boolean {
	const t = line.trim();
	if (!t) return false;
	
	if (/^\s{2,}/.test(line) && /[=;{}()[\],<>]/.test(t)) return true;
	if (/[;{}\[\]()<>]$/.test(t)) return true;
	if (/^(export|import|function|const|let|var|async|await|return|if|else|for|while|class|interface|type|enum|def|fn|func|pub|impl|use|package|require|from|=>)/.test(t)) return true;
	if (/\b=>\b/.test(t) || /\b===\b/.test(t) || /\b!==\b/.test(t)) return true;
	return false;
}


function compressProse(text: string, lang: Language, targetRatio: number): string {
	const stopwords = stopwordsFor(lang);
	const lines = text.split('\n');
	const out: string[] = [];
	let removed = 0;
	let total = 0;
	
	
	
	
	
	const removedByLine: Array<Array<{ idx: number; word: string }>> = [];

	for (const line of lines) {
		if (isCodeLine(line)) {
			out.push(line);
			total += line.split(/\s+/).length;
			removedByLine.push([]);
			continue;
		}
		
		
		
		const words = line.split(/(\s+)/);
		const totalWords = words.filter((w) => w.trim() !== '').length;
		const kept: Array<string | null> = [];
		const removedHere: Array<{ idx: number; word: string }> = [];
		let wordIdx = 0;
		for (const w of words) {
			if (w.trim() === '') { kept.push(w); continue; }
			const isEdge = wordIdx < 3 || wordIdx >= totalWords - 3;
			wordIdx++;
			total++;
			
			
			
			const lower = w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
			const folded = foldAscii(lower);
			if (!lower) { kept.push(w); continue; }
			
			
			
			if (NEGATION_WORDS.has(folded)) { kept.push(w); continue; }
			
			if (isProtectedToken(lower)) { kept.push(w); continue; }
			
			if (/^["'`]/.test(w) || /["'`]$/.test(w)) { kept.push(w); continue; }
			if (!isEdge && stopwords.has(folded)) {
				removed++;
				removedHere.push({ idx: kept.length, word: w });
				kept.push(null); 
				continue;
			}
			kept.push(w);
		}
		removedByLine.push(removedHere);
		out.push(kept as unknown as string);
	}

	
	
	
	
	const ratio = total > 0 ? 1 - removed / total : 1;
	if (ratio < targetRatio && removed > 0) {
		const needRestore = removed - Math.floor(total * (1 - targetRatio));
		if (needRestore > 0) {
			
			
			
			const all: Array<{ line: number; idx: number; word: string }> = [];
			for (let li = 0; li < removedByLine.length; li++) {
				for (const r of removedByLine[li]) all.push({ line: li, idx: r.idx, word: r.word });
			}
			all.sort((a, b) => b.word.length - a.word.length);
			const restore = all.slice(0, Math.min(needRestore, all.length));
			for (const r of restore) {
				const lineWords = (out[r.line] as unknown as Array<string | null>);
				if (lineWords[r.idx] === null) lineWords[r.idx] = r.word;
			}
		}
	}

	const result = out.map((l) => (l as unknown as Array<string | null>).join('')).join('\n');
	if (result === text) return text;
	return result;
}




export function compressText(raw: string, options: Partial<CompressOptions> = {}): CompressResult {
	const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...options };
	const text = raw ?? '';
	if (text.length < opts.minChars) {
		return { text, wasCompressed: false, ratio: 1, lang: 'unknown' };
	}
	try {
		const lang = opts.language === 'auto' ? detectLanguage(text) : opts.language;
		
		
		const compressed = compressProse(text, lang, opts.targetRatio);
		if (compressed === text) {
			return { text, wasCompressed: false, ratio: 1, lang };
		}
		
		
		const ratio = text.length > 0 ? compressed.length / text.length : 1;
		if (1 - ratio < 0.1) {
			return { text, wasCompressed: false, ratio: 1, lang };
		}
		return { text: compressed, wasCompressed: true, ratio, lang };
	} catch {
		return { text, wasCompressed: false, ratio: 1, lang: 'unknown' };
	}
}
