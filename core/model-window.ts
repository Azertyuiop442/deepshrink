import { readFileSync, statSync } from 'node:fs';

export interface CatalogCache {
	path: string;
	mtimeMs: number;
	index: Map<string, number>;
	windowByModel: Map<string, number>;
}

export const CATALOG_PATH = `${process.env.HOME ?? ''}/.commandcode/cache/models-dev.json`;

function basename(model: string): string {
	const parts = model.split('/');
	return parts[parts.length - 1] ?? model;
}

function normalize(model: string): string {
	return model.trim().toLowerCase().replace(/^@/, '');
}

export function buildCatalogIndex(raw: unknown): CatalogCache {
	const index = new Map<string, number>();
	const windowByModel = new Map<string, number>();
	const data = (raw as { data?: Record<string, { models?: Record<string, { limit?: { context?: number } }> }> })?.data;
	if (!data || typeof data !== 'object') return { path: CATALOG_PATH, mtimeMs: 0, index, windowByModel };
	for (const [provider, entry] of Object.entries(data)) {
		const models = entry?.models;
		if (!models || typeof models !== 'object') continue;
		for (const [modelId, meta] of Object.entries(models)) {
			const context = meta?.limit?.context;
			if (typeof context !== 'number' || !(context > 0)) continue;
			const full = normalize(`${provider}/${modelId}`);
			index.set(full, context);
			const short = normalize(modelId);
			const key = basename(short);
			if (!windowByModel.has(key)) windowByModel.set(key, context);
			if (!windowByModel.has(short)) windowByModel.set(short, context);
		}
	}
	return { path: CATALOG_PATH, mtimeMs: 0, index, windowByModel };
}

export function resolveContextWindow(catalog: CatalogCache | null | undefined, modelId: string): number | null {
	if (!catalog || !modelId) return null;
	const wanted = normalize(modelId);
	if (!wanted) return null;
	const exact = catalog.index.get(wanted);
	if (typeof exact === 'number' && exact > 0) return exact;
	const byShort = catalog.windowByModel.get(basename(wanted));
	if (typeof byShort === 'number' && byShort > 0) return byShort;
	const byFull = catalog.windowByModel.get(wanted);
	if (typeof byFull === 'number' && byFull > 0) return byFull;
	return null;
}

let cached: CatalogCache | null = null;

export function loadCatalog(path: string = CATALOG_PATH): CatalogCache | null {
	try {
		const stat = statSync(path);
		if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
		const parsed = buildCatalogIndex(JSON.parse(readFileSync(path, 'utf8')));
		parsed.path = path;
		parsed.mtimeMs = stat.mtimeMs;
		cached = parsed;
		return cached;
	} catch {
		return null;
	}
}

export function pressureTokensFor(windowTokens: number | null, pct: number, explicitTokens: number): number {
	if (explicitTokens > 0) return explicitTokens;
	if (!windowTokens || !(windowTokens > 0)) return 0;
	const ratio = pct > 0 && pct <= 1 ? pct : 0.7;
	return Math.round(windowTokens * ratio);
}
