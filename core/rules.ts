


export type RuleAction =
	| { kind: 'stats'; pattern: RegExp; template: string }
	| { kind: 'squash'; threshold: number; template: string }
	| { kind: 'strip'; pattern: RegExp }
	| { kind: 'strip-lines'; patterns: RegExp[]; minChars: number }
	| { kind: 'install-summary'; minChars: number; upToDate: RegExp; installed: RegExp }
	| { kind: 'dedup' }
	| { kind: 'error-only'; pattern: RegExp }
	| { kind: 'structure-only' }
	| { kind: 'keep-last-n'; maxLines: number }
	| { kind: 'group-squash'; threshold: number; maxPerFile: number; maxFiles: number }
	| { kind: 'git-status'; maxFiles: number }
	| { kind: 'diff-summary'; maxContextLines: number };

export interface Rule {
	name: string;
	matchTool: RegExp;
	matchCommand?: RegExp;
	action: RuleAction;
	onEmpty?: string;
}

export interface DigestResult {
	text: string | undefined; 
	rule: string | undefined;
	savedChars: number;
}

const DEFAULT_RULES: Rule[] = [
	{
		name: 'git-status',
		
		
		
		matchTool: /^shell_command$/,
		matchCommand: /^git status/,
		action: { kind: 'git-status', maxFiles: 30 },
	},
	{
		name: 'read-squash',
		
		
		
		
		matchTool: /$never$/,
		action: { kind: 'squash', threshold: 2000, template: '[Read: {lines} lines from {path}]' },
	},
	{
		name: 'bash-squash',
		
		
		
		matchTool: /^shell_command$/,
		matchCommand: /^(?!(cat|less|more|head|tail|bat)\b)/,
		action: { kind: 'squash', threshold: 6000, template: '[Bash: exit {code}, {n} chars output]\n{head}' },
	},
	{
		name: 'grep-group',
		
		
		
		matchTool: /^(grep|glob)$/,
		action: { kind: 'group-squash', threshold: 1500, maxPerFile: 3, maxFiles: 20 },
	},
	{
		name: 'dedup',
		
		
		matchTool: /^(shell_command|grep)$/,
		action: { kind: 'dedup' },
	},
	{
		name: 'error-only',
		matchTool: /^(shell_command|npm|pytest)$/,
		matchCommand: /(test|check|lint)/,
		
		
		action: {
			kind: 'error-only',
			pattern: /^(FAIL|Error|error|✗|×|not ok|test result:|.*\bfailed\b.*|.*\bpassed\b.*,.*\bfailed\b.*)/m,
		},
	},
	{
		name: 'install-summary',
		
		matchTool: /^shell_command$/,
		matchCommand: /^(npm|bun|pnpm|yarn|pip|poetry|pip3|uv)\s+(install|i|ci|add|lock|update|sync|pull)\b/,
		action: {
			kind: 'install-summary',
			minChars: 300,
			upToDate: /up to date|No dependencies to install or update|No changes\.|Already up[- ]to[- ]date|nothing to commit/i,
			installed: /added \d+ packages|Installed \d+ packages|Installed \d+ (package|dependency)|Successfully installed|\d+ packages? (installed|added)|Packages installed|All dependencies installed|✓ .* installed|installed [\w@./-]+@[\w.+-]+|Lockfile (up to date|written)|Writing lock file/i,
		},
	},
	{
		name: 'dev-noise-strip',
		
		matchTool: /^shell_command$/,
		matchCommand: /^(npm|bun|pnpm|yarn|cargo|make|pip|poetry|gradle|mvn|dotnet|terraform|tofu|go (build|test|install))\b/,
		action: {
			kind: 'strip-lines',
			patterns: [
				/^\s*(npm|bun|pnpm|yarn) (WARN|notice|warn|info)\s/i,
				/^\s*>\s*[\w@./-]+@/i, 
				/^\s*up to date/i,
				/^\s*found 0 vulnerabilities/i,
				/^\s*(⠹|⠼|⠸|⠙|⠦|⠧|⠇|⠏|✔|✖|⣾|⣽|⣻|⢿|⡿|⣟|⣯|⣷)\s/i, 
				/^\s*(Downloading|Extracting|Fetching|Resolving|Installing|Building)\s/i,
				/^\s*[\d.]+%[^\n]*$/i,
				/^\s*(Compiling|Adding|Removing|Updating)\s+[\w@./-]+\s+/i,
				/^\s*\[\d+\/\d+\]/i, 
				/^\s*(make|makefile)(\[\d+\])?:\s*(Entering|Leaving) directory/i,
			],
			minChars: 400,
		},
	},
	{
		name: 'diff-summary',
		
		
		
		matchTool: /^shell_command$/,
		matchCommand: /(^|\s)(git\s+diff|diff\s|git\s+show)/,
		action: { kind: 'diff-summary', maxContextLines: 30 },
	},
];

