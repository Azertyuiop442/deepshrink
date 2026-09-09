














export interface DiffLine {
	kind: ' ' | '-' | '+';
	line: string;
	oldLine?: number;   
	newLine?: number;   
}

export interface DiffSummary {
	hunks: Array<{
		oldStart: number;
		oldLines: number;
		newStart: number;
		newLines: number;
		lines: DiffLine[];
	}>;
	added: number;
	removed: number;
	changedRatio: number;  
}


function splitLines(text: string): string[] {
	const out = text.split('\n');
	if (out.length > 0 && out[out.length - 1] === '') out.pop();
	return out;
}






export function myersDiff(oldText: string, newText: string): DiffLine[] {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	
	
	const w = m + 1;
	const lcs = new Int32Array((n + 1) * w);
	for (let i = 1; i <= n; i++) {
		const ai = a[i - 1];
		const row = i * w;
		const prev = (i - 1) * w;
		for (let j = 1; j <= m; j++) {
			lcs[row + j] = ai === b[j - 1]
				? lcs[prev + j - 1] + 1
				: Math.max(lcs[prev + j], lcs[row + j - 1]);
		}
	}
	
	const ops: Array<{ op: ' ' | '-' | '+'; ai: number; bi: number }> = [];
	let i = n, j = m;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			ops.push({ op: ' ', ai: i - 1, bi: j - 1 });
			i--; j--;
		} else if (lcs[(i - 1) * w + j] >= lcs[i * w + j - 1]) {
			ops.push({ op: '-', ai: i - 1, bi: j - 1 });
			i--;
		} else {
			ops.push({ op: '+', ai: i - 1, bi: j - 1 });
			j--;
		}
	}
	while (i > 0) { ops.push({ op: '-', ai: i - 1, bi: 0 }); i--; }
	while (j > 0) { ops.push({ op: '+', ai: 0, bi: j - 1 }); j--; }
	ops.reverse();
	return ops.map(o => ({
		kind: o.op,
		line: o.op === '+' ? b[o.bi] : a[o.ai],
		oldLine: o.op !== '+' ? o.ai + 1 : undefined,
		newLine: o.op !== '-' ? o.bi + 1 : undefined,
	}));
}



const CONTEXT = 2;
export function diffToHunks(d: DiffLine[]): DiffSummary['hunks'] {
	const hunks: DiffSummary['hunks'] = [];
	let i = 0;
	while (i < d.length) {
		if (d[i].kind === ' ') { i++; continue; }
		
		const startIdx = i;
		let endIdx = i;
		while (endIdx < d.length && d[endIdx].kind !== ' ') endIdx++;
		
		const withStart = Math.max(0, startIdx - CONTEXT);
		const withEnd = Math.min(d.length, endIdx + CONTEXT);
		
		let oldStart = 0, oldLines = 0, newStart = 0, newLines = 0;
		for (let j = withStart; j < withEnd; j++) {
			const dl = d[j];
			if (dl.kind === ' ' || dl.kind === '-') { if (oldLines === 0 && dl.oldLine !== undefined) oldStart = dl.oldLine; oldLines++; }
			if (dl.kind === ' ' || dl.kind === '+') { if (newLines === 0 && dl.newLine !== undefined) newStart = dl.newLine; newLines++; }
		}
		hunks.push({ oldStart, oldLines, newStart, newLines, lines: d.slice(withStart, withEnd) });
		i = withEnd;
	}
	return hunks;
}


export function summarizeDiff(oldText: string, newText: string): DiffSummary {
	const lines = myersDiff(oldText, newText);
	let added = 0, removed = 0;
	for (const l of lines) {
		if (l.kind === '+') added++;
		else if (l.kind === '-') removed++;
	}
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const total = Math.max(a.length, b.length, 1);
	return {
		hunks: diffToHunks(lines),
		added,
		removed,
		changedRatio: (added + removed) / total,
	};
}


export function formatDeltaPatch(summary: DiffSummary, path: string): string {
	if (summary.hunks.length === 0) return `[Delta read_file: ${path} — no changes]`;
	const lines: string[] = [];
	const totalAdd = summary.added;
	const totalDel = summary.removed;
	lines.push(`[Delta read_file: ${path} — ${summary.hunks.length} hunk(s), +${totalAdd} -${totalDel}, ratio ${(summary.changedRatio * 100).toFixed(1)}%]`);
	for (const h of summary.hunks) {
		lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
		for (const l of h.lines) {
			if (l.kind === ' ') lines.push(' ' + l.line);
			else if (l.kind === '-') lines.push('-' + l.line);
			else lines.push('+' + l.line);
		}
	}
	return lines.join('\n');
}
