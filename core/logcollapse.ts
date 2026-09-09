






export interface LogCollapseResult {
	text: string;
	wasCollapsed: boolean;
	keptLines: number;
	totalLines: number;
}


const NUMBER = /\b\d+(?:\.\d+)*\b/;
const HASHISH = /\b[0-9a-f]{6,}\b/i;
const VERSION = /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/;



const KEEP_LINE =
	/error|fail|✗|×|not ok|warning|warn:|panic|exception|undefined|cannot|expected|assert|-->|\bat\b|\bin\b/i;



function isTemplateLine(line: string): boolean {
	if (KEEP_LINE.test(line)) return false;
	if (line.trim().length < 8) return false;
	return NUMBER.test(line) || HASHISH.test(line) || VERSION.test(line);
}




function templateKey(line: string): string {
	
	
	return line
		.replace(/v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/g, '#')
		.replace(/(?<![A-Za-z])\d+(?:\.\d+)*/g, '#')
		.replace(/(?<![A-Za-z])[0-9a-f]{6,}/gi, '#');
}

export function collapseLogLines(content: string, minLines = 8): LogCollapseResult {
	const lines = content.split('\n');
	if (lines.length < minLines) return { text: content, wasCollapsed: false, keptLines: lines.length, totalLines: lines.length };
	const out: string[] = [];
	const groups = new Map<string, number>();
	const order: string[] = [];
	let collapsed = 0;
	for (const raw of lines) {
		const line = raw.trimEnd();
		if (isTemplateLine(line)) {
			const key = templateKey(line);
			const n = (groups.get(key) ?? 0) + 1;
			groups.set(key, n);
			if (n === 1) order.push(key);
			collapsed++;
			continue;
		}
		out.push(line);
	}
	
	const groupLines = order.map(k => {
		const n = groups.get(k) ?? 0;
		return n > 1 ? `${k} (×${n})` : k;
	});
	if (collapsed === 0) return { text: content, wasCollapsed: false, keptLines: lines.length, totalLines: lines.length };
	const text = [...out, ...groupLines].join('\n');
	return { text, wasCollapsed: text.length < content.length, keptLines: text.split('\n').length, totalLines: lines.length };
}
