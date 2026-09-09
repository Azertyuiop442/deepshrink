



import type { DeepSkrinConfig, LogLevel, Locale } from '../core/config.ts';
import { DEFAULT_CONFIG, mergeConfig } from '../core/config.ts';
import { flexoki } from './ui.ts';
import { makeI18n, type I18n } from '../core/i18n.ts';
import { makeEvent, reduceSnapshot, emptySnapshot, type DeepSkrinEvent, type SessionSnapshot } from '../core/events.ts';
import { redact } from '../core/redact.ts';
import { ingestContent, gcStore, detectBinary, supersedeCounts, type BlobStoreState, type IngestResult } from '../core/store.ts';
import { scoreConfidence, freshnessSignals, type FreshnessSignals } from '../core/confidence.ts';
import { statSync, realpathSync, readFileSync, readdirSync } from 'node:fs';
import { digestToolOutput, type Rule } from '../core/rules.ts';
import { sha256Hex } from '../core/hash.ts';
import { isSideEffectCommand } from '../core/sideeffects.ts';
import { skeletonize } from '../core/skeleton.ts';
import { buildView } from '../core/view.ts';
import { compressText } from '../core/compress.ts';
import { detectType } from '../core/typedetect.ts';
import { crushJsonText } from '../core/jsoncrush.ts';
import { compactTable } from '../core/tabular.ts';
import { compressStackTraces } from '../core/stacktrace.ts';
import { collapseLogLines } from '../core/logcollapse.ts';
import { crushText } from '../core/textcrusher.ts';
import { queryTerms, scoreRelevance, buildIdf } from '../core/relevance.ts';
import { rrfFuse } from '../core/rrf.ts';
import { myersDiff, summarizeDiff, formatDeltaPatch } from '../core/delta.ts';
import { checkLcp } from '../core/lcp.ts';
import { expectedCalibrationError } from '../core/ece.ts';
import { emptyIndex, indexAdd, indexRemove, indexQuery, indexPathLookup, type TermIndex } from '../core/termindex.ts';
import { updateActiveFiles, newActiveFiles, isActiveFile } from '../core/active.ts';
import { recordFailure, recordSuccess, advanceTurn, allowed as breakerAllowed, type BreakerStatus, CLOSED } from '../core/breaker.ts';
import { calibrateEstimate, estimateTokens, budgetInfo, breakEven, DEFAULT_METER, type MeterState } from '../core/metering.ts';
import { computeStats } from '../core/stats.ts';
import { HAND_PRICING, fuzzyMatchModel, PricingCache } from '../core/pricing.ts';
import { buildStateSummary, markDelivered, type GuardState, EMPTY_GUARD } from '../core/guard.ts';
import { formatWindow, looksWindowed, windowParams, EMPTY_WINDOW_COUNTERS, type WindowCounters } from '../core/window.ts';
import { ConfigStore } from './config-store.ts';
import { EventLog } from './log.ts';
import { DiskStore, SessionRegistry, type PersistentStore } from './store.ts';
import { exportBundle, type ExportResult } from './export.ts';

export interface ExecutorHost {
	notify?: (msg: string) => void;
	select?: (title: string, options: { label: string; value: string }[]) => Promise<string | null>;
	showEntry?: (customType: string, data: { line: string }) => void;
	exec?: (opts: { command: string; args?: string[] }) => Promise<{ stdout: string; code: number }>;
	confirm?: (opts: { title: string }) => Promise<boolean>;
}

export interface ExecutorDeps {
	dir: string;
	configStore: ConfigStore;
	pricing: PricingCache;
	createLog: (sessionId: string, level: LogLevel) => EventLog;
	store: PersistentStore;
	registry: SessionRegistry;
	host?: ExecutorHost;
}

export interface ExecutorOptions {
	sessionId?: string;
	locale?: Locale;
	workspace?: string;
}

export interface RecallHit {
	short: string;
	ref: string;
	content: string;
	score?: number;
	flags?: string[];
	stale?: boolean;
}

export interface StaleHint {
	short: string;
	ref: string;
	reason: string;
	score?: number;
	flags?: string[];
}


export interface RecallMeter {
	recalls: number;         
	served: number;          
	droppedStale: number;    
	pathLookups: number;     
	indexSize: number;       
}




export interface FidelityMeter {
	fidelityServes: number;      
	stubServes: number;          
	recallCalls: number;         
	postCompactionStubs: number; 
	frozenRewriteRefusals: number; 
}









