



import type { ModApi } from '../harness.d.ts';
import { Executor, type ExecutorHost } from '../runtime/executor.ts';
import { ConfigStore } from '../runtime/config-store.ts';
import { EventLog } from '../runtime/log.ts';
import { DiskStore, SessionRegistry } from '../runtime/store.ts';
import { asciiPanel, centerBox, flexoki } from '../runtime/ui.ts';
import { HAND_PRICING, PricingCache, fetchCCPricing, fetchOpenRouterPricing } from '../core/pricing.ts';
import { isDashboardLive, pushModals, clearModals, resetBridgeOnStartup, startPickupWatcher, pushEnabled, pushProgress, type BridgeModal } from '../runtime/bridge.ts';

const MOD_ID = 'deepshrink';












async function appendModMessage(cmd: ModApi, customType: string, note: string): Promise<void> {
	try {
		const seam = cmd.session?.appendCustomMessageEntry;
		if (typeof seam !== 'function') {
			
			
			cmd.showEntry?.('deepshrink/decision', { line: `${customType}: message injection unavailable (runtime seam missing)` });
			return;
		}
		await seam.call(cmd.session, {
			customType,
			content: note.slice(0, 400),
			display: `deepshrink · ${customType.split('/').pop()}`,
		});
	} catch {
		
		cmd.showEntry?.('deepshrink/decision', { line: `${customType}: message injection failed` });
	}
}


function panel(title: string, raw: string): string {
	const lines = (raw || '')
		.split('\n')
		.map(l => l.trimEnd())
		.filter(l => l !== '');
	return '\n' + centerBox(asciiPanel(flexoki.bold(flexoki.cyan(title)), lines));
}

function badge(enabled: boolean): string {
	return enabled ? `${flexoki.green('●')} ${flexoki.bold('ON')}` : `${flexoki.red('●')} ${flexoki.bold('OFF')}`;
}
import type { LogLevel } from '../core/config.ts';
import { existsSync } from 'node:fs';

const getDir = () => process.env.DEEPSHRINK_DATA_DIR || `${process.env.HOME ?? ''}/.commandcode/mods/deepshrink/data/deepshrink`;

