import { countTextLines } from './delta.ts';
import type { MaskModelOverride } from './config.ts';

export interface MaskSettings {
	enabled: boolean;
	pressurePct: number;
	keepLast: number;
	polling: number;
}

export function pickMaskOverride(model: string, perModel: Record<string, MaskModelOverride> | undefined): MaskModelOverride | undefined {
	if (!perModel || !model) return undefined;
	const wanted = model.trim().toLowerCase();
	if (!wanted) return undefined;
	const direct = perModel[wanted];
	if (direct) return direct;
	const parts = wanted.split('/');
	const short = parts[parts.length - 1] ?? wanted;
	if (short && perModel[short]) return perModel[short];
	for (const [key, value] of Object.entries(perModel)) {
		if (key.endsWith(`/${short}`)) return value;
	}
	return undefined;
}

export function resolveMaskSettings(model: string, base: MaskSettings, perModel: Record<string, MaskModelOverride> | undefined): MaskSettings {
	const override = pickMaskOverride(model, perModel);
	if (!override) return base;
	return {
		enabled: typeof override.enabled === 'boolean' ? override.enabled : base.enabled,
		pressurePct: typeof override.pressurePct === 'number' ? override.pressurePct : base.pressurePct,
		keepLast: typeof override.keepLast === 'number' ? override.keepLast : base.keepLast,
		polling: typeof override.polling === 'number' ? override.polling : base.polling,
	};
}

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
	prefixExtensions: number;
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
	prefixExtensions: 0,
};

const ERROR_RE = /(^|\n)\s*(error|Error|ERROR|ERR_|FAIL|FAILED|Failed|failed|✗|×|not ok|Traceback|panic|Exception|cannot |could not )/;
const PLACEHOLDER_PREFIX = '[deepshrink] old tool output elided';

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

export function maskWorthwhile(savingsPct: number, minPct: number): boolean {
	if (!(minPct > 0)) return true;
	return savingsPct >= minPct;
}

export function maskAllowedByPressure(contextTokens: number, minTokens: number): boolean {
	if (!(minTokens > 0)) return true;
	return contextTokens >= minTokens;
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
	return `${PLACEHOLDER_PREFIX} (${lines} lines, ${text.length} chars)${refPart}`;
}
