




const RESET = '\x1b[0m';

function rgb(r: number, g: number, b: number) {
	return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}


export const flexoki = {
	bold: (s: string) => `\x1b[1m${s || ''}\x1b[22m`,
	underline: (s: string) => `\x1b[4m${s || ''}\x1b[24m`,
	text: rgb(206, 205, 195),
	muted: rgb(87, 86, 83),
	blue: rgb(67, 133, 190),
	cyan: rgb(58, 169, 159),
	purple: rgb(139, 126, 200),
	green: rgb(135, 154, 57),
	red: rgb(209, 77, 65),
	orange: rgb(218, 112, 44),
	lightBlue: rgb(91, 155, 213),
	yellow: rgb(208, 162, 21),
};

export const c = {
	yellow: (s: string) => `\x1b[93m${s || ''}\x1b[39m`,
	green: (s: string) => `\x1b[32m${s || ''}\x1b[39m`,
	red: (s: string) => `\x1b[31m${s || ''}\x1b[39m`,
	cyan: (s: string) => `\x1b[36m${s || ''}\x1b[39m`,
	dim: (s: string) => `\x1b[2m${s || ''}\x1b[22m`,
};




export function cleanLen(s: string): number {
	const stripped = (s || '')
		.replace(/\x1b\[[0-9;]*m/g, '')
		.replace(/\x1b\]8;;.*?\x1b\\/g, '');
	let len = 0;
	for (const char of stripped) {
		const code = char.codePointAt(0) || 0;
		
		if ((code >= 0x1f300 && code <= 0x1f9ff) || (code >= 0x2600 && code <= 0x27bf)) {
			len += 2;
		} else {
			len += 1;
		}
	}
	return len;
}


export function visualPadEnd(s: string, targetWidth: number): string {
	const diff = targetWidth - cleanLen(s);
	return s + ' '.repeat(Math.max(0, diff));
}















export function asciiPanel(title: string = '', lines: string[] = [], crumbs: string[] = []): string {
	const safeTitle = title || '';
	const safeLines = (lines || []).map(l => l || '');
	const safeCrumbs = crumbs || [];

	const crumbStr = safeCrumbs.length > 0 ? '> ' + safeCrumbs.join(' > ') : '';

	const maxLen = Math.max(
		cleanLen(safeTitle) + 2,
		...safeLines.map(l => cleanLen(l)),
		cleanLen(crumbStr),
	);
	const width = Math.max(54, maxLen + 4);
	const innerW = width - 4;

	const topBorder = '╔' + '═'.repeat(width - 2) + '╗';
	const titleLine = '║ ' + visualPadEnd(safeTitle, innerW) + ' ║';
	const titleSep = '╠' + '═'.repeat(width - 2) + '╣';
	const crumbLine = crumbStr ? '│ ' + visualPadEnd(c.yellow(crumbStr), innerW) + ' │' : null;
	const crumbSep = crumbStr ? '├' + '─'.repeat(width - 2) + '┤' : null;
	const body = safeLines.map(line => '│ ' + visualPadEnd(line, innerW) + ' │');
	const botBorder = '╚' + '═'.repeat(width - 2) + '╝';

	const parts: string[] = [topBorder, titleLine, titleSep];
	if (crumbLine && crumbSep) parts.push(crumbLine, crumbSep);
	parts.push(...body, botBorder);

	
	const bgOpen = '\x1b[48;2;16;15;15m';
	const fgOpen = '\x1b[38;2;206;205;195m';
	return parts.map(line => fgOpen + bgOpen + line + RESET).join('\n');
}


export function centerBox(boxStr: string = '', indentSpaces: number = 4): string {
	const indent = ' '.repeat(indentSpaces);
	return (boxStr || '').split('\n').map(line => indent + line).join('\n');
}