export function defaultRules(): Rule[] {
	
	return DEFAULT_RULES.map(r => ({ ...r, matchTool: new RegExp(r.matchTool.source, r.matchTool.flags), action: { ...r.action } as RuleAction }));
}


export function squashOutput(text: string, threshold: number, template: string, vars: Record<string, string | number>): string {
	const lines = text.split('\n').length;
	const chars = text.length;
	if (chars <= threshold) return text;
	let out = template;
	for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
	out = out.replaceAll('{n}', String(chars));
	out = out.replaceAll('{lines}', String(lines));
	return out;
}


export function dedupLines(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const l = lines[i];
		let j = i + 1;
		while (j < lines.length && lines[j] === l) j++;
		const n = j - i;
		out.push(n > 1 ? `${l} (×${n})` : l);
		i = j;
	}
	return out.join('\n');
}







export function effectiveCommand(command: string | undefined): string | undefined {
	if (!command) return command;
	return command
		.replace(/^(?:cd\s+[^;&|]*?|export\s+\S+=\S+|[A-Z_][A-Z0-9_]*=\S+\s*)\s*(?:&&|;|\||\n)/g, '')
		.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, '')
		.replace(/^\s*(?:&&|;|\||\n)\s*/, '')
		.trim();
}

export function applyRule(rule: Rule, toolName: string, command: string | undefined, text: string, vars: Record<string, string | number> = {}): DigestResult {
	if (!rule.matchTool.test(toolName)) return { text: undefined, rule: undefined, savedChars: 0 };
	const cmd = effectiveCommand(command);
	if (rule.matchCommand && cmd !== undefined && !rule.matchCommand.test(cmd)) return { text: undefined, rule: undefined, savedChars: 0 };
	if (rule.matchCommand && cmd === undefined) return { text: undefined, rule: undefined, savedChars: 0 };

	const action = rule.action;
	switch (action.kind) {
		case 'stats': {
			const m = action.pattern.exec(text);
			if (!m) return { text: undefined, rule: undefined, savedChars: 0 };
			let out = action.template;
			for (let i = 1; i < m.length; i++) out = out.replaceAll(`{${i === 1 ? 'n' : 'n'}}`, String(m[i]));
			
			if (m.groups) for (const [k, v] of Object.entries(m.groups)) out = out.replaceAll(`{${k}}`, v ?? '');
			if (out === text) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out, rule: rule.name, savedChars: text.length - out.length };
		}
		case 'squash': {
			const lines = text.split('\n').length;
			const chars = text.length;
			if (chars <= action.threshold) return { text: undefined, rule: undefined, savedChars: 0 };
			
			
			const head = text.split('\n').slice(0, 30).join('\n').slice(0, 2000);
			let out = action.template
				.replaceAll('{n}', String(chars))
				.replaceAll('{lines}', String(lines))
				.replaceAll('{tool}', toolName)
				.replaceAll('{head}', head);
			
			if (vars?.path !== undefined) out = out.replaceAll('{path}', String(vars.path));
			if (vars?.code !== undefined) out = out.replaceAll('{code}', String(vars.code));
			
			out = out.replace(/\{\w+\}/g, '?');
			if (out === text) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out, rule: rule.name, savedChars: chars - out.length };
		}
		case 'strip': {
			const stripped = text.replace(action.pattern, '');
			if (stripped === text) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: stripped, rule: rule.name, savedChars: text.length - stripped.length };
		}
		case 'strip-lines': {
			
			
			if (text.length < action.minChars) return { text: undefined, rule: undefined, savedChars: 0 };
			const kept = text.split('\n').filter(l => {
				if (/vulnerabilit|severity|advisories|advisory|\bCVE-|GHSA-|security/i.test(l)) return true;
				return !action.patterns.some(p => p.test(l));
			});
			const out6 = kept.join('\n');
			if (out6.length === 0 || out6.length >= text.length) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out6, rule: rule.name, savedChars: text.length - out6.length };
		}
		case 'install-summary': {
			
			
			if (text.length < action.minChars) return { text: undefined, rule: undefined, savedChars: 0 };
			const lines7 = text.split('\n');
			const verdicts: string[] = [];
			const security: string[] = [];
			for (const l of lines7) {
				if (/vulnerabilit|severity|advisories|advisory|\bCVE-|GHSA-|security/i.test(l)) {
					
					if (!/\b0\s+vulnerabilit/i.test(l)) {
						security.push(l.trim());
					}
					continue;
				}
				if (action.upToDate.test(l)) verdicts.push('ok (up to date)');
				else if (action.installed.test(l)) verdicts.push(l.trim());
			}
			const parts = [...new Set(verdicts)];
			if (security.length > 0) parts.push(...security);
			if (parts.length === 0) return { text: undefined, rule: undefined, savedChars: 0 };
			const out7 = parts.join('\n');
			if (out7.length >= text.length) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out7, rule: rule.name, savedChars: text.length - out7.length };
		}
		case 'dedup': {
			const deduped = dedupLines(text);
			if (deduped === text) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: deduped, rule: rule.name, savedChars: text.length - deduped.length };
		}
		case 'error-only': {
			const lines2 = text.split('\n');
			const kept = lines2.filter(l => action.pattern.test(l));
			if (kept.length === 0 || kept.length === lines2.length) return { text: undefined, rule: undefined, savedChars: 0 };
			const out = kept.join('\n');
			return { text: out, rule: rule.name, savedChars: text.length - out.length };
		}
		case 'structure-only': {
			
			try {
				const parsed = JSON.parse(text);
				const summarize = (v: unknown): unknown => {
					if (v === null) return 'null';
					if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${typeof v[0]}]`;
					if (typeof v === 'object') {
						const o: Record<string, unknown> = {};
						for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = summarize(val);
						return o;
					}
					return typeof v;
				};
				const out = JSON.stringify(summarize(parsed));
				if (out === text) return { text: undefined, rule: undefined, savedChars: 0 };
				return { text: out, rule: rule.name, savedChars: text.length - out.length };
			} catch {
				return { text: undefined, rule: undefined, savedChars: 0 };
			}
		}
		case 'keep-last-n': {
			const lines3 = text.split('\n');
			
			if (lines3[lines3.length - 1] === '') lines3.pop();
			if (lines3.length <= action.maxLines) return { text: undefined, rule: undefined, savedChars: 0 };
			const kept = lines3.slice(-action.maxLines);
			const out = `${kept.join('\n')}\n[${lines3.length - kept.length} more lines]`;
			return { text: out, rule: rule.name, savedChars: text.length - out.length };
		}
		case 'group-squash': {
			
			
			
			
			const lines4 = text.split('\n');
			const chars4 = text.length;
			if (chars4 <= action.threshold) return { text: undefined, rule: undefined, savedChars: 0 };
			
			
			const matchRe = /^([^:]+):(\d+):(.*)$/;
			const byFile = new Map<string, string[]>();
			let totalMatches = 0;
			for (const l of lines4) {
				const m = matchRe.exec(l);
				if (!m) continue;
				totalMatches++;
				if (byFile.size > action.maxFiles) continue;
				const file = m[1];
				const arr = byFile.get(file) ?? [];
				if (arr.length < action.maxPerFile) {
					arr.push(l.slice(0, 200));
					byFile.set(file, arr);
				}
			}
			if (totalMatches === 0) return { text: undefined, rule: undefined, savedChars: 0 };
			const outLines: string[] = [`[Search results: ${totalMatches} matches in ${byFile.size} files]`];
			for (const [file, matches] of byFile) {
				outLines.push(`  ${file}:`);
				for (const m of matches) outLines.push(`    ${m}`);
			}
			const out4 = outLines.join('\n');
			return { text: out4, rule: rule.name, savedChars: chars4 - out4.length };
		}
		case 'git-status': {
			
			
			
			
			
			const lines5 = text.split('\n');
			const files: string[] = [];
			let branch = '';
			let extra = 0;
			for (const l of lines5) {
				const t = l.trim();
				if (!t) continue;
				
				if (/^## /.test(t)) { branch = t.slice(3).trim().split('...')[0]; continue; }
				
				if (/^On branch /.test(t)) { branch = t.slice(10).trim(); continue; }
				
				const m = /^([ MADRCU?!]{1,2})\s+(.+)$/.exec(t);
				if (m) {
					if (files.length < action.maxFiles) files.push(`${m[1].trim() || '??'} ${m[2]}`);
					else extra++;
					continue;
				}
				
				
				const lm = /^(modified|new file|deleted|renamed|typechange|untracked):\s+(.+)$/.exec(t);
				if (lm) {
					if (files.length < action.maxFiles) files.push(`${lm[1]} ${lm[2].split(' -> ')[0]}`);
					else extra++;
					continue;
				}
				
				if (/^(Untracked files|Changes to be committed|Changes not staged for commit|no changes added|Your branch|use "git)/.test(t)) continue;
				
				if (/^\(use |^\(git /.test(t)) continue;
				extra++;
			}
			if (files.length === 0 && !branch) return { text: undefined, rule: undefined, savedChars: 0 };
			const out5 = [
				...(branch ? [`branch: ${branch}`] : []),
				...files,
				...(extra > 0 ? [`[${extra} more entries]`] : []),
			].join('\n');
			if (out5.length >= text.length) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out5, rule: rule.name, savedChars: text.length - out5.length };
		}
		case 'diff-summary': {
			
			
			
			
			if (text.length < 600) return { text: undefined, rule: undefined, savedChars: 0 };
			const lines8 = text.split('\n');
			const out8: string[] = [];
			let ctxKept = 0;
			let ctxSkipped = 0;
			for (const l of lines8) {
				if (/^@@ /.test(l) || /^[+-]/.test(l) || /^<<<<<<<|^=======|^>>>>>>>/.test(l) || /^diff --git|^index |^--- |^\+\+\+ /.test(l)) {
					
					if (ctxSkipped > 0) out8.push(`  …[${ctxSkipped} context lines]`);
					ctxSkipped = 0;
					ctxKept = 0;
					out8.push(l);
					continue;
				}
				if (/^ /.test(l)) {
					
					
					if (ctxKept < action.maxContextLines) {
						out8.push(l);
						ctxKept++;
						ctxSkipped = 0;
					} else {
						ctxSkipped++;
					}
					continue;
				}
				
				out8.push(l);
			}
			if (ctxSkipped > 0) out8.push(`  …[${ctxSkipped} context lines]`);
			const out8t = out8.join('\n');
			if (out8t.length >= text.length) return { text: undefined, rule: undefined, savedChars: 0 };
			return { text: out8t, rule: rule.name, savedChars: text.length - out8t.length };
		}
	}
}


export function digestToolOutput(
	toolName: string,
	command: string | undefined,
	text: string,
	opts: { rules?: Rule[]; isError?: boolean; activeFilePaths?: Set<string>; path?: string; code?: number } = {},
): DigestResult {
	if (!text) return { text: undefined, rule: undefined, savedChars: 0 };
	if (opts.isError) {
		
		const lines = text.split('\n');
		const kept = lines.filter(l => /error|fail|✗|×|not ok/i.test(l)).slice(0, 20);
		const body = kept.length > 0 ? kept.join('\n') : text.slice(0, 2000);
		return { text: `[tool failed — ${body.length} chars]\n${body}`, rule: 'failure-focus', savedChars: 0 };
	}
	if (opts.path && opts.activeFilePaths?.has(opts.path)) {
		return { text: undefined, rule: undefined, savedChars: 0 }; 
	}
	const vars: Record<string, string | number> = {};
	if (opts.path !== undefined) vars.path = opts.path;
	if (opts.code !== undefined) vars.code = opts.code;
	const rules = opts.rules ?? defaultRules();
	for (const rule of rules) {
		const res = applyRule(rule, toolName, command, text, vars);
		if (res.text !== undefined) return res;
	}
	return { text: undefined, rule: undefined, savedChars: 0 };
}
