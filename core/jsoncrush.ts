







import { adaptiveSize } from './adaptivesize.ts';

export interface CrushOptions {
	minItems: number;       
	minTokens: number;      
	maxItems: number;       
	firstFraction: number;  
	lastFraction: number;   
	keepErrors: boolean;    
}

export const DEFAULT_CRUSH_OPTIONS: CrushOptions = {
	minItems: 5,
	minTokens: 200,
	maxItems: 15,
	firstFraction: 0.3,
	lastFraction: 0.15,
	keepErrors: true,
};

export interface CrushResult {
	text: string;
	wasCrushed: boolean;
	rowsBefore: number;
	rowsAfter: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;
const ERROR_RE = /error|fail|exception|traceback|✗|×|not ok/i;


function estTokens(s: string): number {
	let cjk = 0;
	let ascii = 0;
	for (const ch of s) {
		if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(ch)) cjk++;
		else ascii++;
	}
	return Math.ceil(ascii / 3.3 + cjk);
}


function looksLikeId(v: string): boolean {
	if (UUID_RE.test(v)) return true;
	if (/^[0-9a-f]{16,}$/i.test(v)) return true;
	if (/^[A-Za-z0-9_-]{8,}$/.test(v) && /[0-9]/.test(v)) return true;
	return false;
}




export function extractAnchors(question: string): string[] {
	const out = new Set<string>();
	const add = (v: string) => { const t = v.trim(); if (t.length >= 2) out.add(t.toLowerCase()); };
	
	const uuids: string[] = [];
	for (const m of question.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
		add(m[0]);
		uuids.push(m[0].toLowerCase());
	}
	
	for (const m of question.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) add(m[0]);
	
	for (const m of question.matchAll(/["'`]([^"'`]{2,40})["'`]/g)) add(m[1]);
	
	for (const m of question.matchAll(/\b\d{4,}\b/g)) {
		const isInUuid = uuids.some((u) => u.includes(m[0].toLowerCase()));
		if (!isInUuid) add(m[0]);
	}
	
	
	for (const m of question.matchAll(/\b[a-z][a-z0-9]*[-_][a-z0-9]+[-_]\d+\b|\b[a-z][a-z0-9]*[-_]\d+\b/gi)) {
		add(m[0]);
	}
	
	for (const m of question.matchAll(/\b[\w-]+\.(?:com|io|dev|org|net|app|ai)\b/gi)) add(m[0]);
	return [...out];
}


function rowMatchesAnchors(rowJson: string, anchors: string[]): boolean {
	if (anchors.length === 0) return false;
	const lower = rowJson.toLowerCase();
	return anchors.some((a) => lower.includes(a));
}










export function crushJsonArray(arr: unknown[], options: Partial<CrushOptions> = {}, question = ''): CrushResult {
	const opts = { ...DEFAULT_CRUSH_OPTIONS, ...options };
	const noCrush: CrushResult = { text: JSON.stringify(arr), wasCrushed: false, rowsBefore: arr.length, rowsAfter: arr.length };
	if (!Array.isArray(arr) || arr.length < opts.minItems) return noCrush;
	if (estTokens(JSON.stringify(arr)) < opts.minTokens) return noCrush;
	
	if (!arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return noCrush;

	try {
		const rows = arr as Array<Record<string, unknown>>;
		const keys = new Set<string>();
		for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
		const keyList = [...keys];

		
		const uniqueRatio = new Map<string, number>();
		const isConstant = new Map<string, boolean>();
		for (const k of keyList) {
			const vals = rows.map((r) => JSON.stringify(r[k] ?? null));
			const uniq = new Set(vals);
			uniqueRatio.set(k, uniq.size / Math.max(1, vals.length));
			isConstant.set(k, uniq.size === 1);
		}
		const anchors = extractAnchors(question);
		const keepIdx = new Set<number>();
		const keepAll = (pred: (r: Record<string, unknown>, i: number) => boolean) => {
			for (let i = 0; i < rows.length; i++) if (pred(rows[i], i)) keepIdx.add(i);
		};

		
		const headN = Math.max(1, Math.floor(rows.length * opts.firstFraction));
		const tailN = Math.max(1, Math.floor(rows.length * opts.lastFraction));
		for (let i = 0; i < headN; i++) keepIdx.add(i);
		for (let i = rows.length - tailN; i < rows.length; i++) keepIdx.add(i);

		
		if (anchors.length > 0) {
			keepAll((r) => rowMatchesAnchors(JSON.stringify(r), anchors));
		}

		
		if (opts.keepErrors) {
			keepAll((r) => ERROR_RE.test(JSON.stringify(r)));
		}

		
		
		const distinctive: number[] = [];
		for (let i = 0; i < rows.length; i++) {
			for (const k of keyList) {
				const ur = uniqueRatio.get(k) ?? 0;
				if (ur > 0.7 && !isConstant.get(k)) {
					const v = rows[i][k];
					if (v !== null && v !== undefined && v !== '') {
						distinctive.push(i);
						break;
					}
				}
			}
		}
		
		
		
		const notKept = rows.map((r, i) => ({ r, i })).filter((x) => !keepIdx.has(x.i));
		let adaptiveBudget = opts.maxItems - keepIdx.size;
		if (notKept.length > 0) {
			const adapt = adaptiveSize(notKept.map((x) => JSON.stringify(x.r)), {
				minKeep: 0,
				maxKeep: opts.maxItems - keepIdx.size,
			});
			adaptiveBudget = Math.min(adaptiveBudget, adapt.keepCount);
		}
		
		
		let budget = Math.max(0, adaptiveBudget);
		if (budget > 0) {
			for (const i of distinctive) {
				if (budget <= 0) break;
				if (!keepIdx.has(i)) { keepIdx.add(i); budget--; }
			}
		}
		if (budget > 0) {
			for (let i = 0; i < rows.length && budget > 0; i++) {
				if (!keepIdx.has(i)) { keepIdx.add(i); budget--; }
			}
		}

		
		const kept = [...keepIdx].sort((a, b) => a - b).map((i) => rows[i]);
		const schema = keyList.map((k) => {
			const sample = rows.find((r) => r[k] !== null && r[k] !== undefined)?.[k];
			const t = sample === null ? 'null' : Array.isArray(sample) ? 'array' : typeof sample;
			return isConstant.get(k) ? `${k}:const` : `${k}:${t}`;
		});
		const rendered = `[N=${rows.length}]{${schema.join(',')}}\n` + kept.map((r) => JSON.stringify(r)).join('\n');
		if (estTokens(rendered) >= estTokens(JSON.stringify(arr))) return noCrush;
		return { text: rendered, wasCrushed: true, rowsBefore: rows.length, rowsAfter: kept.length };
	} catch {
		return noCrush;
	}
}


export function crushJsonText(text: string, options?: Partial<CrushOptions>, question = ''): CrushResult {
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return crushJsonArray(parsed, options, question);
		return { text, wasCrushed: false, rowsBefore: 0, rowsAfter: 0 };
	} catch {
		return { text, wasCrushed: false, rowsBefore: 0, rowsAfter: 0 };
	}
}