export default function deepshrinkMod(cmd: ModApi): void {
	const dir = getDir();
	const configStore = new ConfigStore(dir);
	const store = new DiskStore(dir);
	const registry = new SessionRegistry(`${dir}/sessions.json`);

	const host: ExecutorHost = {
		notify: m => cmd.ui.notify(m),
		select: async (title, options) => {
			if (!cmd.ui.select) return null;
			const result = await cmd.ui.select({ title, options });
			if (result === null || result === undefined) return null;
			if (typeof result === 'string') {
				const byValue = options.find(o => o.value === result);
				if (byValue) return byValue.value;
				const byLabel = options.find(o => o.label === result);
				if (byLabel) return byLabel.value;
				const idx = parseInt(result, 10) - 1;
				if (!isNaN(idx) && options[idx]) return options[idx].value;
				const lower = result.toLowerCase();
				const byKeyword = options.find(o => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower));
				if (byKeyword) return byKeyword.value;
				return result;
			}
			if (typeof result === 'number') {
				if (options[result - 1]) return options[result - 1].value;
				return null;
			}
			if (typeof result === 'object' && result && 'value' in result) return result.value;
			return null;
		},
		showEntry: (customType, data) => cmd.showEntry?.(customType, data),
		exec: async o => cmd.exec(o),
		confirm: async o => (cmd.ui.confirm ? cmd.ui.confirm(o) : true),
	};

	let sessionId = (process.env.COMMANDCODE_SESSION_ID ?? '').slice(0, 12) || 'unknown';

	const PRICING_CACHE_FILE = `${dir}/pricing.json`;
	const pricing = new PricingCache(HAND_PRICING, async () => {
		const filterIds = HAND_PRICING.models.map(m => m.id);
		let fresh = await fetchCCPricing(Date.now(), filterIds);
		if (!fresh) {
			fresh = await fetchOpenRouterPricing(Date.now(), filterIds);
		}
		if (fresh) {
			try {
				const { mkdirSync, writeFileSync } = await import('node:fs');
				mkdirSync(dir, { recursive: true });
				writeFileSync(PRICING_CACHE_FILE, JSON.stringify(fresh), 'utf8');
			} catch {}
		}
		return fresh;
	});

	(async () => {
		try {
			const { readFileSync } = await import('node:fs');
			const cached = JSON.parse(readFileSync(PRICING_CACHE_FILE, 'utf8'));
			pricing.seed(cached);
		} catch {}
		void pricing.refresh();
	})();

	const executor = new Executor(
		{
			dir,
			configStore,
			pricing,
			createLog: (sid, level) => new EventLog(`${dir}/events`, sid, level),
			store,
			registry,
			host,
		},
		{ sessionId, workspace: process.cwd() },
	);

	
	
	let pendingElides: Array<{ tool: string; key: string; ref: string; bytes: number }> = [];
	let lastKnownState: any = null;

	
	cmd.addRenderer('deepshrink/decision', (data: { line?: string }) => {
		const line = data?.line ?? '';
		return [`${flexoki.bold(flexoki.cyan('[deepshrink]'))} ${line}`];
	});

	
	
	
	
	
	cmd.addRenderer('deepshrink/elide', (data: { items?: Array<{ tool: string; key: string; ref: string; bytes: number }> }) => {
		const items = data?.items ?? [];
		const count = items.length;
		const header = `╭─ ${flexoki.bold(flexoki.cyan('deepshrink'))} ${flexoki.muted('· recall')} ${flexoki.muted(count > 1 ? `(${count} calls)` : '(1 call)')} ─╮`;
		const body = items.slice(0, 6).map((it) => {
			const short = it.key.length > 52 ? it.key.slice(0, 52) + '…' : it.key;
			return `│ ${flexoki.cyan(it.tool)}: ${short}`;
		});
		if (count > 6) body.push(`│ ${flexoki.muted(`… and ${count - 6} more`)}`);
		const footer = `╰─ ${flexoki.muted(`${items.reduce((s, i) => s + i.bytes, 0)} chars from store`)} ─╯`;
		return [header, ...body, footer];
	});

	
	
	
	
	
	
	const DASH_CFG = "/tmp/cc-sidebar/config.json";
	const DASH_OUT = "/tmp/cc-sidebar/deepshrink-out.json";
	const applyDashboardConfig = async () => {
		try {
			const { readFileSync } = await import("node:fs");
			
			if (existsSync(DASH_CFG)) {
				const parsed = JSON.parse(readFileSync(DASH_CFG, "utf-8"));
				if (typeof parsed.deepshrink === "boolean" && parsed.deepshrink !== executor.config.enabled) {
					await executor.setEnabled(parsed.deepshrink);
					pushEnabled(MOD_ID, parsed.deepshrink);
				}
			}
			
			if (existsSync(DASH_OUT)) {
				const out = JSON.parse(readFileSync(DASH_OUT, "utf-8"));
				await executor.applySettings(out);
			}
		} catch {}
	};
	void applyDashboardConfig();
	
	const pushState = () => pushEnabled(MOD_ID, executor.config.enabled);
	pushState();
	setInterval(() => {
		void applyDashboardConfig();
		pushState();
	}, 5_000);

	
	cmd.hooks({
		onSessionStart: async (opts?: any) => {
			if (opts?.sessionId) executor.setSessionId(opts.sessionId);
			await executor.onSessionStart(opts?.source ?? 'startup');
		},
		onSessionEnd: async () => {
			await executor.onSessionEnd();
		},
		afterToolCall: async (opts?: any) => {
			try {
				const toolName = String(opts?.toolName ?? '');
				executor.markFollowedBy(toolName);
				const res = await executor.afterToolCall({
					toolName,
					input: opts?.input,
					content: opts?.result ?? opts?.content, 
					isError: opts?.isError,
				});
				return res;
			} catch {
				executor.onLayerFailure('digest');
				return undefined;
			}
		},
		
		
		
		
		
		
		beforeToolCall: async (opts?: any) => {
			try {
				const toolName = String(opts?.toolName ?? '');
				const input = opts?.input ?? {};
				const hit = await executor.toolHit(toolName, input);
				if (!hit) return undefined;
				if (hit.stale) return undefined; 
				
				
				
				
				const key = toolName === 'shell_command'
					? String(input.command ?? '')
					: String(input.file_path ?? input.path ?? input.file ?? '');
				
				const isWindowed = toolName === 'read_file' && (input.offset !== undefined || input.limit !== undefined);
				pendingElides.push({ tool: isWindowed ? 'window-slice' : toolName, key, ref: hit.ref, bytes: hit.content.length });
				
				
				
				
				
				const budget = hit.fidelityServe ? executor.fidelityServeCap : executor.config.recallBudgetChars;
				const content = hit.content.length <= budget
					? hit.content
					: hit.content.slice(0, budget) + `\n…[view trimmed to ${budget} chars — full blob ${hit.ref}]`;
				const note = `[deepshrink] ${toolName} with this exact input was already executed before — returning stored output (${hit.content.length} chars, ${hit.ref}, ${Math.round(hit.ageMs / 1000)}s old) instead of re-running:\n${content}`;
				
				
				
				
				
				
				return {
					input: { ...input, command: `echo ${JSON.stringify('[deepshrink elided]')}` },
					additionalContext: note,
				};
			} catch {
				executor.onLayerFailure('digest');
				return undefined;
			}
		},
		transformContext: async (opts?: any) => {
			try {
				
				const messages = opts?.messages;
				if (!Array.isArray(messages)) return messages;
				const res = await executor.transformContext({ messages });
				if (!res || !Array.isArray(res.messages) || res.messages.length === messages.length) {
					return messages; 
				}
				return res.messages;
			} catch {
				executor.onLayerFailure('view');
				return opts?.messages;
			}
		},
		onTurnEnd: async (opts?: any) => {
			await executor.onTurnEnd();
			
			
			if (pendingElides.length > 0) {
				try {
					cmd.showEntry?.('deepshrink/elide', { items: pendingElides });
					console.log(`[deepshrink] elide-flush: ${pendingElides.length} call(s) shown`);
				} catch (e) {
					console.error(`[deepshrink] elide-flush FAILED: ${e}`);
				}
				pendingElides = [];
			}
			return opts?.state ?? lastKnownState;
		},
		onRunEnd: async () => {
			await executor.flushLog();
		},
	});

	
	cmd.on('compaction_start', () => executor.onCompactionStart());
	cmd.on('compaction_done', async () => {
		const note = await executor.onCompactionDone();
		if (note) await appendModMessage(cmd, 'deepshrink/state', note);
	});
	cmd.on('model_request_end', (opts?: any) => {
		const usage = opts?.usage ?? opts ?? {};
		executor.onUsage({
			inputTokens: pick(usage, 'input_tokens', 'inputTokens', 'input', 'promptTokens', 'prompt_tokens'),
			outputTokens: pick(usage, 'output_tokens', 'outputTokens', 'output', 'completionTokens', 'completion_tokens'),
			cacheRead: pick(usage, 'cache_read_input_tokens', 'cacheReadInputTokens', 'cacheReadTokens', 'cache_read', 'cacheRead'),
			model: opts?.model,
		});
	});

	
	
	
	
	
	
	let bootstrapInjected = false;
	cmd.on('session_start', (opts?: any) => {
		if (opts?.sessionId) executor.setSessionId(opts.sessionId);
		if (bootstrapInjected) return;
		bootstrapInjected = true;
		void (async () => {
			try {
				const note = await executor.storeBootstrap();
				if (note) await appendModMessage(cmd, 'deepshrink/memory', note);
			} catch {}
		})();
	});
	
	cmd.on('run_start', (opts?: any) => {
		if (opts?.sessionId) {
			sessionId = opts.sessionId;
			executor.setSessionId(opts.sessionId);
		}
	});

	
	cmd.addTool({
		schema: {
			name: 'deepshrink_recall',
			description: 'Search the local DeepSkrin store — a persistent cache of tool outputs (read_file, grep, shell) from THIS workspace, kept ACROSS sessions. Before re-reading a file or re-running a command, call this FIRST with the FILE PATH, a FUNCTION NAME, or a distinctive phrase (e.g. "src/pane.rs", "fn session_resumable"). Returns matching snippets with a confidence score (0-100). Use a hit with a high score instead of re-reading; a STALE hit (content changed) means re-read the source. No match → the store has nothing for that query — proceed with the normal tool. Do NOT call it before write tools (edit_file, write_file) or tools needing live state (git status, git diff, fresh runs). Web results are volatile — re-search when the discovery matters. Scoped to the current workspace.',
			input_schema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'regex to match against stored tool outputs (case-insensitive). Prefer a distinctive word or short phrase, e.g. "TARGET_MARKER" or "fn parse_config"' },
					limit: { type: 'number', description: 'max hits (default 5)' },
					fullContent: { type: 'boolean', description: 'OPT-IN — when true, return the ENTIRE blob for fresh full-file reads (≤ 24K chars) instead of a snippet around the match. Use when you need the whole file, not just the match context.' },
				},
				required: ['query'],
			},
		},
		readOnly: true,
		run: async ({ input }) => {
			const query = typeof input.query === 'string' ? input.query : '';
			const limit = typeof input.limit === 'number' ? Math.min(10, Math.max(1, input.limit)) : 5;
			const fullContent = input.fullContent === true;
			const { hits, total, staleHints } = await executor.recall(query, limit, { fullContent });
			if (hits.length === 0 && staleHints.length === 0) {
				return { ok: true, content: [{ type: 'text', text: 'No matching blobs.' }] };
			}
			const body = hits
				.map(h => {
					const conf = h.stale
						? ` ⚠ STALE (${h.score}% — ${(h.flags ?? []).join(', ')})`
						: h.score !== undefined
							? ` ✓ confiance ${h.score}%${h.flags?.length ? ` (${h.flags.join(', ')})` : ''}`
							: '';
					return `${h.ref}${conf}\n${h.content}`;
				})
				.join('\n\n---\n\n');
			const staleBody = staleHints
				.map(h => `${h.ref} ⚠ STALE (${h.score}% — ${h.reason}) — re-read the source, content not shown`)
				.join('\n');
			return {
				ok: true,
				content: [{ type: 'text', text: `${total} match(es).\n\n${body}${staleBody ? `\n\n---\n\n${staleBody}` : ''}` }],
			};
		},
	});

	
	cmd.addCommand({
		name: 'deepshrink',
		description: 'DeepSkrin · status, stats, recall, store, logs, config, clean, help (menu)',
		argumentHint: '[status|stats|recall <q>|store|logs|config|clean|help]',
		handler: async ({ args }) => {
			const action = args.trim().split(/\s+/)[0] ?? '';
			const rest = args.trim().slice(action.length).trim();
			const dash = isDashboardLive();
			switch (action) {
				case 'status': return pushInfoModal('DEEPSKRIN STATUS', await executor.cmdStatus(), dash);
				case 'stats': return pushInfoModal('DEEPSKRIN STATS', await executor.cmdStats(), dash);
				case 'recall': return pushInfoModal('DEEPSKRIN RECALL', await executor.cmdRecall(rest), dash);
				case 'store': return pushInfoModal('DEEPSKRIN STORE', await executor.cmdStore(), dash);
				case 'logs': return pushInfoModal('DEEPSKRIN LOG', await executor.cmdLogs(), dash);
				case 'config': return pushConfigModal(dash, executor);
				case 'help': return pushInfoModal('DEEPSKRIN HELP', await executor.cmdHelp(), dash);
				case 'gc': {
					const res = await executor.runGc(true);
					return pushInfoModal('DEEPSKRIN GC', `removed ${res.removed} blobs · remaining ${res.remaining}`, dash);
				}
				case 'clean': {
					
					if (dash) {
						pushModals(MOD_ID, [{
							id: 'deepshrink-clean-confirm',
							title: 'Confirm — Purge DeepSkrin',
							pending: true,
							confirm: 'Choose what to purge:',
							items: [
								{ label: '🧹 Purge THIS workspace only', value: 'clean-workspace', color: 'yellow', detail: `blobs of ${process.cwd()}` },
								{ label: '☢ Purge EVERYTHING (all workspaces + logs)', value: 'clean-all', color: 'red', detail: 'deletes every blob and log event' },
								{ label: 'Cancel', value: 'cancel' },
							],
							actions: [
								{ key: 'enter', label: 'Confirm', kind: 'danger' },
								{ key: 'esc', label: 'Cancel', kind: 'secondary' },
							],
						}]);
						return { message: undefined };
					}
					const res = await executor.purgeStore();
					return { message: panel('DEEPSKRIN CLEAN', `${res.blobs} blobs · ${res.events} events purgés`) };
				}
				case 'on':
				case 'off': {
					
					const target = action === 'on';
					await executor.setEnabled(target);
					return pushInfoModal('DEEPSKRIN', `DeepSkrin ${target ? 'ON' : 'OFF'}`, dash);
				}
				default: {
					
					if (dash) {
						pushMenuModal();
						return { message: undefined };
					}
					const out = await runMainMenu(executor, host);
					return { message: panel('DEEPSKRIN', out) };
				}
			}
		},
	});

	cmd.addCommand({
		name: 'deepshrink-log',
		description: 'DeepSkrin logs · tail N, all, level <lvl>, open, stats, prune [days], clean, export <path>',
		argumentHint: '[tail N|all|level <lvl>|open|stats|prune <days>|clean|export <path>]',
		handler: async ({ args }) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			const dash = isDashboardLive();
			const modal = (title: string, body: string) => pushInfoModal(title, body, dash);
			switch (sub) {
				case 'tail': {
					const n = parseInt(rest[0] ?? '20', 10);
					return modal('DEEPSKRIN LOG TAIL', await executor.logTail(isNaN(n) ? 20 : n));
				}
				case 'all':
					return modal('DEEPSKRIN LOG ALL', await executor.logTail(10000));
				case 'level': {
					const lvl = (rest[0] ?? 'info') as LogLevel;
					await executor.logSetLevel(lvl);
					return modal('DEEPSKRIN LOG LEVEL', `level → ${lvl}`);
				}
				case 'open': {
					await cmd.exec({ command: 'open', args: [dir] });
					return modal('DEEPSKRIN LOG', 'opened log folder');
				}
				case 'stats': {
					return modal('DEEPSKRIN LOG STATS', await executor.logStats());
				}
				case 'prune': {
					const days = parseInt(rest[0] ?? '7', 10);
					const removed = await executor.logPrune(isNaN(days) ? 7 : days);
					return modal('DEEPSKRIN LOG PRUNE', `removed ${removed} files`);
				}
				case 'clean': {
					const removed = await executor.logClean();
					return modal('DEEPSKRIN LOG CLEAN', `removed ${removed} entries`);
				}
				case 'export': {
					const outPath = rest[0] ?? `${dir}/export-${new Date().toISOString().slice(0, 10)}.json`;
					const res = await executor.exportBundle(outPath);
					return modal('DEEPSKRIN EXPORT', `${res.path}\n${res.entries} events · ${res.blobs} blobs · ${res.redacted ? 'redacted' : 'unredacted'}`);
				}
				default:
					return modal('DEEPSKRIN LOG', await executor.cmdLogs());
			}
		},
	});

	cmd.addCommand({
		name: 'deepshrink-toggle',
		description: 'Toggle DeepSkrin on/off',
		handler: async () => {
			const on = await executor.toggle();
			return { message: panel('DEEPSKRIN TOGGLE', badge(on)) };
		},
	});

	cmd.addCommand({
		name: 'deepshrink-help',
		description: 'DeepSkrin help',
		handler: async () => ({ message: panel('DEEPSKRIN HELP', await executor.cmdHelp()) }),
	});

	
	
	
	
	resetBridgeOnStartup(MOD_ID, { enabled: executor.config.enabled });

	
	
	
	
	
	startPickupWatcher(MOD_ID, (pickup, consume) => {
		const v = String(pickup.value || '');
		if (pickup.modal === 'DEEPSKRIN MENU') {
			consume();
			clearModals(MOD_ID);
			void (async () => {
				let body: string;
				switch (v) {
					case 'status': body = await executor.cmdStatus(); break;
					case 'stats': body = await executor.cmdStats(); break;
					case 'recall': body = 'usage: /deepshrink recall <regex>'; break;
					case 'store': body = await executor.cmdStore(); break;
					case 'logs': body = await executor.cmdLogs(); break;
					case 'config': { await pushConfigModal(true, executor); return; }
					case 'help': body = await executor.cmdHelp(); break;
					case 'gc': { const r = await executor.runGc(true); body = `removed ${r.removed} blobs · remaining ${r.remaining}`; break; }
					case 'clean': {
						
						pushModals(MOD_ID, [{
							id: 'deepshrink-clean-confirm',
							title: 'Confirm — Purge DeepSkrin',
							pending: true,
							confirm: 'Choose what to purge:',
							items: [
								{ label: '🧹 Purge THIS workspace only', value: 'clean-workspace', color: 'yellow', detail: `blobs of ${process.cwd()}` },
								{ label: '☢ Purge EVERYTHING (all workspaces + logs)', value: 'clean-all', color: 'red', detail: 'deletes every blob and log event' },
								{ label: 'Cancel', value: 'cancel' },
							],
							actions: [
								{ key: 'enter', label: 'Confirm', kind: 'danger' },
								{ key: 'esc', label: 'Cancel', kind: 'secondary' },
							],
						}]);
						return;
					}
					case 'toggle': { const on = await executor.toggle(); body = `DeepSkrin ${on ? 'ON' : 'OFF'}`; break; }
					default: return;
				}
				await pushInfoModal('DEEPSKRIN', body, true);
			})();
		} else if (pickup.modal === 'Confirm — Purge DeepSkrin') {
			consume();
			clearModals(MOD_ID);
			const isAll = pickup.value === 'clean-all';
			const isWs = pickup.value === 'clean-workspace';
			if (isAll || isWs) {
				void (async () => {
					
					
					pushProgress(MOD_ID, 'Purging DeepSkrin…', 0, 2);
					await new Promise((r) => setTimeout(r, 250));
					const res = isAll
						? await executor.purgeStore()
						: await executor.purgeWorkspace();
					pushProgress(MOD_ID, 'Purging DeepSkrin…', 2, 2);
					await new Promise((r) => setTimeout(r, 400));
					clearModals(MOD_ID);
					
					
					const purgeMsg = isAll
						? `${res.blobs} blobs · ${(res as { events?: number }).events ?? 0} events purgés (tout).`
						: `${res.blobs} blobs purgés (workspace uniquement).`;
					const status = await executor.cmdStatus();
					await pushInfoModal('DEEPSKRIN CLEAN', `${purgeMsg}\n\n${status}`, true);
				})();
			}
		}
	}, 2000, (pickup) => pickup.modal === 'Confirm — Purge DeepSkrin');
}




