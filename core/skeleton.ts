


export interface SkeletonResult {
	text: string;
	wasCompressed: boolean;
	compressionRatio: number;
	linesSkeleton: number;
	linesOriginal: number;
}


const SIGNATURE_LINE_RE = /^\s*((?:export\s+|default\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|func\s+|fn\s+|def\s+|var\s+|const\s+|let\s+)*[A-Za-z_0-9\[\]\*\.<>\?\s]*[A-Za-z_0-9]+\s*\([^)]*\)(?:\s*:\s*[A-Za-z_0-9\[\]\*\.<>\?\s]+)?(?:\s*->\s*[A-Za-z_0-9\[\]\*\.<>\?\s]+)?)(\s*\{)\s*$/;
const RUST_FN_RE = /^\s*((?:pub\s+)?fn\s+[A-Za-z_0-9]+\s*\([^)]*\)(?:\s*->\s*[^{]+)?)(\s*\{)\s*$/;
const GO_FUNC_RE = /^\s*((?:func\s+(?:\([^)]*\)\s+)?[A-Za-z_0-9]+\s*\([^)]*\)(?:\s*[A-Za-z_0-9\[\]\*\s]+)?))(\s*\{)\s*$/;

const HEADER = '# [TOKEN-GUARD: Compressed — structural skeleton only]';

const C_STYLE = new Set(['js', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'cs', 'rust', 'rs', 'go', 'swift', 'kt', 'php', 'scala']);

export function isCStyle(ext: string): boolean {
	return C_STYLE.has(ext.toLowerCase());
}


export function findMatchingBrace(text: string, openIdx: number): number {
	let depth = 0;
	let inString: string | null = null;
	let escape = false;
	for (let i = openIdx; i < text.length; i++) {
		const ch = text[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (ch === '\\' && inString) {
			escape = true;
			continue;
		}
		if (inString) {
			
			
			
			
			
			if (inString === '`' && ch === '$' && text[i + 1] === '{') {
				depth++;
				inString = null;
				i++; 
				continue;
			}
			if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			inString = ch;
			continue;
		}
		if (ch === '{' && !inString) depth++;
		else if (ch === '}' && !inString) {
			if (depth === 1 && text[i + 1] === '`' && text.slice(i - 1, i) !== '$') {
				
				inString = '`';
				depth--;
				continue;
			}
			depth--;
			if (depth === 0) return i;
		}
	}
	return text.length - 1;
}


function matchSignatureLine(line: string): string | null {
	line = line.trimEnd();
	for (const re of [RUST_FN_RE, GO_FUNC_RE, SIGNATURE_LINE_RE]) {
		re.lastIndex = 0;
		const m = re.exec(line);
		if (m) return m[1].trim();
	}
	return null;
}


export function skeletonizeCStyle(code: string, ext: string): SkeletonResult {
	if (!isCStyle(ext)) {
		return { text: code, wasCompressed: false, compressionRatio: 0, linesSkeleton: code.split('\n').length, linesOriginal: code.split('\n').length };
	}
	const lines = code.split('\n');
	const originalLines = lines.length;
	const out: string[] = [HEADER];
	let compressedChars = 0;

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const sig = matchSignatureLine(line);
		if (sig === null) {
			out.push(line);
			i++;
			continue;
		}
		
		let openIdx = code.indexOf('{', lineStartOffset(lines, i));
		if (openIdx < 0) {
			out.push(line);
			i++;
			continue;
		}
		const closeIdx = findMatchingBrace(code, openIdx);
		
		const closeLine = lineIndexAt(code, closeIdx);
		const bodyLines = closeLine - i;
		if (bodyLines > 0) {
			
			const closeLineText = lines[closeLine];
			const closeBraceOnly = closeLineText.trim() === '}' || closeLineText.trimEnd().endsWith('}');
			out.push(`${sig} { ... }`);
			compressedChars += Math.max(0, closeIdx - openIdx - 1);
			i = closeLine + 1;
			void closeBraceOnly;
		} else {
			
			out.push(line);
			i++;
		}
	}

	const skeletonLines = out.length;
	const wasCompressed = compressedChars > 0 && skeletonLines < originalLines;
	return {
		text: out.join('\n'),
		wasCompressed,
		compressionRatio: 1 - skeletonLines / Math.max(1, originalLines),
		linesSkeleton: skeletonLines,
		linesOriginal: originalLines,
	};
}

function lineStartOffset(lines: string[], lineIdx: number): number {
	let off = 0;
	for (let i = 0; i < lineIdx; i++) off += lines[i].length + 1;
	return off;
}

function lineIndexAt(code: string, charIdx: number): number {
	let line = 0;
	for (let i = 0; i < charIdx && i < code.length; i++) {
		if (code[i] === '\n') line++;
	}
	return line;
}


export function skeletonize(code: string, ext: string): SkeletonResult {
	try {
		return skeletonizeCStyle(code, ext);
	} catch {
		return { text: code, wasCompressed: false, compressionRatio: 0, linesSkeleton: code.split('\n').length, linesOriginal: code.split('\n').length };
	}
}
