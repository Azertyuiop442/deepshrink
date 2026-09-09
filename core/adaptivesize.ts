




export interface AdaptiveSizeOptions {
	minKeep: number;       
	maxKeep: number;       
	minGainRatio: number;  
}

export const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveSizeOptions = {
	minKeep: 3,
	maxKeep: 15,
	minGainRatio: 0.03,    
};

export interface AdaptiveSizeResult {
	keepCount: number;
	elbowIndex: number;
	coverage: number;      
	curve: number[];       
}


function shingles(text: string): Set<string> {
	const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const words = norm.split(' ').filter((w) => w.length > 1);
	const out = new Set<string>();
	for (let i = 0; i < words.length - 1; i++) {
		out.add(`${words[i]} ${words[i + 1]}`);
	}
	if (words.length === 1) out.add(words[0]);
	return out;
}







export function adaptiveSize(items: string[], options: Partial<AdaptiveSizeOptions> = {}): AdaptiveSizeResult {
	const opts = { ...DEFAULT_ADAPTIVE_OPTIONS, ...options };
	const n = items.length;
	const noOp: AdaptiveSizeResult = { keepCount: n, elbowIndex: n - 1, coverage: 1, curve: [] };
	if (n === 0) return noOp;

	
	
	const order = items
		.map((it, i) => ({ it, i }))
		.sort((a, b) => b.it.length - a.it.length || a.i - b.i);

	const seen = new Set<string>();
	let totalCoverage = 0;
	const curve: number[] = [];
	for (const { it } of order) {
		const s = shingles(it);
		let added = 0;
		for (const g of s) {
			if (!seen.has(g)) {
				seen.add(g);
				added++;
			}
		}
		totalCoverage += added;
		curve.push(totalCoverage);
	}
	if (totalCoverage === 0) return noOp;

	
	
	
	const norm = curve.map((v) => v / totalCoverage);
	let elbow = 0;
	for (let i = 1; i < n; i++) {
		const gain = norm[i] - norm[i - 1];
		if (gain >= opts.minGainRatio) elbow = i;
	}
	const keepCount = Math.min(n, Math.min(opts.maxKeep, Math.max(opts.minKeep, elbow + 1)));
	return {
		keepCount,
		elbowIndex: elbow,
		coverage: norm[Math.min(elbow, n - 1)],
		curve: norm,
	};
}
