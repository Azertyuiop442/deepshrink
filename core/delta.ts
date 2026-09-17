














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


export function formatDeltaPatch(summary: DiffSummary, path: string, opts: { unchanged?: number; ref?: string } = {}): string {
	const lines: string[] = [];
	if (summary.hunks.length === 0) {
		lines.push(`[Delta read_file: ${path} — no changes]`);
	} else {
		lines.push(`[Delta read_file: ${path} — ${summary.hunks.length} hunk(s), +${summary.added} -${summary.removed}, ratio ${(summary.changedRatio * 100).toFixed(1)}%]`);
		for (const h of summary.hunks) {
			lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
			for (const l of h.lines) {
				if (l.kind === ' ') lines.push(' ' + l.line);
				else if (l.kind === '-') lines.push('-' + l.line);
				else lines.push('+' + l.line);
			}
		}
	}
	if (opts.unchanged !== undefined && opts.unchanged > 0) {
		lines.push(`  … [${opts.unchanged} unchanged lines preserved in store${opts.ref ? ` ${opts.ref}` : ''} — use deepshrink_recall to re-read]`);
	}
	return lines.join('\n');
}

export function countTextLines(text: string): number {
	const lines = text.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines.length;
}

export function stripLinePrefixes(text: string): string {
	if (!text) return text;
	const lines = text.split('\n');
	let hits = 0;
	let considered = 0;
	for (const l of lines) {
		if (l.trim() === '') continue;
		considered++;
		if (/^\s*\d{1,9}: /.test(l)) hits++;
	}
	if (considered === 0 || hits / considered < 0.5) return text;
	return lines.map((l) => l.replace(/^\s*\d{1,9}: /, '')).join('\n');
}

export function summarizeDiffTrimmed(oldText: string, newText: string, maxMiddleLines = 0): DiffSummary | undefined {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const total = Math.max(a.length, b.length, 1);
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	const midA = a.slice(prefix, a.length - suffix);
	const midB = b.slice(prefix, b.length - suffix);
	if (maxMiddleLines > 0 && (midA.length > maxMiddleLines || midB.length > maxMiddleLines)) return undefined;
	const mid = summarizeDiff(
		midA.length > 0 ? midA.join('\n') + '\n' : '',
		midB.length > 0 ? midB.join('\n') + '\n' : '',
	);
	for (const h of mid.hunks) {
		h.oldStart += prefix;
		h.newStart += prefix;
	}
	return {
		hunks: mid.hunks,
		added: mid.added,
		removed: mid.removed,
		changedRatio: (mid.added + mid.removed) / total,
	};
}

export interface WindowDeltaRender {
	text: string;
	kind: 'unchanged' | 'changed';
}

export function formatWindowDelta(
	summary: DiffSummary,
	path: string,
	offset: number,
	limit: number,
	totalNewLines: number,
	totalOldLines: number,
	opts: { ref?: string } = {},
): WindowDeltaRender | undefined {
	if (offset < 1 || limit < 1 || totalNewLines < 1) return undefined;
	if (offset > totalNewLines) return undefined;
	const start = offset;
	const end = Math.min(offset + limit - 1, totalNewLines);
	const hunks = summary.hunks;
	const intersecting = hunks.filter((h) => {
		const hs = h.newStart;
		const he = h.newStart + Math.max(h.newLines, 1) - 1;
		return he >= start && hs <= end;
	});
	const ref = opts.ref ? ` ${opts.ref}` : '';
	const header = `[Delta read_file: ${path} — window ${start}-${end} of ${totalNewLines} lines — ${intersecting.length} change block(s) inside]`;
	if (intersecting.length === 0) {
		let shift = 0;
		let before = 0;
		let after = 0;
		for (const h of hunks) {
			const he = h.newStart + Math.max(h.newLines, 1) - 1;
			if (he < start) {
				before++;
				shift += h.newLines - h.oldLines;
			} else {
				after++;
			}
		}
		const oldStart = start - shift;
		const oldEnd = end - shift;
		if (oldStart < 1 || oldEnd > totalOldLines) return undefined;
		const where = shift === 0
			? 'identical to the same lines you already read'
			: `identical to lines ${oldStart}-${oldEnd} of the version you already have (file shifted by ${shift} line(s) above this window)`;
		const lines = [
			header,
			`  … [${end - start + 1} lines unchanged — ${where}]`,
		];
		const outside = before + after;
		if (outside > 0) lines.push(`  … [${outside} change block(s) elsewhere in the file; full text in store${ref}]`);
		else lines.push(`  … [full text in store${ref}]`);
		return { text: lines.join('\n'), kind: 'unchanged' };
	}
	const out = [header];
	let pos = start;
	let unchangedTotal = 0;
	for (const h of intersecting) {
		const hs = h.newStart;
		const he = h.newStart + Math.max(h.newLines, 1) - 1;
		if (hs > pos) {
			unchangedTotal += hs - pos;
			out.push(`  … [${hs - pos} unchanged lines — identical to your previous read]`);
		}
		out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
		for (const l of h.lines) {
			if (l.kind === ' ') out.push(' ' + l.line);
			else if (l.kind === '-') out.push('-' + l.line);
			else out.push('+' + l.line);
		}
		pos = Math.max(pos, he + 1);
	}
	if (pos <= end) {
		const tail = end - pos + 1;
		unchangedTotal += tail;
		out.push(`  … [${tail} unchanged lines — identical to your previous read]`);
	}
	const outside = hunks.length - intersecting.length;
	out.push(`  … [${unchangedTotal} of the ${end - start + 1} requested lines unchanged; ${outside} change block(s) elsewhere; full text in store${ref}]`);
	return { text: out.join('\n'), kind: 'changed' };
}

export interface DeltaMeter {
	considered: number;
	noPrior: number;
	notStubSafe: number;
	ratioTooBig: number;
	oversize: number;
	patchTooBig: number;
	servedFull: number;
	servedWindow: number;
	windowUnchanged: number;
	windowFailOpen: number;
	savedChars: number;
}

export const EMPTY_DELTA_METER: DeltaMeter = {
	considered: 0,
	noPrior: 0,
	notStubSafe: 0,
	ratioTooBig: 0,
	oversize: 0,
	patchTooBig: 0,
	servedFull: 0,
	servedWindow: 0,
	windowUnchanged: 0,
	windowFailOpen: 0,
	savedChars: 0,
};
