










export function longestCommonPrefix(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	let i = 0;
	while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	return i;
}

export interface LcpCheck {
	pass: boolean;
	lcpChars: number;
	originalLen: number;
	transformedLen: number;
	ratio: number;
}

const DEFAULT_THRESHOLD = 0.999;

export function checkLcp(original: string, transformed: string, threshold = DEFAULT_THRESHOLD): LcpCheck {
	const lcpChars = longestCommonPrefix(original, transformed);
	const originalLen = original.length;
	const ratio = originalLen > 0 ? lcpChars / originalLen : 1;
	return {
		pass: ratio >= threshold,
		lcpChars,
		originalLen,
		transformedLen: transformed.length,
		ratio,
	};
}