async function pushInfoModal(title: string, body: string, dash: boolean): Promise<{ message?: string }> {
	
	
	
	const lines = (body || '').split('\n').map(l => l.trimEnd()).filter(l => l !== '');
	const items: BridgeModal[] = [{
		id: `info-${Date.now()}`,
		title,
		pending: true,
		readonly: true,
		items: lines.slice(0, 40).map(l => ({ label: l, value: '', detail: '' })),
		actions: [{ key: 'esc', label: 'Close', kind: 'secondary' }],
	}];
	if (dash) {
		pushModals(MOD_ID, items);
		return { message: undefined };
	}
	return { message: panel(title, body) };
}


function pushMenuModal(): void {
	pushModals(MOD_ID, [{
		id: 'deepshrink-menu',
		title: 'DEEPSKRIN MENU',
		pending: true,
		items: [
			{ label: '◉ STATUS   · session + store state', value: 'status', detail: 'current state' },
			{ label: '◉ STATS    · efficiency, break-even', value: 'stats', detail: 'savings + cost' },
			{ label: '◉ RECALL   · query store', value: 'recall', detail: 'regex search' },
			{ label: '◉ STORE    · blobs + GC', value: 'store', detail: 'content-addressable blobs' },
			{ label: '◉ LOGS     · log info', value: 'logs', detail: 'events' },
			{ label: '◉ CONFIG   · budgets + locale', value: 'config', detail: 'wizard' },
			{ label: '◉ HELP     · commands', value: 'help', detail: 'usage' },
			{ label: '◉ GC       · force garbage collect', value: 'gc', detail: 'remove old blobs' },
			{ label: '◉ CLEAN    · purge tout (blobs + logs)', value: 'clean', detail: 'confirmation requise' },
			{ label: '◉ TOGGLE   · on/off', value: 'toggle', detail: 'enable/disable' },
		],
		actions: [
			{ key: 'enter', label: 'Select', kind: 'primary' },
			{ key: 'esc', label: 'Cancel', kind: 'secondary' },
		],
	}]);
}


