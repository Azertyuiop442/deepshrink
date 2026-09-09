




export type ContentType = 'json' | 'log' | 'search' | 'code' | 'diff' | 'text';

export interface DetectResult {
	type: ContentType;
	confidence: number;
}


function isLogLine(line: string): boolean {
	const t = line.trim();
	if (!t) return false;
	if (/\b(ERROR|FAIL|WARN|INFO|DEBUG|TRACE)\b/.test(t)) return true;
	if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(t)) return true;
	if (/^\[\d{2}:\d{2}:\d{2}\]/.test(t)) return true;
	if (/\b(PASSED|FAILED|ok|not ok)\b/.test(t)) return true;
	if (/^(npm ERR!|Traceback|panic:)/.test(t)) return true;
	
	
	if (/^at [\w$./<>-]+\s*\(.*\)$/.test(t)) return true;
	if (/^File ".*", line \d+/.test(t)) return true;
	if (/^raise [\w.]+/.test(t)) return true;
	if (/^Traceback \(/.test(t)) return true;
	return false;
}


function isCodeLine(line: string): boolean {
	const t = line.trim();
	if (!t) return false;
	
	if (/^at [\w$./<>-]+\s*\(.*\)$/.test(t)) return false;
	if (/^File ".*", line \d+/.test(t)) return false;
	if (/^raise [\w.]+/.test(t)) return false;
	if (/^(import |export |from |require\(|const |let |var |function |class |interface |type |def |fn |func |pub |impl )/.test(t)) return true;
	if (/[{};]$/.test(t) && /[=()]/.test(t)) return true;
	if (/^\s{2,}/.test(line) && /[=;{}()[\],<>]/.test(t)) return true;
	return false;
}


function isSearchLine(line: string): boolean {
	return /^[^\s:]+:\d+:/.test(line) || /^[^\s:]+:\d+:\d+/.test(line);
}

export function detectType(text: string): DetectResult {
	if (!text || text.trim() === '') return { type: 'text', confidence: 0.5 };
	const trimmed = text.trim();

	try {
		const parsed = JSON.parse(trimmed);
		if (parsed !== null && typeof parsed === 'object') {
			return { type: 'json', confidence: Array.isArray(parsed) ? 0.9 : 0.8 };
		}
	} catch {  }

	
	if (/^diff --git|^--- a\/|^@@ -\d+,\d+ \+\d+,\d+ @@/.test(trimmed)) {
		return { type: 'diff', confidence: 0.85 };
	}

	const lines = text.split('\n').filter((l) => l.trim() !== '');
	if (lines.length === 0) return { type: 'text', confidence: 0.5 };

	let log = 0;
	let code = 0;
	let search = 0;
	for (const line of lines) {
		if (isLogLine(line)) log++;
		if (isCodeLine(line)) code++;
		if (isSearchLine(line)) search++;
	}
	const n = lines.length;
	const logRatio = log / n;
	const codeRatio = code / n;
	const searchRatio = search / n;

	if (logRatio >= 0.5) return { type: 'log', confidence: Math.min(1, 0.5 + logRatio * 0.5) };
	if (searchRatio >= 0.3) return { type: 'search', confidence: Math.min(1, 0.4 + searchRatio * 0.6) };
	if (codeRatio >= 0.3) return { type: 'code', confidence: Math.min(1, 0.5 + codeRatio * 0.5) };
	return { type: 'text', confidence: 0.5 };
}


export function routeCompression(text: string): { type: ContentType; candidate: 'json' | 'stacktrace' | 'digest' | 'prose' | 'none' } {
	const { type } = detectType(text);
	switch (type) {
		case 'json':
			
			
			return { type, candidate: 'json' };
		case 'log':
			return { type, candidate: 'stacktrace' };
		case 'search':
		case 'diff':
		case 'code':
			return { type, candidate: 'digest' };
		default:
			return { type, candidate: 'prose' };
	}
}