export function findFilePathInCommand(cmd: string): string | undefined {
	const parts = (cmd || '').trim().split(/\s+/);
	const bin = (parts[0] || '').split('/').pop() || '';
	if (!['cat', 'head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'wc', 'diff', 'md5', 'shasum'].includes(bin)) return undefined;
	let found: string | undefined;
	for (let i = 1; i < parts.length; i++) {
		const t = parts[i];
		if (t.startsWith('-') || t.startsWith('|') || t === '&&' || t === ';') continue;
		if (t.includes('/') || t.startsWith('.') || t.startsWith('~/')) {
			if (found !== undefined) return undefined; 
			found = t;
		}
	}
	return found;
}





function isContentReadingCommand(cmd: string): boolean {
	const parts = (cmd || '').trim().split(/\s+/);
	const bin = (parts[0] || '').split('/').pop() || '';
	if (!['cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'wc', 'diff', 'md5', 'shasum'].includes(bin)) return false;
	
	return !/(\||>|<|&&|;)/.test(cmd);
}






export function resolveTildePath(p: string): string {
	if (p === '~') return process.env.HOME || p;
	if (p.startsWith('~/')) return `${process.env.HOME || ''}/${p.slice(2)}`;
	return p;
}





function isDirScanCommand(cmd: string): boolean {
	const parts = (cmd || '').trim().split(/\s+/);
	const bin = (parts[0] || '').split('/').pop() || '';
	if (bin === 'find') return true;
	if (bin === 'grep') {
		const flags = parts.slice(1).filter(t => t.startsWith('-'));
		return flags.some(f => /r/.test(f.replace(/^-+/, ''))) && !/(\||>|<|&&|;)/.test(cmd);
	}
	return false;
}







const DIR_SCAN_MAX_ENTRIES = 5000;
export function dirSignature(p: string): { mtimeMs: number; size: number } | undefined {
	const st = statSync(p);
	if (!st.isDirectory()) return undefined;
	let maxMtime = st.mtimeMs;
	let count = 0;
	const stack = [p];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		let entries: string[];
		try {
			entries = readdirSync(cur, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (count >= DIR_SCAN_MAX_ENTRIES) return undefined;
			count++;
			const full = `${cur}/${e.name}`;
			try {
				const s = statSync(full);
				if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
				if (e.isDirectory()) stack.push(full);
			} catch {}
		}
	}
	return { mtimeMs: maxMtime, size: count };
}

export class Executor {
	config: DeepSkrinConfig = { ...DEFAULT_CONFIG };
	state: BlobStoreState = { blobs: new Map(), indexRev: 0 };
	blobContents = new Map<string, string>();
	i18n: I18n = makeI18n('en');
	snapshot: SessionSnapshot;
	private meter: MeterState = { ...DEFAULT_METER };
	private breakers: Record<string, BreakerStatus> = {};
	private guard: GuardState = { ...EMPTY_GUARD, enabled: false };
	private activeFiles;
	private rules: Rule[];
	private usages: Array<{ inputTokens: number; outputTokens: number; cacheRead: number }> = [];
	private toolCalls: Array<{ tool: string; input: string; path?: string; hash?: string }> = [];
	private reReads = 0;
	private errors = 0;
	private errorsAtLastTurn = 0;
	private ruleSaves = 0;
	

	private recallInjectedChars = 0;
	
	private lastIndexSync = 0;
	private overheadTokens = 0;
	sessionId: string;
	workspace: string;
	private log: EventLog;
	private localePinned = false;
	private live = true;
	private serial = Promise.resolve();
	private lastContextTokens = 0;
	private lastCalibChars = 0;
	private currentModel = '';
	private gcTimer: ReturnType<typeof setInterval> | undefined;
	
	private purgeStamp = 0;
	
	windowCounters: WindowCounters = { ...EMPTY_WINDOW_COUNTERS };
	
	recallMeter: RecallMeter = { recalls: 0, served: 0, droppedStale: 0, pathLookups: 0, indexSize: 0 };
	
	fidelityMeter: FidelityMeter = { fidelityServes: 0, stubServes: 0, recallCalls: 0, postCompactionStubs: 0, frozenRewriteRefusals: 0 };
	

	behavior: { readsWithoutPriorRecall: number; recallThenRead: number } = { readsWithoutPriorRecall: 0, recallThenRead: 0 };
	





	calibrationSamples: Array<{ confidence: number; used: boolean }> = [];
	
	private lastRecallOutcome: 'stale' | 'miss' | 'hit' | undefined = undefined;
	







	private compactionEpoch = 0;
	


	private servedSinceEpoch = new Map<string, number>();
	
	private servedEpochLru = new Map<string, true>();
	

	private lastSummaryId: string | undefined = undefined;
	
	private termIndex: TermIndex | undefined;
	private termIndexRev = -1;

	private deps: ExecutorDeps;

	constructor(deps: ExecutorDeps, opts: ExecutorOptions = {}) {
		this.deps = deps;
		this.sessionId = opts.sessionId ?? 'unknown';
		this.workspace = opts.workspace ?? process.cwd();
		this.snapshot = emptySnapshot(this.sessionId);
		this.activeFiles = newActiveFiles(this.config.activeFileTtlMs);
		this.rules = [];
		this.log = deps.createLog(this.sessionId, this.config.logLevel);
	}

	
	setSessionId(id: string): void {
		if (!id || id === this.sessionId) return;
		this.sessionId = id;
		this.snapshot = emptySnapshot(id);
		this.log = this.deps.createLog(id, this.config.logLevel);
		this.deps.registry.register(id);
	}

	

	async init(): Promise<void> {
		const { config, corrupt } = await this.deps.configStore.load();
		this.config = config;
		
		
		
		this.emit('config', corrupt ? 'warn' : 'debug', { action: 'load', enabled: config.enabled, guard: config.compactGuard, digestEnabled: config.digestEnabled });
		this.i18n = makeI18n(config.locale);
		this.overheadTokens = 0;
		const { state, rebuilt } = await this.deps.store.loadState();
		this.state = state;
		this.purgeStamp = await this.deps.store.purgedAt();
		if (rebuilt) this.emit('store', 'warn', { action: 'rebuild' });
		await this.deps.registry.load();
		this.deps.registry.register(this.sessionId);
		
		
		
		{
			const t0 = Date.now();
			this.ensureTermIndex();
			this.emit('index', 'info', { action: 'build', size: this.termIndex?.size ?? 0, ms: Date.now() - t0 });
		}
		
		
		try {
			const m = await this.deps.store.loadMetrics();
			const w = m.windowCounters as Partial<WindowCounters> | undefined;
			if (w) this.windowCounters = { ...EMPTY_WINDOW_COUNTERS, ...w };
			const r = m.recallMeter as Partial<RecallMeter> | undefined;
			if (r) this.recallMeter = { recalls: 0, served: 0, droppedStale: 0, pathLookups: 0, indexSize: 0, ...r };
			const f = m.fidelityMeter as Partial<FidelityMeter> | undefined;
			if (f) this.fidelityMeter = { fidelityServes: 0, stubServes: 0, recallCalls: 0, postCompactionStubs: 0, frozenRewriteRefusals: 0, ...f };
		} catch (e) {
			this.emit('store', 'warn', { action: 'metrics-load', error: String(e) });
		}
		
		
		
		if (this.config.gcIntervalMs > 0) {
			this.gcTimer = setInterval(() => {
				this.serialized(() => this.runGc(false)).catch(() => {});
			}, this.config.gcIntervalMs);
			
			
			
			this.gcTimer.unref?.();
		}
	}

	async onSessionStart(source: string): Promise<void> {
		await this.init();
		this.emit('session', 'info', { action: 'start', locale: this.config.locale });
		if (this.config.enabled) {
			this.deps.host?.notify?.(this.i18n.t('notify.activated'));
		}
	}

	
	pinLocale(locale: Locale): void {
		if (this.localePinned) return;
		this.localePinned = true;
		if (this.config.locale !== locale) {
			this.config = { ...this.config, locale };
			this.i18n = makeI18n(locale);
			this.emit('session', 'info', { action: 'locale', locale });
		}
	}

	async onSessionEnd(): Promise<void> {
		if (this.gcTimer) {
			clearInterval(this.gcTimer);
			this.gcTimer = undefined;
		}
		this.deps.registry.unregister(this.sessionId);
		await this.deps.registry.save();
		this.emit('session', 'info', { action: 'end' });
		await this.log.flush();
		this.live = false;
	}

	

	private serialized<T>(fn: () => Promise<T> | T): Promise<T> {
		const run = this.serial.then(fn);
		this.serial = run.then(() => undefined, () => undefined);
		return run;
	}

	

	private emit(type: DeepSkrinEvent['type'], level: LogLevel, partial: Record<string, unknown>): void {
		const ev = makeEvent(this.sessionId, level, { type, ...partial } as never);
		this.snapshot = reduceSnapshot(this.snapshot, ev);
		if (level === 'warn' || level === 'error') {
			this.log.append(ev);
		} else {
			this.log.appendBatched(ev);
		}
	}

	

	async afterToolCall(opts: { toolName?: string; input?: Record<string, unknown>; content?: unknown; isError?: boolean }): Promise<{ content?: Array<{ type: string; text: string }> } | undefined> {
		if (!this.config.enabled || !this.live) return undefined;
		const toolName = opts.toolName ?? '';
		const input = opts.input ?? {};
		const rawContent = opts.content ?? '';
		
		let content = '';
		if (typeof rawContent === 'string') content = rawContent;
		else if (Array.isArray(rawContent)) {
			content = rawContent
				.map((b: unknown) => {
					if (typeof b === 'string') return b;
					if (b && typeof b === 'object') {
						const t = (b as { text?: unknown }).text;
						if (typeof t === 'string') return t;
					}
					return '';
				})
				.join('\n');
		} else if (rawContent && typeof rawContent === 'object') {
			const t = (rawContent as { text?: unknown }).text;
			if (typeof t === 'string') content = t;
		}

		
		if (toolName.startsWith('deepshrink')) {
			this.emit('decide', 'info', { action: 'bypass', reason: 'internal tool' });
			return undefined;
		}

		const command = typeof input.command === 'string' ? input.command : undefined;
		const path = typeof input.path === 'string' ? input.path : (typeof input.file_path === 'string' ? input.file_path : undefined);
		
		
		const exitCode = opts.isError ? 1 : 0;

		
		
		
		
		
		
		if (/^(write_file|edit_file|apply_patch|create_file)$/.test(toolName) && path) {
			for (const [hash, meta] of this.state.blobs) {
				if (meta.source === 'read_file' && meta.filePath === path) {
					meta.editedByModel = true;
					this.emit('store', 'debug', { action: 'invalidate', hash: meta.hash.slice(0, this.config.hashPrefixChars), path });
				}
				if ((meta.source === 'grep' || meta.source === 'glob' || meta.source === 'read_directory')
					&& meta.filePath && (meta.filePath === path || meta.filePath.startsWith(path + '/') || path.startsWith(meta.filePath + '/'))) {
					meta.editedByModel = true;
					this.emit('store', 'debug', { action: 'invalidate-search', hash: meta.hash.slice(0, this.config.hashPrefixChars), path });
				}
			}
		}

		return this.serialized(async () => {
			const start = Date.now();
			
			
			
			
			const purged = await this.deps.store.purgedAt();
			if (purged > this.purgeStamp) {
				this.purgeStamp = purged;
				this.state = { blobs: new Map(), indexRev: 0 };
				this.blobContents.clear();
				this.termIndex = undefined;
				this.termIndexRev = -1;
				this.toolCalls = [];
				this.emit('store', 'info', { action: 'purge-resync' });
			}
			
			const activePaths = new Set(this.activeFiles.entries.keys());
			const digest = digestToolOutput(toolName, command, content, { isError: opts.isError, activeFilePaths: activePaths, path, code: exitCode });
			if (opts.isError) this.errors++;
			this.lastCalibChars = content.length;
			if (digest.text !== undefined && digest.text !== content) {
				this.ruleSaves += Math.max(0, (content.length - digest.text.length) / this.config.estimateCharsPerToken);
			}
			
			const redactedContent = content.length > 0 ? redact(content).text : content;
			let ingestedHash: string | undefined;
			if (redactedContent.length > 0 && !detectBinary(redactedContent)) {
				
				
				let fileMtime: number | undefined;
				let fileSize: number | undefined;
				
				
				
				
				
				
				
				
				let dirMtime: number | undefined;
				let dirSize: number | undefined;
				if (toolName === 'shell_command' && command && isContentReadingCommand(command)) {
					const refPath = findFilePathInCommand(command);
					if (refPath) {
						try {
							const st = statSync(resolveTildePath(refPath));
							fileMtime = st.mtimeMs;
							fileSize = st.size;
						} catch {}
					}
				}
				if (toolName === 'shell_command' && command && isDirScanCommand(command)) {
					const refPath = findFilePathInCommand(command);
					if (refPath) {
						try {
							const sig = dirSignature(resolveTildePath(refPath));
							if (sig) {
								dirMtime = sig.mtimeMs;
								dirSize = sig.size;
							}
						} catch {}
					}
				}
				if (toolName === 'read_file' && path) {
					try {
						const st = statSync(path);
						fileMtime = st.mtimeMs;
						fileSize = st.size;
					} catch {}
				}
				const ws = this.workspace;
				
				
				
				
				
				
				
				
				
				
				if (toolName === 'read_file' && fileMtime !== undefined && path) {
					
					
					
					
					let real: string | undefined;
					try {
						real = realpathSync(path);
					} catch {
						real = undefined;
					}
					const existing = [...this.state.blobs.values()].find(
						m => m.source === 'read_file' && m.fileMtime === fileMtime &&
							((real !== undefined && m.realPath === real) || m.filePath === path),
					);
					if (existing && this.blobContents.has(existing.hash) && this.blobContents.get(existing.hash) === redactedContent) {
						
						
						
						
						
						
						const prevContent = this.blobContents.get(existing.hash);
						if (prevContent && prevContent !== redactedContent) {
							const summary = summarizeDiff(prevContent, redactedContent);
							if (summary.changedRatio <= 0.4) {
								const patch = formatDeltaPatch(summary, path);
								this.fidelityMeter.fidelityServes++;
								this.emit('view', 'info', { action: 'delta-elide', hash: existing.hash.slice(0, this.config.hashPrefixChars), path, bytes: redactedContent.length, patchBytes: patch.length, ratio: summary.changedRatio });
								this.toolCalls.push({ tool: toolName, input: JSON.stringify(input).slice(0, 200), path, hash: existing.hash });
								if (this.toolCalls.length > 200) this.toolCalls.shift();
								return { content: [{ type: 'text', text: patch }] };
							}
							
						}
					}
					if (existing && this.blobContents.has(existing.hash) && this.blobContents.get(existing.hash) === redactedContent) {
						this.reReads++;
						const precededByRecall = this.lastRecallOutcome !== undefined;
						const outcome = this.lastRecallOutcome;
						this.lastRecallOutcome = undefined;
						
						
						
						
						
						const compacted = !this.isStubSafe(existing.hash);
						if (compacted) {
							
							
							this.fidelityMeter.fidelityServes++;
							this.emit('view', 'info', { action: 'reread-elide', hash: existing.hash.slice(0, this.config.hashPrefixChars), path, bytes: redactedContent.length, precededByRecall, compacted: true, servedContent: true });
							this.toolCalls.push({ tool: toolName, input: JSON.stringify(input).slice(0, 200), path, hash: existing.hash });
							if (this.toolCalls.length > 200) this.toolCalls.shift();
							this.markServed(existing.hash);
							return {
								content: [{ type: 'text', text: redactedContent }],
							};
						}
						
						this.fidelityMeter.stubServes++;
						if (this.compactionEpoch > 0) this.fidelityMeter.postCompactionStubs++;
						this.emit('view', 'info', { action: 'reread-elide', hash: existing.hash.slice(0, this.config.hashPrefixChars), path, bytes: redactedContent.length, precededByRecall, compacted: false, servedContent: false });
						
						this.toolCalls.push({ tool: toolName, input: JSON.stringify(input).slice(0, 200), path, hash: existing.hash });
						if (this.toolCalls.length > 200) this.toolCalls.shift();
						const lineCount = content.split('\n').length;
						return {
							content: [{ type: 'text', text: `[Read: ${lineCount} lines from ${path} — unchanged, content already in store [blob:${existing.hash.slice(0, this.config.hashPrefixChars)}]. Use deepshrink_recall to re-read it.]` }],
						};
					}
					
					if (this.lastRecallOutcome !== undefined) {
						if (this.lastRecallOutcome !== 'hit') this.behavior.recallThenRead++;
						this.lastRecallOutcome = undefined;
					}
				}
				const res: IngestResult = ingestContent(this.state, redactedContent, this.sessionId, this.config, Date.now(), false, {
					workspace: ws,
					source: toolName,
					command,
					
					
					filePath: path ?? (toolName === 'shell_command' && command ? findFilePathInCommand(command) : undefined),
					
					
					realPath: toolName === 'read_file' && path ? (() => { try { return realpathSync(path); } catch { return undefined; } })() : undefined,
					
					
					
					searchPattern: (toolName === 'grep' || toolName === 'glob')
						? (typeof input.pattern === 'string' ? input.pattern : undefined)
						: undefined,
					fileMtime,
					fileSize,
					dirMtime,
					dirSize,
				});
				ingestedHash = res.hash;
				if (res.newBlobs > 0) {
					await this.deps.store.saveBlob(res.hash, redactedContent);
					this.blobContents.set(res.hash, redactedContent);
					indexAdd(this.termIndex ??= emptyIndex(), {
						hash: res.hash,
						content: redactedContent,
						path: path ?? (toolName === 'shell_command' && command ? findFilePathInCommand(command) : undefined),
					});
					
					
					
					this.markServed(res.hash);
					
					
					
					this.emit('store', 'info', { action: 'ingest', hash: res.short, bytes: redactedContent.length, tool: toolName });
				}
				
				
				if (res.superseded.length > 0) {
					for (const h of res.superseded) {
						try { await this.deps.store.deleteBlob(h); } catch (e) {
							this.emit('store', 'warn', { action: 'supersede-delete', hash: h.slice(0, this.config.hashPrefixChars), error: String(e) });
						}
						this.blobContents.delete(h);
						indexRemove(this.termIndex, h);
					}
					
					
					const c = supersedeCounts(res);
					this.emit('store', 'info', { action: 'superseded', blobs: res.superseded.length, cause: { edited: c.edited, reIngestSameHash: c.reIngestSameHash } });
				}
				
				
				
				if (res.newBlobs > 0 || res.superseded.length > 0) {
					await this.deps.store.checkpoint(this.state);
					
					
					await this.deps.store.saveMetrics({
						windowCounters: { ...this.windowCounters },
						recallMeter: { ...this.recallMeter },
						fidelityMeter: { ...this.fidelityMeter },
					});
				}

				
				
				
				
				
				
				
				
				if (this.config.elideWindowedReads && toolName === 'read_file' && path) {
					await this.ingestFullFile(path, ws);
				}
			}
			
			
			this.toolCalls.push({ tool: toolName, input: JSON.stringify(input).slice(0, 200), path, hash: ingestedHash });
			if (this.toolCalls.length > 200) this.toolCalls.shift();
			this.emit('hook', 'debug', { action: 'afterToolCall', ms: Date.now() - start });

			
			
			
			
			
			
			
			
			
			const fidelityTool = toolName === 'read_file' || toolName === 'read_multiple_files' || /^(cat|less|more|head|tail|bat)\b/.test(command ?? '');
			if (this.config.compressEnabled && content.length >= this.config.compressMinChars && digest.text === undefined && !fidelityTool) {
				const smart = this.smartCompress(content);
				if (smart !== undefined && smart !== content && smart.length < content.length) {
					this.emit('view', 'info', { action: 'smart', kind: detectType(content).type, bytes: content.length - smart.length });
					return { content: [{ type: 'text', text: smart }] };
				}
			}

			
			if (this.config.digestEnabled && digest.text !== undefined && breakerAllowed(this.breakers['digest'] ?? CLOSED)) {
				this.emit('view', 'info', { action: 'elide', bytes: content.length });
				
				return { content: [{ type: 'text', text: digest.text }] };
			}
			return undefined;
		});
	}

	













	private async ingestFullFile(path: string, ws: string): Promise<void> {
		try {
			
			
			let real: string;
			try {
				real = realpathSync(path);
			} catch {
				return; 
			}
			const st0 = statSync(real);
			if (st0.size > this.config.maxFullFileBytes) return;
			if (st0.size === 0) return; 
			const raw = readFileSync(real);
			
			if (raw.includes(0)) return;
			let ctrl = 0;
			for (let i = 0; i < Math.min(raw.length, 8192); i++) {
				const c = raw[i];
				if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
			}
			if (ctrl / Math.min(raw.length, 8192) > 0.1) return;
			
			let text: string;
			if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
				text = raw.subarray(2).toString('utf16le');
			} else if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
				text = raw.subarray(3).toString('utf8');
			} else {
				text = raw.toString('utf8');
			}
			
			const st1 = statSync(real);
			if (st1.mtimeMs !== st0.mtimeMs || st1.size !== st0.size) return;
			const res = ingestContent(this.state, text, this.sessionId, this.config, Date.now(), false, {
				workspace: ws,
				source: 'read_file',
				
				
				
				filePath: path,
				fileMtime: st1.mtimeMs,
				fileSize: st1.size,
				fullFile: true,
				realPath: real,
			});
			if (res.newBlobs > 0) {
				await this.deps.store.saveBlob(res.hash, text);
				this.blobContents.set(res.hash, text);
				indexAdd(this.termIndex ??= emptyIndex(), { hash: res.hash, content: text, path: real });
				
				
				this.markServed(res.hash);
				this.emit('store', 'debug', { action: 'full-file', hash: res.short, path: real, bytes: text.length });
			}
			if (res.superseded.length > 0) {
				for (const h of res.superseded) {
					try { await this.deps.store.deleteBlob(h); } catch (e) {
						this.emit('store', 'warn', { action: 'fullfile-supersede-delete', hash: h.slice(0, this.config.hashPrefixChars), error: String(e) });
					}
					this.blobContents.delete(h);
					indexRemove(this.termIndex, h);
				}
			}
			if (res.newBlobs > 0 || res.superseded.length > 0) await this.deps.store.checkpoint(this.state);
		} catch (e) {
			
			
			this.emit('store', 'warn', { action: 'full-file-ingest', error: String(e) });
		}
	}

	











	private async tryServeWindowed(key: string, input: Record<string, unknown>): Promise<{ hash: string; content: string; ref: string; stale: boolean; ageMs: number } | undefined> {
		const { offset, limit } = windowParams(input);
		if (offset <= 0 || limit <= 0) return undefined;
		
		let real: string;
		try {
			real = realpathSync(key);
		} catch {
			this.windowCounters.windowMissNoBlob++;
			return undefined;
		}
		
		if (!this.lastIndexSync || Date.now() - this.lastIndexSync > 1000) {
			await this.serialized(async () => {
				try {
					const { state: diskState } = await this.deps.store.loadState();
					if (diskState.indexRev > this.state.indexRev) {
						for (const [hash, meta] of diskState.blobs) {
							if (!this.state.blobs.has(hash)) this.state.blobs.set(hash, meta);
						}
						this.state.indexRev = diskState.indexRev;
					}
				} catch {}
				for (const [hash] of this.state.blobs) {
					if (!this.blobContents.has(hash)) {
						const c = await this.deps.store.readBlob(hash);
						if (c !== undefined) this.blobContents.set(hash, c);
					}
				}
			});
			this.lastIndexSync = Date.now();
		}
		
		let best: { hash: string; lastRef: number; createdAt: number } | undefined;
		for (const [hash, meta] of this.state.blobs) {
			if (meta.source !== 'read_file' || meta.fullFile !== true) continue;
			if (meta.realPath !== real) continue;
			const lastRef = meta.lastRef || 0;
			const createdAt = meta.createdAt || 0;
			if (!best || lastRef > best.lastRef || (lastRef === best.lastRef && createdAt >= best.createdAt)) {
				best = { hash, lastRef, createdAt };
			}
		}
		if (!best) {
			this.windowCounters.windowMissNoBlob++;
			return undefined;
		}
		const content = this.blobContents.get(best.hash);
		if (content === undefined) {
			this.windowCounters.windowMissNoBlob++;
			return undefined;
		}
		const meta = this.state.blobs.get(best.hash)!;
		
		let stale = meta.editedByModel === true;
		if (!stale) {
			try {
				const st = statSync(real);
				if (meta.fileMtime !== undefined && (st.mtimeMs !== meta.fileMtime || st.size !== meta.fileSize)) stale = true;
			} catch {
				stale = true; 
			}
		}
		if (stale) {
			this.windowCounters.windowMissStale++;
			this.windowCounters.windowRereadModified++;
			return undefined;
		}
		
		const sliced = formatWindow(content, offset, limit);
		if (sliced === null) {
			this.windowCounters.windowMissOutOfBounds++;
			return undefined;
		}
		this.windowCounters.windowServed++;
		this.emit('store', 'info', { action: 'window-serve', path: real, offset, limit, bytes: sliced.length });
		
		
		this.markServed(best.hash);
		return {
			hash: best.hash,
			content: sliced,
			ref: `[blob:${meta.hash.slice(0, this.config.hashPrefixChars)}:${content.length}]`,
			stale: false,
			ageMs: Date.now() - (meta.lastRef || meta.createdAt || Date.now()),
		};
	}

	
	private smartCompress(content: string): string | undefined {
		const type = detectType(content).type;
		try {
			switch (type) {
				case 'json': {
					
					const parsed = JSON.parse(content);
					if (Array.isArray(parsed)) {
						const tab = compactTable(parsed);
						if (tab.wasCompacted) return tab.text;
						const crushed = crushJsonText(content);
						if (crushed.wasCrushed) return crushed.text;
					}
					return undefined;
				}
				case 'log': {
					const st = compressStackTraces(content);
					if (st.wasCompressed) return st.text;
					
					
					
					const lc = collapseLogLines(content);
					if (lc.wasCollapsed) return lc.text;
					return undefined;
				}
				case 'text': {
					const tc = crushText(content, {
						minChars: Math.max(2000, this.config.compressMinChars),
						targetRatio: this.config.compressTargetRatio,
					});
					if (tc.wasCrushed) return tc.text;
					return undefined;
				}
				default:
					
					
					return undefined;
			}
		} catch {
			return undefined;
		}
	}

	

	
	private estimateContextTokens(messages: Array<{ role: string; content: unknown }>): number {
		let chars = 0;
		for (const m of messages) {
			if (typeof m.content === 'string') chars += m.content.length;
			else if (Array.isArray(m.content)) {
				for (const b of m.content as Array<{ type?: string; text?: string }>) {
					if (typeof b?.text === 'string') chars += b.text.length;
				}
			}
		}
		return Math.round(chars / this.meter.estimateCharsPerToken);
	}

	async transformContext(opts: { messages?: Array<{ role: string; content: unknown }> }): Promise<{ messages?: Array<{ role: string; content: unknown }> } | undefined> {
		if (!this.config.enabled || !this.live) return undefined;
		if (!breakerAllowed(this.breakers['view'] ?? CLOSED)) return undefined;
		const messages = opts.messages;
		if (!messages || messages.length === 0) return undefined;
		const start = Date.now();
		
		
		
		
		
		
		if (this.config.enabled && this.live) {
			const summary = messages.find(m => (m as { meta?: { isSummary?: boolean } }).meta?.isSummary === true);
			if (summary) {
				const id = sha256Hex(JSON.stringify(summary));
				if (id !== this.lastSummaryId) {
					this.lastSummaryId = id;
					this.bumpEpoch();
					this.emit('guard', 'debug', { action: 'epoch-bump', epoch: this.compactionEpoch, source: 'isSummary' });
				}
			}
		}
		
		if (!this.localePinned) this.pinLocale(this.config.locale);
		
		
		
		{
			let userText = '';
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m.role === 'user' && typeof m.content === 'string') { userText = m.content; break; }
			}
			if (userText) updateActiveFiles(this.activeFiles, userText);
		}

		
		
		
		
		
		if (!this.config.viewEnabled) {
			const compressed = this.compressMessagesOnly(messages);
			
			
			const changed = compressed.some((m, i) => m !== messages[i]);
			
			
			if (changed) {
				const before = this.estimateContextTokens(messages);
				const after = this.estimateContextTokens(compressed);
				this.emit('view', 'info', {
					action: 'tokens',
					before,
					after,
					saved: before - after,
					messages: messages.length,
				});
				return { messages: compressed };
			}
			return undefined;
		}

		const result = buildView({
			state: this.state,
			blobContents: this.blobContents,
			config: this.config,
			i18n: this.i18n,
			messages: messages as Array<{ role: string; content: string }>,
			toolCallHistory: this.toolCalls,
		});

		
		
		
		let view = result.view;
		if (view.length > 0) {
			const lines = view.split('\n');
			const out: string[] = [];
			let codeBlock: string[] = [];
			const flush = () => {
				if (codeBlock.length >= 4) {
					const code = codeBlock.join('\n');
					const sk = skeletonize(code, 'ts');
					if (sk.wasCompressed) {
						
						
						out.push(sk.text);
						this.emit('view', 'info', { action: 'skeleton', bytes: code.length - sk.text.length });
						codeBlock = [];
						return;
					}
				}
				out.push(...codeBlock);
				codeBlock = [];
			};
			for (const line of lines) {
				const isCode = /^\s*[{\[\(]/.test(line) || /^\s*(export |import |function |const |let |async |pub fn|fn |def |func |interface |type |class )/.test(line) || /[{}]$/.test(line.trimEnd()) || /\t/.test(line);
				if (isCode) {
					codeBlock.push(line);
				} else {
					flush();
					out.push(line);
				}
			}
			flush();
			view = out.join('\n');
		}

		
		
		{
			let ctxChars = 0;
			for (const m of messages) {
				if (typeof m.content === 'string') ctxChars += m.content.length;
				else if (Array.isArray(m.content)) {
					for (const b of m.content as unknown[]) {
						if (b && typeof b === 'object') {
							const t = (b as { text?: unknown }).text;
							if (typeof t === 'string') ctxChars += t.length;
						}
					}
				}
			}
			if (ctxChars > 0) this.lastCalibChars = ctxChars;
		}

		
		if (view.length > 0 && this.config.maxViewTokens > 0) {
			const approx = estimateTokens(view, this.meter.estimateCharsPerToken);
			if (approx > this.config.maxViewTokens) {
				
				const keepChars = Math.floor(this.config.maxViewTokens * this.meter.estimateCharsPerToken * 0.9);
				const trimmed = view.slice(0, Math.max(256, keepChars));
				this.emit('view', 'info', { action: 'budget', trimmedBytes: view.length - trimmed.length });
				view = trimmed + '\n[view trimmed to token budget]';
			}
			
			const bi = budgetInfo(this.lastContextTokens, this.config.warnThresholdPct, this.config.maxViewTokens);
			if (bi?.warn) {
				const pct = Math.round((1 - bi.headroomPct) * 100);
				this.emit('usage', 'warn', { action: 'context-warn', pct });
				this.deps.host?.notify?.(this.i18n.t('notify.warnContext').replace('{pct}', String(pct)));
			}
		}

		this.emit('view', 'debug', { action: result.unchanged ? 'unchanged' : 'transform', bytes: view.length });
		this.emit('hook', 'debug', { action: 'transformContext', ms: Date.now() - start });

		if (result.unchanged) return undefined;
		
		const compressedMessages = this.compressMessagesOnly(messages);
		const outMessages: Array<{ role: string; content: unknown }> = [...compressedMessages, { role: 'system', content: [{ type: 'text', text: view }] }];
		
		this.overheadTokens += estimateTokens(view, this.meter.estimateCharsPerToken);
		return { messages: outMessages };
	}

	







	private compressMessagesOnly(messages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: unknown }> {
		const compressedMessages = messages.slice(0, -1); 
		const last = messages[messages.length - 1];
		if (!last) return compressedMessages;
		if (this.config.compressEnabled && breakerAllowed(this.breakers['view'] ?? CLOSED)) {
			if (typeof last.content === 'string' && last.content.length >= this.config.compressMinChars) {
				const lang = this.config.language === 'auto' ? 'auto' : this.config.language;
				const r = compressText(last.content, {
					minChars: this.config.compressMinChars,
					targetRatio: this.config.compressTargetRatio,
					language: lang,
				});
				if (r.wasCompressed) {
					
					
					
					
					
					
					
					
					const frozenText = compressedMessages.map(m => extractText(m.content)).join('');
					const lcp = checkLcp(frozenText, frozenText);
					if (!lcp.pass) {
						this.fidelityMeter.frozenRewriteRefusals++;
						this.emit('view', 'warn', { action: 'frozen-rewrite-refused', lcpRatio: lcp.ratio, frozenChars: frozenText.length });
					} else {
						this.emit('view', 'info', { action: 'frozen-lcp-ok', frozenChars: frozenText.length });
					}
					this.emit('view', 'info', { action: 'compress', role: last.role, saved: last.content.length - r.text.length });
					compressedMessages.push({ role: last.role, content: r.text });
					return compressedMessages;
				}
			}
		}
		compressedMessages.push(last);
		return compressedMessages;
	}

	

	


	private ensureTermIndex(): void {
		if (this.termIndex !== undefined && this.termIndexRev === this.state.indexRev) return;
		const idx = emptyIndex();
		for (const [hash, meta] of this.state.blobs) {
			const content = this.blobContents.get(hash);
			if (content === undefined) continue;
			indexAdd(idx, { hash, content, path: meta.realPath ?? meta.filePath });
		}
		this.termIndex = idx;
		this.termIndexRev = this.state.indexRev;
	}

	async recall(query: string, limit = 5, opts: { fullContent?: boolean } = {}): Promise<{ hits: RecallHit[]; staleHints: StaleHint[]; total: number }> {
		this.recallMeter.recalls++;
		this.fidelityMeter.recallCalls++;
		
		
		if (!query || query.trim() === '') return { hits: [], staleHints: [], total: 0 };
		await this.serialized(async () => {
			
			
			
			
			
			try {
				const { state: diskState } = await this.deps.store.loadState();
				if (diskState.indexRev > this.state.indexRev || [...diskState.blobs.keys()].some(h => !this.state.blobs.has(h))) {
					for (const [hash, meta] of diskState.blobs) {
						if (!this.state.blobs.has(hash)) {
							this.state.blobs.set(hash, meta);
							
							this.termIndex = undefined;
							this.termIndexRev = -1;
						}
					}
					this.state.indexRev = Math.max(this.state.indexRev, diskState.indexRev);
				}
			} catch {}
			
			for (const [hash] of this.state.blobs) {
				if (!this.blobContents.has(hash)) {
					const c = await this.deps.store.readBlob(hash);
					if (c !== undefined) this.blobContents.set(hash, c);
				}
			}
		});
		
		
		
		const safeQuery = query.slice(0, 512);
		let pattern: RegExp;
		try {
			pattern = new RegExp(safeQuery, 'i');
		} catch {
			pattern = new RegExp(safeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
		}
		
		
		
		
		
		const terms = safeQuery.trim().split(/\s+/).filter(t => t.length > 0);
		const multiTerm = terms.length > 1;
		const hits: RecallHit[] = [];
		const staleHints: StaleHint[] = [];
		let total = 0;
		
		
		
		const ws = this.workspace;
		const all = [...this.state.blobs.entries()];
		
		
		const newestByCmd = new Map<string, { hash: string; lastRef: number }>();
		for (const [hash, meta] of all) {
			if (!meta.workspace || meta.workspace !== ws) continue;
			const key = `${meta.source}|${meta.command ?? ''}`;
			const prev = newestByCmd.get(key);
			if (!prev || meta.lastRef > prev.lastRef) newestByCmd.set(key, { hash, lastRef: meta.lastRef });
		}
		
		
		
		
		
		
		let candidates = all;
		if (multiTerm) {
			this.ensureTermIndex();
			const queryTermsClean = terms.map(t => t.toLowerCase());
			const indexed = indexQuery(this.termIndex!, queryTermsClean);
			if (indexed.length > 0) {
				this.recallMeter.pathLookups++;
				const set = new Set(indexed);
				candidates = all.filter(([h]) => set.has(h));
			}
			
			
		} else {
			
			
			if (/[\\/.]/.test(safeQuery)) {
				this.ensureTermIndex();
				const indexed = indexPathLookup(this.termIndex!, safeQuery);
				if (indexed.length > 0) {
					this.recallMeter.pathLookups++;
					const set = new Set(indexed);
					candidates = all.filter(([h]) => set.has(h));
				}
			}
		}
		const now = Date.now();
		for (const [hash, meta] of candidates) {
			
			
			
			if (meta.workspace && meta.workspace !== ws) continue;
			if (!meta.workspace && ws) continue;
			
			
			
			if (meta.source === 'edit_file' || meta.source === 'write_file'
				|| meta.source === 'apply_patch' || meta.source === 'create_file') {
				continue;
			}
			const content = this.blobContents.get(hash);
			if (content === undefined) continue;
			
			
			
			
			let matched = false;
			let matchIndex = -1;
			if (multiTerm) {
				for (const t of terms) {
					const idx = content.toLowerCase().indexOf(t.toLowerCase());
					if (idx !== -1) { matched = true; matchIndex = idx; break; }
				}
			} else {
				const m = pattern.exec(content);
				if (m !== null) { matched = true; matchIndex = m.index; }
			}
			if (!matched) continue;
			total++;
			const short = meta.hash.slice(0, this.config.hashPrefixChars);
			
			
			let fileNow: FreshnessSignals['fileNow'] = undefined;
			let shellFileNow: FreshnessSignals['shellFileNow'] = undefined;
			let dirNow: FreshnessSignals['dirNow'] = undefined;
			if (meta.source === 'read_file' && meta.filePath) {
				try {
					const st = statSync(resolveTildePath(meta.filePath));
					fileNow = { mtimeMs: st.mtimeMs, size: st.size };
				} catch {
					fileNow = null; 
				}
			}
			if (meta.source === 'shell_command' && meta.filePath && meta.dirMtime === undefined) {
				try {
					const st = statSync(resolveTildePath(meta.filePath));
					shellFileNow = { mtimeMs: st.mtimeMs, size: st.size };
				} catch {
					shellFileNow = null; 
				}
			}
			if (meta.source === 'shell_command' && meta.filePath && meta.dirMtime !== undefined) {
				try {
					const sig = dirSignature(resolveTildePath(meta.filePath));
					dirNow = sig ?? null; 
				} catch {
					dirNow = null; 
				}
			}
			const key = `${meta.source}|${meta.command ?? ''}`;
			const newest = newestByCmd.get(key);
			
			
			
			
			const sameContentAsNewest = newest !== undefined && newest.hash !== hash
				&& this.blobContents.get(newest.hash) === content;
			const supplanted = newest !== undefined && newest.hash !== hash && !sameContentAsNewest;
			const conf = scoreConfidence(freshnessSignals(meta, ws, { fileNow, shellFileNow, dirNow }, { supplanted }));
			
			
			
			if (conf.stale) {
				this.recallMeter.droppedStale++;
				const reason = conf.flags.includes('file modified') ? 'file changed since ingest — re-read the source'
					: conf.flags.includes('file deleted') ? 'file deleted since ingest'
					: conf.flags.includes('other workspace') ? 'other workspace'
					: conf.flags.includes('edited by model') ? 'edited by the model — re-read the source'
					: conf.flags.join(', ') || 'stale';
				staleHints.push({ short, ref: `[blob:${short}:${content.length}]`, reason, score: conf.score, flags: conf.flags });
				continue;
			}
			
			
			
			
			meta.lastRef = now;
			
			
			
			
			
			
			const budget = this.config.recallBudgetChars;
			const fileProven = (meta.source === 'read_file' || meta.source === 'shell_command') && meta.fileMtime !== undefined;
			const ageMs = now - (meta.contentAt ?? meta.createdAt ?? now);
			const ageBudget = fileProven ? budget
				: ageMs < 60 * 60_000 ? budget
				: ageMs < 24 * 60 * 60_000 ? Math.floor(budget * 0.75)
				: Math.floor(budget * 0.5);
			let slice: string;
			
			
			
			
			const fullCap = 24 * 1024;
			const canFull = opts.fullContent === true
				&& meta.fullFile === true
				&& content.length <= fullCap
				&& !conf.stale;
			if (canFull) {
				slice = content;
			} else if (content.length <= ageBudget) {
				slice = content;
			} else {
				const start = Math.max(0, matchIndex - Math.floor(ageBudget / 2));
				slice = content.slice(start, start + ageBudget);
				if (slice.length < ageBudget) slice = content.slice(Math.max(0, content.length - ageBudget));
			}
			this.recallMeter.served++;
			
			this.recallInjectedChars += slice.length;
			hits.push({
				short,
				ref: `[blob:${short}:${content.length}]`,
				content: slice,
				score: conf.score,
				flags: conf.flags,
				stale: conf.stale,
			});
		}
		
		
		
		
		
		
		let idf: import('../core/relevance.ts').IdfTable | undefined;
		if (this.termIndex !== undefined) {
			this.ensureTermIndex();
			idf = buildIdf(this.termIndex, this.state.blobs.size);
		}
		const relevance = scoreRelevanceHits(hits, query, idf, this.state.blobs.size);
		
		
		
		
		
		
		
		const rankRel = new Map<string, number>();
		const rankConf = new Map<string, number>();
		hits.forEach((h, i) => rankRel.set(h.ref, i + 1));
		[...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).forEach((h, i) => rankConf.set(h.ref, i + 1));
		const fused = rrfFuse(hits.map(h => ({ item: h, ranks: [rankRel.get(h.ref) ?? 0, rankConf.get(h.ref) ?? 0] })));
		hits.length = 0;
		for (const f of fused) hits.push(f as RecallHit);
		void relevance; 
		this.recallMeter.indexSize = this.termIndex?.size ?? 0;
		
		
		
		const outcome: 'stale' | 'miss' | 'hit' =
			hits.length > 0 ? 'hit' : staleHints.length > 0 ? 'stale' : 'miss';
		this.lastRecallOutcome = outcome;
		const avgScore = hits.length > 0
			? Math.round(hits.reduce((a, h) => a + (h.score ?? 0), 0) / hits.length)
			: undefined;
		this.emit('store', 'info', {
			action: 'recall',
			query: redact(query).text,
			bytes: hits.reduce((a, h) => a + h.content.length, 0),
			served: hits.length,
			stale: staleHints.length,
			miss: hits.length === 0 && staleHints.length === 0,
			score: avgScore,
		});
		
		
		
		
		
		
		if (hits.length > 0) {
			for (const h of hits) {
				if (h.score !== undefined) {
					this.calibrationSamples.push({ confidence: h.score / 100, used: false });
				}
			}
			if (this.calibrationSamples.length > 500) {
				this.calibrationSamples.splice(0, this.calibrationSamples.length - 500);
			}
		}
		return { hits, staleHints, total };
	}

	


	markFollowedBy(toolName: string): void {
		if (this.lastRecallOutcome !== undefined) {
			const wasFollowedByRead = toolName === 'read_file';
			this.behavior.recallThenRead += (wasFollowedByRead && this.lastRecallOutcome !== 'hit') ? 1 : 0;
			
			
			
			if (wasFollowedByRead && this.lastRecallOutcome !== 'hit') {
				for (let i = this.calibrationSamples.length - 1; i >= 0; i--) {
					if (this.calibrationSamples[i].used) this.calibrationSamples[i].used = false;
				}
			}
			this.lastRecallOutcome = undefined;
		}
	}

	
	
	
	
	
	
	
	

	async toolHit(toolName: string, input: Record<string, unknown>): Promise<{
		hash: string;
		content: string;
		ref: string;
		stale: boolean;
		ageMs: number;
		


		fidelityServe?: boolean;
	} | undefined> {
		if (!this.config.enabled || !this.live) return undefined;
		
		if (!['shell_command', 'read_file', 'read_directory', 'read_multiple_files', 'grep', 'glob'].includes(toolName)) return undefined;
		
		let key: string | undefined;
		if (toolName === 'shell_command') {
			const c = typeof input.command === 'string' ? input.command : undefined;
			key = c ? c.trim().replace(/\s+/g, ' ') : undefined;



			if (key) {
				const never = (this.config.neverElidePrefixes || []).some(p => key!.startsWith(p))
					|| isSideEffectCommand(key);
				if (never) return undefined;
			}
		} else {
			
			const p = typeof input.file_path === 'string' ? input.file_path
				: typeof input.path === 'string' ? input.path
				: typeof input.file === 'string' ? input.file
				: undefined;
			key = p ? p.replace(/\/+$/, '') : undefined; 
		}
		if (!key) return undefined;
		
		
		
		
		let realKey: string | undefined;
		if (toolName === 'read_file') {
			try {
				realKey = realpathSync(key);
			} catch {
				realKey = undefined; 
			}
		}
		
		
		
		
		
		
		if (toolName === 'read_file' && looksWindowed(input)) {
			this.windowCounters.windowedRead++;
			if (!this.config.elideWindowedReads) return undefined;
			
			
			
			const served = await this.tryServeWindowed(realKey ?? key, input);
			if (served) return served;
			this.behavior.readsWithoutPriorRecall++;
			this.emit('store', 'info', { action: 'tool-hit', tool: toolName, key: redact(key).text, toolHit: false, hitReason: 'windowed-no-blob' });
			return undefined; 
		}
		
		
		
		
		
		
		if (!this.lastIndexSync || Date.now() - this.lastIndexSync > 1000) {
			await this.serialized(async () => {
				try {
					const { state: diskState } = await this.deps.store.loadState();
					if (diskState.indexRev > this.state.indexRev) {
						for (const [hash, meta] of diskState.blobs) {
							if (!this.state.blobs.has(hash)) this.state.blobs.set(hash, meta);
						}
						this.state.indexRev = diskState.indexRev;
					}
				} catch {}
				for (const [hash] of this.state.blobs) {
					if (!this.blobContents.has(hash)) {
						const c = await this.deps.store.readBlob(hash);
						if (c !== undefined) this.blobContents.set(hash, c);
					}
				}
			});
			this.lastIndexSync = Date.now();
		}
		const ws = this.workspace;
		let best: { hash: string; lastRef: number; createdAt: number; fullFile: boolean } | undefined;
		
		
		
		
		
		
		
		for (const [hash, meta] of this.state.blobs) {
			if (meta.source !== toolName) continue;
			if (meta.workspace && meta.workspace !== ws) continue;
			if (!meta.workspace && ws) continue; 
			
			let matches = false;
			if (toolName === 'shell_command') {
				if (!meta.command) continue;
				matches = meta.command.trim().replace(/\s+/g, ' ') === key;
			} else {
				
				
				
				
				const rp = meta.realPath || '';
				const fp = (meta.filePath || '').replace(/\/+$/, '');
				if (toolName === 'read_file' && realKey !== undefined && rp) {
					matches = rp === realKey;
				} else {
					if (!fp) continue;
					matches = fp === key;
				}
				
				
				
				if (matches && (toolName === 'grep' || toolName === 'glob')) {
					const pattern = typeof input.pattern === 'string' ? input.pattern : undefined;
					matches = (meta.searchPattern ?? undefined) === pattern;
				}
			}
			if (!matches) continue;
			
			
			
			
			
			
			
			const isFull = meta.fullFile === true;
			const lastRef = meta.lastRef || 0;
			const createdAt = meta.createdAt || 0;
			const better =
				!best ||
				(isFull !== best.fullFile
					? !isFull 
					: lastRef > best.lastRef || (lastRef === best.lastRef && createdAt >= best.createdAt));
			if (better) {
				best = { hash, lastRef, createdAt, fullFile: isFull };
			}
		}
		if (!best) {
			
			
			
			this.behavior.readsWithoutPriorRecall++;
			this.emit('store', 'info', { action: 'tool-hit', tool: toolName, key: redact(key).text, toolHit: false, hitReason: 'no-blob' });
			return undefined;
		}
		const content = this.blobContents.get(best.hash);
		if (content === undefined) {
			this.behavior.readsWithoutPriorRecall++;
			this.emit('store', 'info', { action: 'tool-hit', tool: toolName, key: redact(key).text, toolHit: false, hitReason: 'no-content' });
			return undefined;
		}
		const meta = this.state.blobs.get(best.hash)!;
		const ageMs = Date.now() - (meta.contentAt ?? meta.createdAt ?? Date.now());
		
		
		
		
		
		
		
		
		
		
		
		
		let fileNow: FreshnessSignals['fileNow'] = undefined;
		let shellFileNow: FreshnessSignals['shellFileNow'] = undefined;
		let dirNow: FreshnessSignals['dirNow'] = undefined;
		
		
		
		const statPath = (toolName === 'read_file' && realKey !== undefined) ? realKey : (meta.filePath || '');
		if (toolName === 'read_file' && statPath) {
			try {
				const st = statSync(statPath);
				fileNow = { mtimeMs: st.mtimeMs, size: st.size };
			} catch {
				fileNow = null; 
			}
		}
		if (toolName === 'shell_command' && meta.filePath && meta.dirMtime === undefined) {
			try {
				const st = statSync(resolveTildePath(meta.filePath));
				shellFileNow = { mtimeMs: st.mtimeMs, size: st.size };
			} catch {
				shellFileNow = null; 
			}
		}
		if (toolName === 'shell_command' && meta.filePath && meta.dirMtime !== undefined) {
			try {
				const sig = dirSignature(resolveTildePath(meta.filePath));
				dirNow = sig ?? null; 
			} catch {
				dirNow = null; 
			}
		}
		const conf = scoreConfidence(freshnessSignals(meta, ws, { fileNow, shellFileNow, dirNow }, { now: Date.now() }));
		if (conf.stale) {
			this.emit('store', 'info', { action: 'tool-hit', tool: toolName, key: redact(key).text, bytes: content.length, stale: true, reason: 'stale-not-served', toolHit: false, hitReason: 'stale' });
			this.behavior.readsWithoutPriorRecall++;
			return undefined;
		}
		this.emit('store', 'info', { action: 'tool-hit', tool: toolName, key: redact(key).text, bytes: content.length, stale: false, toolHit: true });
		
		
		
		
		const fidelityServe = !this.isStubSafe(best.hash);
		
		
		this.markServed(best.hash);
		return {
			hash: best.hash,
			content,
			ref: `[blob:${meta.hash.slice(0, this.config.hashPrefixChars)}:${content.length}]`,
			stale: false,
			ageMs,
			fidelityServe,
		};
	}

	

	get fidelityServeCap(): number {
		return this.config.fidelityServeChars;
	}

	

	onUsage(usage: { inputTokens?: number; outputTokens?: number; cacheRead?: number; model?: string }): void {
		const sample = {
			inputTokens: usage.inputTokens ?? 0,
			outputTokens: usage.outputTokens ?? 0,
			cacheRead: usage.cacheRead ?? 0,
		};
		this.usages.push(sample);
		if (this.usages.length > 500) this.usages.shift();
		this.lastContextTokens = sample.inputTokens;
		if (usage.model) this.currentModel = usage.model;
		
		
		
		if (this.lastCalibChars > 0 && sample.inputTokens > 0) {
			this.meter = calibrateEstimate(this.meter, { actualChars: this.lastCalibChars, actualTokens: sample.inputTokens });
		}
		this.emit('usage', 'debug', { action: 'request', ...sample, model: usage.model });
	}

	

	async onTurnEnd(): Promise<void> {
		for (const layer of Object.keys(this.breakers)) {
			this.breakers[layer] = advanceTurn(this.breakers[layer], this.config.breakerHalfOpenTurns);
		}
		
		
		
		if (this.errors === this.errorsAtLastTurn) {
			for (const layer of Object.keys(this.breakers)) this.onLayerSuccess(layer);
		}
		this.errorsAtLastTurn = this.errors;
		
		
		await this.log.flush();
	}

	onLayerFailure(layer: string): void {
		this.breakers[layer] = recordFailure(this.breakers[layer] ?? CLOSED, this.config.breakerThreshold);
		if (this.breakers[layer].state === 'open') {
			this.emit('breaker', 'warn', { layer, state: 'open' });
			this.deps.host?.notify?.(this.i18n.t('notify.breakerOpen'));
		}
	}

	onLayerSuccess(layer: string): void {
		this.breakers[layer] = recordSuccess(this.breakers[layer] ?? CLOSED);
		if (this.breakers[layer].state === 'closed' && (this.breakers[layer] as BreakerStatus).failures === 0) {
			
		}
	}

	

	


	private bumpEpoch(): void {
		this.compactionEpoch++;
	}

	

	private markServed(hash: string): void {
		if (this.servedEpochLru.has(hash)) {
			this.servedEpochLru.delete(hash); 
		}
		this.servedEpochLru.set(hash, true);
		if (this.servedEpochLru.size > 256) {
			const oldest = this.servedEpochLru.keys().next().value;
			if (oldest !== undefined) {
				this.servedEpochLru.delete(oldest);
				this.servedSinceEpoch.delete(oldest);
			}
		}
		this.servedSinceEpoch.set(hash, this.compactionEpoch);
	}

	


	private isStubSafe(hash: string): boolean {
		return this.servedSinceEpoch.get(hash) === this.compactionEpoch;
	}

	onCompactionStart(): void {
		
		
		
		this.bumpEpoch();
		if (!this.config.compactGuard) {
			this.emit('guard', 'debug', { action: 'skip', reason: 'guard disabled' });
			return;
		}
		
		
		
		const storeBlobs = this.state.blobs.size;
		const storeBytes = [...this.state.blobs.values()].reduce((a, b) => a + b.size, 0);
		const summary = buildStateSummary({
			sections: {
				'Active Plan': this.snapshot.startedAt
					? `Session ${this.sessionId} started at ${new Date(this.snapshot.startedAt).toISOString()}`
					: 'No active plan recorded.',
				'Current Phase': this.config.enabled ? 'compression active (digest + prose)' : 'disabled',
				'Editing Files': [...this.activeFiles.entries.keys()].join(', ') || 'None mentioned in this session.',
				'Session Decisions': `recalls=${this.snapshot.recalls}, relevant=${this.snapshot.recallAppropriate}, errors=${this.snapshot.errors}`,
				'Store': `${storeBlobs} blobs · ${storeBytes} bytes (content-addressable, recall via deepshrink_recall)`,
				'Usage': `input tokens=${this.snapshot.totalInputTokens}, output=${this.snapshot.totalOutputTokens}, cache read=${this.snapshot.cacheReadTokens}`,
				'Recovery Notes': 'Stored content is re-fetchable with deepshrink_recall <regex>; files verified by mtime (STALE flag when modified).',
			},
		});
		this.guard.stateSummary = summary;
		this.emit('guard', 'info', { action: 'state' });
	}

	



	async onCompactionDone(): Promise<string> {
		if (!this.config.compactGuard || !this.guard.stateSummary) return '';
		const delivered = markDelivered(this.guard, this.sessionId, 'compact-summary');
		if (!delivered) return '';
		this.emit('guard', 'info', { action: 'compacted' });
		return this.guard.stateSummary;
	}

	

	async runGc(force = false): Promise<{ removed: number; remaining: number }> {
		const before = new Set(this.state.blobs.keys());
		const res = gcStore(this.state, {
			minAgeMs: force ? 0 : this.config.gcMinBlobAgeMs,
			activeSessions: this.deps.registry.activeSessions(),
		});
		for (const [hash] of this.state.blobs) {
			if (!this.blobContents.has(hash)) {
				const c = await this.deps.store.readBlob(hash);
				if (c !== undefined) this.blobContents.set(hash, c);
			}
		}
		
		if (this.termIndex !== undefined && res.removed > 0) {
			for (const [hash] of before) {
				if (!this.state.blobs.has(hash)) indexRemove(this.termIndex, hash);
			}
		}
		await this.deps.store.checkpoint(this.state);
		if (res.removed > 0) {
			this.emit('store', 'info', { action: 'gc', blobs: res.removed });
			this.deps.host?.notify?.(this.i18n.t('notify.gcDone', { n: res.removed }));
		}
		return { removed: res.removed, remaining: res.blobsRemaining };
	}

	
	async purgeStore(): Promise<{ blobs: number; events: number }> {
		const blobs = await this.deps.store.listBlobs();
		for (const f of blobs) {
			try { await this.deps.store.deleteBlob(f); } catch {}
		}
		this.state = { blobs: new Map(), indexRev: 0 };
		this.blobContents.clear();
		this.termIndex = undefined;
		this.termIndexRev = -1;
		this.toolCalls = [];
		await this.deps.store.checkpoint(this.state);
		
		
		await this.deps.store.markPurged();
		this.purgeStamp = await this.deps.store.purgedAt();
		const events = await this.log.clear();
		this.emit('store', 'info', { action: 'purge', blobs: blobs.length, events });
		return { blobs: blobs.length, events };
	}

	
	async purgeWorkspace(): Promise<{ blobs: number }> {
		const ws = this.workspace.replace(/\/$/, '');
		const toDelete: string[] = [];
		for (const [hash, meta] of this.state.blobs) {
			
			
			
			
			const wsMatch = meta.workspace && meta.workspace.replace(/\/$/, '') === ws;
			const orphan = !meta.workspace;
			if (wsMatch || orphan) {
				toDelete.push(hash);
			}
		}
		for (const hash of toDelete) {
			try { await this.deps.store.deleteBlob(hash); } catch {}
			this.state.blobs.delete(hash);
			this.blobContents.delete(hash);
			indexRemove(this.termIndex, hash);
		}
		await this.deps.store.checkpoint(this.state);
		
		
		
		if (toDelete.length > 0) {
			await this.deps.store.markPurged();
			this.purgeStamp = await this.deps.store.purgedAt();
		}
		this.emit('store', 'info', { action: 'purge-workspace', blobs: toDelete.length, workspace: ws });
		return { blobs: toDelete.length };
	}

	

	stats(): ReturnType<typeof computeStats> {
		return computeStats({
			usages: this.usages,
			totalCharsIn: 0,
			totalCharsOut: 0,
			ruleSaves: this.ruleSaves,
			overheadTokens: this.overheadTokens,
			recallInjectedTokens: Math.round(this.recallInjectedChars / this.config.estimateCharsPerToken),
			recalls: this.snapshot.recalls,
			reReads: this.reReads,
			errors: this.errors,
			price: this.currentModel ? this.deps.pricing.get(this.currentModel) : undefined,
			windowedRead: this.windowCounters.windowedRead,
			windowServed: this.windowCounters.windowServed,
			windowMissNoBlob: this.windowCounters.windowMissNoBlob,
			windowMissStale: this.windowCounters.windowMissStale,
			windowMissOutOfBounds: this.windowCounters.windowMissOutOfBounds,
			windowRereadModified: this.windowCounters.windowRereadModified,
			recallMeter: { ...this.recallMeter, indexSize: this.termIndex?.size ?? 0 },
			readsWithoutPriorRecall: this.behavior.readsWithoutPriorRecall,
			recallThenRead: this.behavior.recallThenRead,
			supersededByEdit: this.snapshot.supersededByEdit,
			supersededReIngest: this.snapshot.supersededReIngest,
		});
	}

	


	private async syncAfterPurge(): Promise<void> {
		try {
			const purged = await this.deps.store.purgedAt();
			if (purged > this.purgeStamp) {
				this.purgeStamp = purged;
				const { state } = await this.deps.store.loadState();
				this.state = state;
				this.blobContents.clear();
				this.termIndex = undefined;
				this.termIndexRev = -1;
				this.emit('store', 'info', { action: 'purge-resync' });
			}
		} catch {}
	}

	async cmdStatus(): Promise<string> {
		await this.syncAfterPurge();
		const s = this.stats();
		const lines = [
			`session: ${this.sessionId === 'unknown' ? '(waiting for run…)' : this.sessionId}`,
			`enabled: ${this.config.enabled ? flexoki.green('● ON') : flexoki.red('● OFF')}`,
			`locale: ${this.config.locale}${this.localePinned ? '' : ' (auto)'}`,
			`guard (compaction protection): ${this.config.compactGuard ? flexoki.green('● ON') : flexoki.red('● OFF')}`,
			``,
			`store: ${this.state.blobs.size} blobs · ${[...this.state.blobs.values()].reduce((a, b) => a + b.size, 0)} bytes`,
			`recalls (session): ${this.snapshot.recalls} · relevant: ${this.snapshot.recallAppropriate}`,
			`recall path: ${this.recallMeter.recalls} calls · ${this.recallMeter.served} served · ${this.recallMeter.droppedStale} stale-dropped · index ${this.termIndex?.size ?? 0} terms`,
			`fidelity: ${this.fidelityMeter.fidelityServes} real serves · ${this.fidelityMeter.stubServes} stubs (${this.fidelityMeter.postCompactionStubs} post-compaction) · ${this.fidelityMeter.recallCalls} recalls`,
			`reads: ${s.readsWithoutPriorRecall} without prior recall · ${s.recallThenRead} after stale/missed recall`,
			`superseded: ${s.supersededByEdit} edited · ${s.supersededReIngest} same-hash re-ingest`,
			`breaker: ${Object.entries(this.breakers).map(([k, v]) => `${k}=${v.state === 'open' ? flexoki.red(v.state) : v.state === 'half-open' ? flexoki.yellow(v.state) : flexoki.green(v.state)}`).join(', ') || 'all closed'}`,
			``,
			`cache hit: ${s.cacheHitRatio === null ? 'n/a (no usage yet)' : (s.cacheHitRatio * 100).toFixed(1) + '%'}`,
			`net gain: ${s.netGainTokens >= 0 ? '+' : ''}${Math.round(s.netGainTokens)} tokens (overhead ${Math.round(s.overheadTokens)})`,
			`window: served ${s.windowServed}/${s.windowedRead} · miss(no-blob ${s.windowMissNoBlob}, stale ${s.windowMissStale}, oob ${s.windowMissOutOfBounds}) · reread-modified ${s.windowRereadModified}`,
			`cost: $${s.costUsd.toFixed(2)} · model: ${this.currentModel || 'n/a'}`,
		];
		return lines.join('\n');
	}

	async cmdStats(): Promise<string> {
		const s = this.stats();
		const eceResult = this.calibrationSamples.length >= 10
			? expectedCalibrationError(this.calibrationSamples)
			: { ece: 0, totalSamples: this.calibrationSamples.length };
		const lines = [
			`break-even: ${s.breakEvenPositive ? flexoki.green('POSITIVE') : flexoki.red('NEGATIVE')} (${Math.round(s.netGainTokens)} tokens)`,
			`  saved: ${Math.round(s.savedTokens)} · overhead: ${Math.round(s.overheadTokens)} · recall re-injected: ${Math.round(this.recallInjectedChars / this.config.estimateCharsPerToken)}`,
			`cache-hit ratio: ${s.cacheHitRatio === null ? 'n/a (no usage yet)' : (s.cacheHitRatio * 100).toFixed(1) + '%'}`,
			`re-read: ${(s.reReadRate * 100).toFixed(1)}% · errors: ${(s.errorRate * 100).toFixed(1)}%`,
			`reads without prior recall: ${s.readsWithoutPriorRecall} · after stale/miss recall: ${s.recallThenRead}`,
			`superseded: ${s.supersededByEdit} edited · ${s.supersededReIngest} same-hash re-ingest`,
			`frozen-rewrite refusals (LCP guard): ${this.fidelityMeter.frozenRewriteRefusals}`,
			`recall calibration (ECE, ${eceResult.totalSamples} samples): ${(eceResult.ece * 100).toFixed(1)}%`,
			``,
			`tokens in: ${s.totalInputTokens} · out: ${s.totalOutputTokens} · cache read: ${s.totalCacheRead}`,
			`cost: $${s.costUsd.toFixed(2)} (in $${s.costInputUsd.toFixed(2)} · out $${s.costOutputUsd.toFixed(2)} · cache $${s.costCacheUsd.toFixed(2)})${s.costUsd === 0 && s.totalInputTokens === 0 ? ' — no usage yet' : ''}`,
		];
		return lines.join('\n');
	}

	async cmdRecall(query: string): Promise<string> {
		if (!query) {
			return `${this.i18n.t('recall.prompt')}\n${this.i18n.t('recall.hint')}`;
		}
		const { hits, total, staleHints } = await this.recall(query);
		if (hits.length === 0 && staleHints.length === 0) return this.i18n.t('recall.empty');
		const lines = [`${this.i18n.t('recall.results', { n: total })}`];
		for (const h of hits) {
			lines.push(`${h.ref}  ${h.content.split('\n')[0]?.slice(0, 100) ?? ''}`);
		}
		for (const h of staleHints) {
			lines.push(`${h.ref}  (stale — ${h.reason})`);
		}
		return lines.join('\n');
	}

	async cmdStore(): Promise<string> {
		await this.syncAfterPurge();
		const blobs = [...this.state.blobs.values()].sort((a, b) => b.lastRef - a.lastRef);
		const lines = [
			`blobs: ${this.state.blobs.size}`,
			`bytes: ${blobs.reduce((a, b) => a + b.size, 0)}`,
			`index rev: ${this.state.indexRev}`,
			`sessions active: ${this.deps.registry.activeSessions().size}`,
			`gc age: ${Math.round(this.config.gcMinBlobAgeMs / 60000)} min`,
		];
		for (const b of blobs.slice(0, 12)) {
			lines.push(`  ${b.hash.slice(0, this.config.hashPrefixChars)} · ${b.size} chars · ${b.kind} · session ${b.session}`);
		}
		return lines.join('\n');
	}

	






	async storeBootstrap(): Promise<string> {
		await this.syncAfterPurge();
		const ws = this.workspace.replace(/\/$/, '');
		const blobs = [...this.state.blobs.values()].filter(
			m => m.workspace && m.workspace.replace(/\/$/, '') === ws,
		);
		if (blobs.length === 0) return '';
		const bytes = blobs.reduce((a, b) => a + b.size, 0);
		const bySource = new Map<string, number>();
		for (const b of blobs) bySource.set(b.source || 'tool', (bySource.get(b.source || 'tool') ?? 0) + 1);
		const sources = [...bySource.entries()].map(([s, n]) => `${n} ${s}`).join(', ');
		
		
		const names = blobs
			.map(b => (b.filePath || '').split('/').pop() || '')
			.filter(n => /^[A-Za-z0-9_.-]+$/.test(n))
			.slice(0, 4);
		const namesNote = names.length > 0 ? ` (e.g. ${names.join(', ')})` : '';
		return `DeepSkrin store: ${blobs.length} saved tool outputs from previous sessions in this workspace (${Math.round(bytes / 1024)} KB — ${sources})${namesNote}. Use the deepshrink_recall tool to search them before re-reading files or re-running commands.`;
	}

	async cmdLogs(): Promise<string> {
		const stats = await this.log.stats();
		return [
			`level: ${this.config.logLevel}`,
			`session log: ${this.log.filePath}`,
			`entries: ${stats.entries} · bytes: ${stats.bytes}`,
			`commands: /deepshrink-log tail|level|open|stats|prune|clean|export`,
		].join('\n');
	}

	async logStats(): Promise<string> {
		const stats = await this.log.stats();
		const all = await this.log.readAllSessions();
		const byLevel: Record<string, number> = {};
		for (const e of all) byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
		return [
			`session file: ${stats.files} · entries: ${stats.entries} · bytes: ${stats.bytes}`,
			`all sessions: ${all.length} events`,
			`levels: ${Object.entries(byLevel).map(([k, v]) => `${k}=${v}`).join(', ')}`,
		].join('\n');
	}

	async cmdConfig(): Promise<string> {
		const c = this.config;
		return [
			`enabled: ${c.enabled}`,
			`locale: ${c.locale}`,
			`logLevel: ${c.logLevel}`,
			`warmWindowK: ${c.warmWindowK}`,
			`maxViewTokens: ${c.maxViewTokens}`,
			`maxBlobBytes: ${c.maxBlobBytes}`,
			`compactGuard: ${c.compactGuard ? 'ON' : 'OFF'}`,
			`digestEnabled: ${c.digestEnabled}`,
			`breakerThreshold: ${c.breakerThreshold} · halfOpenTurns: ${c.breakerHalfOpenTurns}`,
			`estimateCharsPerToken: ${this.meter.estimateCharsPerToken.toFixed(2)} (${this.meter.samples} samples)`,
		].join('\n');
	}

	async cmdHelp(): Promise<string> {
		return [
			'DEEPSKRIN — content-addressable context store',
			'',
			'COMMANDS',
			'  /deepshrink            master menu',
			'  /deepshrink status     session + store state',
			'  /deepshrink stats      efficiency, break-even, cache hit',
			'  /deepshrink recall <q> query the store (regex)',
			'  /deepshrink store      blobs, GC, sessions',
			'  /deepshrink logs       log info',
			'  /deepshrink config     budgets + thresholds',
			'  /deepshrink help       this text',
			'  /deepshrink-log        tail|level|open|stats|prune|clean|export',
			'  /deepshrink-toggle     on/off',
			'',
			'HOOKS',
			'  afterToolCall      ingest + digest (fail-open)',
			'  transformContext   ephemeral view (warm window + refs + TOC)',
			'  compaction_start   guard state summary (ON by default)',
			'  model_request_end  real usage metering',
			'',
			'RECALL AS TOOL',
			'  deepshrink_recall(query) — model calls it; output bypasses ingestion',
			'',
			'GUARD',
			'  ON by default — injects a structured state summary on compaction (config.compactGuard)',
		].join('\n');
	}

	

	async saveConfig(): Promise<void> {
		await this.deps.configStore.save(this.config);
		this.emit('config', 'info', { action: 'save' });
	}

	async setConfig(patch: Partial<DeepSkrinConfig>): Promise<void> {
		this.config = mergeConfig({ ...this.config, ...patch });
		this.i18n = makeI18n(this.config.locale);
		await this.saveConfig();
	}

	async exportBundle(outPath: string): Promise<ExportResult> {
		const sessions = await this.log.readAllSessions();
		return exportBundle({
			dir: this.deps.dir,
			outPath,
			config: this.config,
			state: this.state,
			sessionEvents: [{ file: this.sessionId, lines: sessions.map(e => JSON.stringify(e)) }],
		});
	}

	async logTail(n: number): Promise<string> {
		const events = await this.log.readAll();
		const tail = events.slice(-n);
		return tail.map(e => `${e.t} [${e.level}] ${e.type}:${(e as { action?: string }).action ?? ''}`).join('\n') || '(empty log)';
	}

	async logSetLevel(level: LogLevel): Promise<void> {
		this.config = { ...this.config, logLevel: level };
		this.log.setLevel(level);
		await this.saveConfig();
	}

	async flushLog(): Promise<void> {
		await this.log.flush();
	}

	async logPrune(days: number): Promise<number> {
		return this.log.prune(days);
	}

	async logClean(): Promise<number> {
		return this.log.clear();
	}

	async toggle(): Promise<boolean> {
		this.config = { ...this.config, enabled: !this.config.enabled };
		await this.saveConfig();
		this.deps.host?.notify?.(this.config.enabled ? this.i18n.t('notify.activated') : this.i18n.t('notify.deactivated'));
		return this.config.enabled;
	}

	
	async setEnabled(on: boolean): Promise<boolean> {
		this.config = { ...this.config, enabled: on };
		await this.saveConfig();
		this.deps.host?.notify?.(on ? this.i18n.t('notify.activated') : this.i18n.t('notify.deactivated'));
		return this.config.enabled;
	}

	





	async applySettings(s: Record<string, unknown>): Promise<void> {
		const next = { ...this.config };
		
		const num = (v: unknown): number | undefined => {
			if (typeof v === 'number') return v;
			if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
			return undefined;
		};
		const ratio = num(s.compressTargetRatio);
		if (ratio !== undefined && ratio >= 0.4 && ratio <= 0.9) next.compressTargetRatio = ratio;
		if (typeof s.language === 'string' && ['auto', 'fr', 'en', 'es', 'de'].includes(s.language)) {
			next.language = s.language as DeepSkrinConfig['language'];
		}
		if (typeof s.compactGuard === 'boolean') next.compactGuard = s.compactGuard;
		if (typeof s.viewEnabled === 'boolean') next.viewEnabled = s.viewEnabled;
		if (typeof s.compressEnabled === 'boolean') next.compressEnabled = s.compressEnabled;
		if (typeof s.digestEnabled === 'boolean') next.digestEnabled = s.digestEnabled;
		if (typeof s.elideWindowedReads === 'boolean') next.elideWindowedReads = s.elideWindowedReads;
		if (typeof s.logLevel === 'string' && ['debug', 'info', 'warn'].includes(s.logLevel)) {
			next.logLevel = s.logLevel as DeepSkrinConfig['logLevel'];
		}
		if (JSON.stringify(next) !== JSON.stringify(this.config)) {
			this.config = next;
			await this.saveConfig();
		}
	}
}





function extractText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content.map(b => {
			if (typeof b === 'string') return b;
			if (b && typeof b === 'object') {
				const t = (b as { text?: unknown }).text;
				if (typeof t === 'string') return t;
			}
			return '';
		}).join('');
	}
	if (content && typeof content === 'object') {
		const t = (content as { text?: unknown }).text;
		if (typeof t === 'string') return t;
	}
	return '';
}


function scoreRelevanceHits(hits: Array<{ content: string }>, query: string, idf?: import('../core/relevance.ts').IdfTable, corpusSize = 0): Map<{ content: string }, number> {
	const terms = queryTerms(query);
	const map = new Map<{ content: string }, number>();
	for (const h of hits) {
		map.set(h, scoreRelevance(h.content, terms, idf, corpusSize).score);
	}
	return map;
}

export function estimateCharsPerTokenHint(config: DeepSkrinConfig): number {
	return config.estimateCharsPerToken;
}

export { estimateTokens };
