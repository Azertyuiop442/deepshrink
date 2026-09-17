export interface SymbolMatch {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	text: string;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defRegexes(name: string): Array<{ re: RegExp; kind: string; indent: boolean }> {
	const n = escapeRegExp(name);
	return [
		{ re: new RegExp(`(^|[^\\w$])(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${n}\\b`), kind: 'function', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(export\\s+)?(abstract\\s+)?class\\s+${n}\\b`), kind: 'class', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(export\\s+)?interface\\s+${n}\\b`), kind: 'interface', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(export\\s+)?type\\s+${n}\\b`), kind: 'type', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(export\\s+)?(const|let|var)\\s+${n}\\b`), kind: 'const', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(pub(\\([^)]*\\))?\\s+)?(async\\s+)?fn\\s+${n}\\b`), kind: 'fn', indent: false },
		{ re: new RegExp(`(^|[^\\w$])(pub(\\([^)]*\\))?\\s+)?(struct|enum|trait)\\s+${n}\\b`), kind: 'struct', indent: false },
		{ re: new RegExp(`(^|[^\\w$])def\\s+${n}\\b`), kind: 'def', indent: true },
		{ re: new RegExp(`(^|[^\\w$])class\\s+${n}\\b`), kind: 'class', indent: true },
		{ re: new RegExp(`(^|[^\\w$])func\\s+(\\([^)]*\\)\\s*)?${n}\\b`), kind: 'func', indent: false },
	];
}

function leadingSpaces(line: string): number {
	let n = 0;
	for (const ch of line) {
		if (ch === ' ') n++;
		else if (ch === '\t') n += 4;
		else break;
	}
	return n;
}

export function extractSymbol(content: string, name: string, maxLines = 160): SymbolMatch | undefined {
	if (!content || !name) return undefined;
	const lines = content.split('\n');
	const regexes = defRegexes(name);
	const cap = Math.max(1, maxLines);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.includes(name)) continue;
		for (const def of regexes) {
			if (!def.re.test(line)) continue;
			let end = i;
			if (def.indent) {
				const base = leadingSpaces(line);
				for (let j = i + 1; j < Math.min(lines.length, i + cap); j++) {
					const l = lines[j];
					if (l.trim() === '') {
						end = j;
						continue;
					}
					if (leadingSpaces(l) > base) {
						end = j;
						continue;
					}
					break;
				}
			} else {
				let depth = 0;
				let started = false;
				for (let j = i; j < Math.min(lines.length, i + cap); j++) {
					const l = lines[j];
					for (const ch of l) {
						if (ch === '{') {
							depth++;
							started = true;
						} else if (ch === '}') {
							depth--;
						}
					}
					end = j;
					if (started && depth <= 0) break;
					if (!started && j > i + 2) break;
					if (!started && /;\s*$/.test(l)) break;
				}
			}
			return {
				name,
				kind: def.kind,
				startLine: i + 1,
				endLine: end + 1,
				text: lines.slice(i, end + 1).join('\n'),
			};
		}
	}
	return undefined;
}
