

import type { LogLevel } from './config.ts';

export const EVENT_SCHEMA_VERSION = 1;

export interface BaseEvent {
	v: number;
	t: string; 
	session: string;
	level: LogLevel;
	hookMs?: number;
}

export type DeepSkrinEvent = BaseEvent & (
	| { type: 'store'; action: 'ingest' | 'recall' | 'gc' | 'rebuild' | 'save'; hash?: string; bytes?: number; blobs?: number; query?: string; bypass?: boolean; miss?: boolean; score?: number; followedBy?: string; toolHit?: boolean; hitReason?: string; cause?: { edited?: number; reIngestSameHash?: number } }
	| { type: 'view'; action: 'transform' | 'unchanged' | 'elide' | 'binary' | 'skeleton' | 'toc' | 'reread-elide'; bytes?: number; tokens?: number; kind?: string; lines?: number; entries?: number; path?: string; precededByRecall?: boolean; compacted?: boolean; servedContent?: boolean }
	| { type: 'meter'; action: 'estimate' | 'real' | 'warn' | 'clamp'; contextTokens?: number; growthPerTurn?: number; headroomPct?: number; estimateChars?: number; actualChars?: number }
	| { type: 'breaker'; layer: string; state: 'closed' | 'open' | 'half-open' | 'probe' | 'reset' }
	| { type: 'guard'; action: 'on' | 'off' | 'state' | 'compacted' | 'skip'; reason?: string }
	| { type: 'redact'; action: 'apply'; kind?: string; count?: number }
	| { type: 'decide'; action: 'recall' | 'norecall' | 'bypass'; reason?: string; query?: string }
	| { type: 'hook'; action: string; ms: number; name?: string }
	| { type: 'error'; action: string; message?: string }
	| { type: 'config'; action: 'load' | 'save' | 'reset' }
	| { type: 'usage'; action: 'request'; inputTokens?: number; outputTokens?: number; cacheRead?: number; model?: string }
	| { type: 'session'; action: 'start' | 'end' | 'locale'; locale?: string }
	| { type: 'index'; action: 'build'; size?: number; ms?: number }
);

export type DeepSkrinEventName = DeepSkrinEvent['type'];

export const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };


export function shouldEmit(level: LogLevel, configLevel: LogLevel): boolean {
	return LEVEL_ORDER[level] >= LEVEL_ORDER[configLevel];
}

export function makeEvent(session: string, level: LogLevel, partial: Record<string, unknown> & { type: DeepSkrinEventName }, ts?: string): DeepSkrinEvent {
	return {
		v: EVENT_SCHEMA_VERSION,
		t: ts ?? new Date().toISOString(),
		session,
		level,
		...partial,
	} as DeepSkrinEvent;
}


export interface SessionSnapshot {
	session: string;
	startedAt: string;
	locale: string;
	enabled: boolean;
	guard: boolean;
	blobs: number;
	storeBytes: number;
	recalls: number;
	recallAppropriate: number;
	reReads: number;
	errors: number;
	cacheReadTokens: number;
	overheadTokens: number;
	savedTokens: number;
	breakerLayers: Record<string, 'closed' | 'open' | 'half-open' | 'probe' | 'reset'>;
	totalInputTokens: number;
	totalOutputTokens: number;
	
	readsWithoutPriorRecall: number;
	supersededByEdit: number;
	supersededReIngest: number;
}

export const emptySnapshot = (session: string): SessionSnapshot => ({
	session,
	startedAt: '',
	locale: 'en',
	enabled: true,
	guard: false,
	blobs: 0,
	storeBytes: 0,
	recalls: 0,
	recallAppropriate: 0,
	reReads: 0,
	errors: 0,
	cacheReadTokens: 0,
	overheadTokens: 0,
	savedTokens: 0,
	breakerLayers: {},
	totalInputTokens: 0,
	totalOutputTokens: 0,
	readsWithoutPriorRecall: 0,
	supersededByEdit: 0,
	supersededReIngest: 0,
});

export function reduceSnapshot(snap: SessionSnapshot, ev: DeepSkrinEvent): SessionSnapshot {
	if (ev.session !== snap.session) return snap;
	switch (ev.type) {
		case 'session':
			if (ev.action === 'start') return { ...snap, startedAt: ev.t, locale: ev.locale ?? snap.locale };
			if (ev.action === 'locale') return { ...snap, locale: ev.locale ?? snap.locale };
			break;
		case 'config':
			if (ev.action === 'load') return { ...snap, enabled: (ev as { enabled?: boolean }).enabled ?? snap.enabled, guard: (ev as { guard?: boolean }).guard ?? snap.guard };
			break;
		case 'store':
			if (ev.action === 'ingest' && !(ev as { bypass?: boolean }).bypass) snap.blobs += 1;
			if (ev.action === 'gc' && typeof ev.blobs === 'number') snap.blobs = Math.max(0, snap.blobs - ev.blobs);
			if (typeof ev.bytes === 'number' && ev.action === 'ingest') snap.storeBytes += ev.bytes;
			if (ev.action === 'recall') snap.recalls += 1;
			if (ev.action === 'tool-hit' && (ev as { toolHit?: boolean }).toolHit === false) {
				
				snap.readsWithoutPriorRecall = (snap.readsWithoutPriorRecall ?? 0) + 1;
			}
			if (ev.action === 'superseded' && ev.cause) {
				snap.supersededByEdit = (snap.supersededByEdit ?? 0) + (ev.cause.edited ?? 0);
				snap.supersededReIngest = (snap.supersededReIngest ?? 0) + (ev.cause.reIngestSameHash ?? 0);
			}
			break;
		case 'decide':
			if (ev.action === 'recall') snap.recallAppropriate += 1;
			if (ev.action === 'bypass') snap.recalls += 1;
			break;
		case 'view':
			if (ev.action === 'skeleton' || ev.action === 'elide') snap.savedTokens += 1;
			break;
		case 'breaker':
			snap.breakerLayers[ev.layer] = ev.state;
			break;
		case 'usage':
			if (typeof ev.cacheRead === 'number') snap.cacheReadTokens += ev.cacheRead;
			if (typeof ev.inputTokens === 'number') snap.totalInputTokens += ev.inputTokens;
			if (typeof ev.outputTokens === 'number') snap.totalOutputTokens += ev.outputTokens;
			break;
		case 'error':
			snap.errors += 1;
			break;
		default:
			break;
	}
	return snap;
}
