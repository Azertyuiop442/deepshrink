

import { createHash } from 'node:crypto';


export function sha256Hex(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex');
}


export function shortHash(input: string, prefixChars = 12): string {
	return sha256Hex(input).slice(0, prefixChars);
}


export function hashForContent(content: string): string {
	return sha256Hex(content);
}
