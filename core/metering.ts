






export interface MeterState {
	estimateCharsPerToken: number;
	samples: number;
	lastActualChars: number;
	lastActualTokens: number;
	

	olsSamples: Array<{ ascii: number; cjk: number; tokens: number }>;
	olsSlope: number;          
	olsCjkSlope: number;       
	olsIntercept: number;      
	olsSamplesFit: number;     
	olsResidualSum: number;    
}

export const DEFAULT_METER: MeterState = {
	estimateCharsPerToken: 4,
	samples: 0,
	lastActualChars: 0,
	lastActualTokens: 0,
	olsSamples: [],
	olsSlope: 0,        
	olsCjkSlope: 0,
	olsIntercept: 0,
	olsSamplesFit: 0,
	olsResidualSum: 0,
};

export interface MeterSample {
	actualChars: number;
	actualTokens: number;
}

const MAX_OLS_SAMPLES = 200;
const MIN_OLS_SAMPLES = 5;









export function calibrateEstimate(state: MeterState, sample: MeterSample): MeterState {
	if (sample.actualChars <= 0 || sample.actualTokens <= 0) return state;
	const decomp = typeof sample.actualChars === 'string'
		? decomposeAsciiCjk(sample.actualChars)
		: { ascii: sample.actualChars, cjk: 0 };
	const ratio = sample.actualChars / sample.actualTokens;
	
	
	
	
	const moved = state.samples === 0
		? ratio
		: state.estimateCharsPerToken + (ratio - state.estimateCharsPerToken) / Math.min(state.samples + 1, 32);
	const next: MeterState = {
		...state,
		samples: state.samples + 1,
		lastActualChars: sample.actualChars,
		lastActualTokens: sample.actualTokens,
		estimateCharsPerToken: moved,
		olsSamples: [...state.olsSamples, { ascii: decomp.ascii, cjk: decomp.cjk, tokens: sample.actualTokens }],
	};
	if (next.olsSamples.length > MAX_OLS_SAMPLES) {
		next.olsSamples = next.olsSamples.slice(next.olsSamples.length - MAX_OLS_SAMPLES);
	}
	if (next.olsSamples.length >= MIN_OLS_SAMPLES) {
		const fit = fitOls(next.olsSamples);
		next.olsSlope = fit.slopeAscii;
		next.olsCjkSlope = fit.slopeCjk;
		next.olsIntercept = fit.intercept;
		next.olsSamplesFit = next.olsSamples.length;
		next.olsResidualSum = fit.residualSum;
		
		
		
		if (fit.slopeAscii > 0) next.estimateCharsPerToken = 1 / fit.slopeAscii;
	}
	return next;
}



const CJK_RE = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

export interface AsciiCjk {
	ascii: number;
	cjk: number;
}




export function decomposeAsciiCjk(text: string): AsciiCjk {
	let cjk = 0;
	let ascii = 0;
	for (const ch of text) {
		if (CJK_RE.test(ch)) cjk++;
		else ascii++;
	}
	return { ascii, cjk };
}

export interface OlsFit {
	slopeAscii: number;
	slopeCjk: number;
	intercept: number;
	residualSum: number;
}





export function fitOls(samples: Array<{ ascii: number; cjk: number; tokens: number }>): OlsFit {
	const n = samples.length;
	if (n < 3) return { slopeAscii: 0, slopeCjk: 0, intercept: 0, residualSum: 0 };
	let sA = 0, sC = 0, sT = 0;
	let sAA = 0, sCC = 0, sTT = 0;
	let sAC = 0, sAT = 0, sCT = 0;
	for (const s of samples) {
		const a = s.ascii, c = s.cjk, t = s.tokens;
		sA += a; sC += c; sT += t;
		sAA += a * a; sCC += c * c; sTT += t * t;
		sAC += a * c; sAT += a * t; sCT += c * t;
	}
	
	
	const det = det3(sAA, sAC, sA, sAC, sCC, sC, sA, sC, n);
	if (det === 0 || !isFinite(det)) return { slopeAscii: 0, slopeCjk: 0, intercept: 0, residualSum: 0 };
	
	
	
	const slopeAscii = det3(sAT, sAC, sA, sCT, sCC, sC, sT, sC, n) / det;
	const slopeCjk = det3(sAA, sAT, sA, sAC, sCT, sC, sA, sT, n) / det;
	const intercept = det3(sAA, sAC, sAT, sAC, sCC, sCT, sA, sC, sT) / det;
	let residualSum = 0;
	for (const s of samples) {
		const yhat = slopeAscii * s.ascii + slopeCjk * s.cjk + intercept;
		const r = s.tokens - yhat;
		residualSum += r * r;
	}
	return {
		slopeAscii: isFinite(slopeAscii) ? slopeAscii : 0,
		slopeCjk: isFinite(slopeCjk) ? slopeCjk : 0,
		intercept: isFinite(intercept) ? intercept : 0,
		residualSum: isFinite(residualSum) ? residualSum : 0,
	};
}

function det3(
	a: number, b: number, c: number,
	d: number, e: number, f: number,
	g: number, h: number, i: number,
): number {
	return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}






export function estimateTokens(text: string, charsPerToken = 3.3): number {
	if (!text) return 0;
	const { ascii, cjk } = decomposeAsciiCjk(text);
	return Math.ceil(ascii / Math.max(1, charsPerToken) + cjk);
}




export function estimateTokensOls(text: string, state: MeterState): number {
	if (!text) return 0;
	const { ascii, cjk } = decomposeAsciiCjk(text);
	if (state.olsSamplesFit < MIN_OLS_SAMPLES || state.olsSlope <= 0) {
		
		
		return estimateTokens(text, state.estimateCharsPerToken);
	}
	const yhat = state.olsSlope * ascii + state.olsCjkSlope * cjk + state.olsIntercept;
	return Math.max(0, Math.ceil(yhat));
}

export interface BudgetInfo {
	total: number;
	headroom: number;
	headroomPct: number;
	overBudget: boolean;
	warn: boolean;
}


export function budgetInfo(contextTokens: number, hostLimitTokens: number, warnThresholdPct: number): BudgetInfo {
	const internal = Math.floor(hostLimitTokens * 0.9);
	const headroom = internal - contextTokens;
	const headroomPct = internal > 0 ? headroom / internal : 0;
	return {
		total: contextTokens,
		headroom,
		headroomPct,
		overBudget: headroom < 0,
		
		warn: internal > 0 && headroom > 0 && contextTokens / internal >= warnThresholdPct,
	};
}


export function breakEven(savedTokens: number, overheadTokens: number): number {
	return savedTokens - overheadTokens;
}
