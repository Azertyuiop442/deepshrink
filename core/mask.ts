import { countTextLines } from './delta.ts';

export interface MaskPolicy {
	keepLast: number;
	polling: number;
	minChars: number;
}

export type MaskVerdict = 'mask' | 'small' | 'error' | 'already';

export interface MaskMeter {
	passes: number;
	observations: number;
	masked: number;
	keptError: number;
	keptSmall: number;
	keptFirst: number;
	refs: number;
	savedChars: number;
	cacheDips: number;
}

export const EMPTY_MASK_METER: MaskMeter = {
	passes: 0,
	observations: 0,
	masked: 0,
	keptError: 0,
	keptSmall: 0,
	keptFirst: 0,
	refs: 0,
	savedChars: 0,
	cacheDips: 0,
};

const ERROR_RE = /(^|\n)\s*(error|Error|ERROR|ERR_|FAIL|FAILED|Failed|failed|✗|×|not ok|Traceback|panic|Exception|cannot |could not )/;
const PLACEHOLDER_PREFIX = '[deepskrin] old tool output elided';

export function isMaskPlaceholder(text: string): boolean {
	return text.startsWith(PLACEHOLDER_PREFIX);
}

export function maskCut(total: number, keepLast: number, polling: number): number {
	const keep = Math.max(0, keepLast);
	const step = Math.max(1, polling);
	if (total <= keep) return 0;
	const eligible = total - keep;
	return Math.floor(eligible / step) * step;
}

export function shouldMask(text: string, isError: boolean, minChars: number): MaskVerdict {
	if (isError) return 'error';
	if (!text) return 'small';
	if (isMaskPlaceholder(text)) return 'already';
	if (text.length < Math.max(0, minChars)) return 'small';
	if (ERROR_RE.test(text.slice(0, 4000))) return 'error';
	return 'mask';
}

export function buildMaskPlaceholder(text: string, ref?: string): string {
	const lines = countTextLines(text);
	const refPart = ref ? ` [blob:${ref}]` : '';
	return `${PLACEHOLDER_PREFIX} (${lines} lines, ${text.length} chars)${refPart} — recover the exact text with deepshrink_recall (search a distinctive word from it).`;
}