async function pushConfigModal(dash: boolean, executor: Executor): Promise<{ message?: string }> {
	if (!dash) return { message: panel('DEEPSKRIN CONFIG', await executor.cmdConfig()) };
	pushModals(MOD_ID, [{
		id: 'open-config',
		title: 'DEEPSKRIN CONFIG',
		pending: true,
		items: [],
		actions: [],
	}]);
	return { message: undefined };
}

function pick(u: Record<string, unknown>, ...keys: string[]): number {
	for (const k of keys) {
		const v = u[k];
		if (typeof v === 'number') return v;
	}
	return 0;
}

async function runMainMenu(executor: Executor, host: ExecutorHost): Promise<string> {
	if (!host.select) {
		return 'DeepSkrin menu (headless)\n/status /stats /recall <q> /store /logs /config /help';
	}
	const options = [
		{ label: '◉ STATUS   · session + store state', value: 'status' },
		{ label: '◉ STATS    · efficiency, break-even', value: 'stats' },
		{ label: '◉ RECALL   · query store', value: 'recall' },
		{ label: '◉ STORE    · blobs + GC', value: 'store' },
		{ label: '◉ LOGS     · log info', value: 'logs' },
		{ label: '◉ CONFIG   · budgets + locale', value: 'config' },
		{ label: '◉ HELP     · commands', value: 'help' },
		{ label: '✕ Cancel', value: 'cancel' },
	];
	while (true) {
		const choice = await host.select('DeepSkrin · main menu', options);
		if (!choice || choice === 'cancel') return 'cancelled';
		let out: string;
		switch (choice) {
			case 'status': out = await executor.cmdStatus(); break;
			case 'stats': out = await executor.cmdStats(); break;
			case 'recall': out = 'usage: /deepshrink recall <regex>'; break;
			case 'store': out = await executor.cmdStore(); break;
			case 'logs': out = await executor.cmdLogs(); break;
			case 'config': out = await executor.cmdConfig(); break;
			case 'help': out = await executor.cmdHelp(); break;
			default: return 'unknown action';
		}
		return out;
	}
}

