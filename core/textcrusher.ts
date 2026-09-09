




export interface TextCrushOptions {
	minChars: number;      
	targetRatio: number;   
	maxSegments: number;
	keepErrorLines: boolean;
}

export const DEFAULT_TEXTCRUSH_OPTIONS: TextCrushOptions = {
	minChars: 2000,
	targetRatio: 0.5,
	maxSegments: 200,
	keepErrorLines: true,
};

export interface TextCrushResult {
	text: string;
	wasCrushed: boolean;
	segmentsBefore: number;
	segmentsAfter: number;
}


function salientScore(seg: string): number {
	let score = 0;
	if (/\berror\b|\bexception\b|\bfailed\b|\bfail\b|\bwarning\b|\btraceback\b|\bassert\b|\btodo\b|\bfixme\b/i.test(seg)) score += 1.5;
	if (/\b\d+\b/.test(seg)) score += 0.5;
	if (/\b[A-Z]{2,}\b/.test(seg)) score += 0.5;
	if (/[\w.-]+\.[\w-]+/.test(seg)) score += 0.5;
	return score;
}


function splitSegments(text: string): string[] {
	const parts = text.split(/(?<=[.!?])\s+|\n+/);
	const out: string[] = [];
	for (const p of parts) {
		const t = p.trim();
		if (t.length < 12) continue;
		out.push(t.length > 500 ? t.slice(0, 500) + '…' : t);
	}
	return out;
}


export function crushText(text: string, options: Partial<TextCrushOptions> = {}): TextCrushResult {
	const opts = { ...DEFAULT_TEXTCRUSH_OPTIONS, ...options };
	const noOp: TextCrushResult = { text, wasCrushed: false, segmentsBefore: 0, segmentsAfter: 0 };
	if (!text || text.length < opts.minChars) return noOp;
	try {
		const segments = splitSegments(text);
		if (segments.length <= 8) return noOp; 
		
		const scored = segments.map((seg, i) => {
			let s = salientScore(seg);
			if (i < 2 || i >= segments.length - 2) s += 1.0; 
			return { seg, score: s, i };
		});
		scored.sort((a, b) => b.score - a.score);
		
		const target = Math.ceil(text.length * opts.targetRatio);
		const kept = new Set<number>();
		let budget = target;
		for (const s of scored) {
			if (budget <= 0) break;
			kept.add(s.i);
			budget -= s.seg.length;
		}
		
		if (opts.keepErrorLines) {
			for (const s of scored) {
				if (/error|fail|exception|traceback|✗|×|not ok/i.test(s.seg)) kept.add(s.i);
			}
		}
		
		
		for (const s of scored) {
			if (/\b(ne|pas|jamais|rien|aucun|aucune|ni|sans|not|no|never|none|nunca|nada|nicht|nie|kein|keine|niemals)\b/i.test(s.seg)) kept.add(s.i);
		}
		const ordered = [...kept].sort((a, b) => a - b).map((i) => segments[i]);
		const out = ordered.join('\n');
		if (out.length >= text.length) return noOp;
		return { text: out, wasCrushed: true, segmentsBefore: segments.length, segmentsAfter: ordered.length };
	} catch {
		return noOp;
	}
}
