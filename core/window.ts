











export const MAX_LINE_CHARS = 2000;

export const MAX_OUTPUT_CHARS = 128 * 1024;

export const MAX_LINES = 2000;

export interface WindowCounters {
	
	windowedRead: number;
	
	windowServed: number;
	
	windowMissNoBlob: number;
	
	windowMissStale: number;
	
	windowMissOutOfBounds: number;
	
	windowRereadModified: number;
}

export const EMPTY_WINDOW_COUNTERS: WindowCounters = {
	windowedRead: 0,
	windowServed: 0,
	windowMissNoBlob: 0,
	windowMissStale: 0,
	windowMissOutOfBounds: 0,
	windowRereadModified: 0,
};











export function formatWindow(
	content: string,
	offset: number,
	limit: number,
): string | null {
	if (offset < 1) return null;
	
	
	const rawLines = content.split('\n');
	const lines = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
	if (offset > lines.length) return null;
	const end = Math.min(offset + limit - 1, lines.length);
	const out: string[] = [];
	let chars = 0;
	for (let i = offset - 1; i < end; i++) {
		
		
		let line = lines[i].replace(/\r$/, '');
		let prefix = `${i + 1}: `;
		if (line.length > MAX_LINE_CHARS) {
			line = line.slice(0, MAX_LINE_CHARS) + `… [${line.length - MAX_LINE_CHARS} chars truncated]`;
		}
		const entry = prefix + line;
		if (chars + entry.length + 1 > MAX_OUTPUT_CHARS) {
			out.push(`… [output truncated at ${MAX_OUTPUT_CHARS} chars]`);
			break;
		}
		out.push(entry);
		chars += entry.length + 1;
	}
	return out.join('\n');
}


export function looksWindowed(input: Record<string, unknown>): boolean {
	return (
		typeof input.offset === 'number' ||
		typeof input.limit === 'number' ||
		typeof input.offset === 'string' ||
		typeof input.limit === 'string'
	);
}


export function windowParams(input: Record<string, unknown>): { offset: number; limit: number } {
	const offset = typeof input.offset === 'string' ? parseInt(input.offset, 10) : (typeof input.offset === 'number' ? input.offset : 0);
	const limit = typeof input.limit === 'string' ? parseInt(input.limit, 10) : (typeof input.limit === 'number' ? input.limit : 0);
	return { offset: Number.isFinite(offset) && offset > 0 ? offset : 0, limit: Number.isFinite(limit) && limit > 0 ? limit : 0 };
}
