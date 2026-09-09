

export interface ModelPrice {
	readonly id: string;
	
	readonly inputPerM: number;
	readonly outputPerM: number;
	
	readonly cacheReadPerM?: number;
}

export interface PricingTable {
	readonly models: readonly ModelPrice[];
	readonly updatedAt: number; 
}

export const PRICING_TTL_MS = 6 * 60 * 60 * 1000; 
export const DEFAULT_CACHE_RATIO = 0.1;

export function normalizeModelId(id: string): string {
	return id.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function fuzzyMatchModel(id: string, table: PricingTable): ModelPrice | undefined {
	const needle = normalizeModelId(id);
	const direct = table.models.find(m => normalizeModelId(m.id) === needle);
	if (direct) return direct;
	
	const byBasename = table.models.find(m => basenameMatch(m.id, id));
	if (byBasename) return byBasename;
	
	return table.models.find(m => normalizeModelId(m.id).includes(needle) && needle.length >= 3);
}

export function effectiveCacheRead(price: ModelPrice): number {
	return price.cacheReadPerM ?? price.inputPerM * DEFAULT_CACHE_RATIO;
}

export function isStale(table: PricingTable, now: number): boolean {
	return now - table.updatedAt > PRICING_TTL_MS;
}






export function basenameMatch(a: string, b: string): boolean {
	const ba = a.split('/').pop() ?? a;
	const bb = b.split('/').pop() ?? b;
	return ba.toLowerCase() === bb.toLowerCase();
}

export interface OpenRouterModel {
	readonly id: string;
	readonly pricing?: {
		readonly prompt?: string;      
		readonly completion?: string;
		readonly input_cache_read?: string;
	};
}






export async function fetchOpenRouterPricing(
	now: number = Date.now(),
	filterIds?: readonly string[],
): Promise<PricingTable | undefined> {
	try {
		const res = await fetch('https://openrouter.ai/api/v1/models', {
			headers: {'User-Agent': 'deepskrin-pricing/1.0'},
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) return undefined;
		const json = (await res.json()) as {data?: OpenRouterModel[]};
		const list = json.data ?? [];
		const want = (filterIds ?? []).map(id => id.split('/').pop()?.toLowerCase() ?? id.toLowerCase());
		const models: ModelPrice[] = [];
		for (const m of list) {
			const p = m.pricing;
			if (!p) continue;
			const prompt = parseFloat(p.prompt ?? '');
			const completion = parseFloat(p.completion ?? '');
			if (Number.isNaN(prompt) || Number.isNaN(completion) || prompt < 0 || completion < 0) continue;
			
			if (want.length > 0) {
				const base = m.id.split('/').pop()?.toLowerCase() ?? '';
				if (!want.includes(base)) continue;
			}
			const cacheRead = p.input_cache_read ? parseFloat(p.input_cache_read) : undefined;
			models.push({
				id: m.id,
				inputPerM: prompt * 1e6,
				outputPerM: completion * 1e6,
				cacheReadPerM: cacheRead !== undefined && !Number.isNaN(cacheRead) ? cacheRead * 1e6 : undefined,
			});
		}
		if (models.length === 0) return undefined;
		return {models, updatedAt: now};
	} catch {
		return undefined;
	}
}









const CC_NAME_TO_ID: Record<string, string> = {
	'laguna s 2.1': 'poolside/laguna-s-2.1-free',
	'ling 3.0 flash': 'inclusionai/ling-3.0-flash-free',
	'tencent hy3': 'tencent/hy3',
	'kimi k3': 'moonshotai/kimi-k3',
	'kimi k2.7 code': 'moonshotai/kimi-k2.7-code',
	'kimi k2.7 code highspeed': 'moonshotai/kimi-k2.7-code-highspeed',
	'kimi k2.6': 'moonshotai/kimi-k2.6',
	'kimi k2.5': 'moonshotai/kimi-k2.5',
	'glm-5.2': 'zai-org/glm-5.2',
	'glm-5.2 fast': 'zai-org/glm-5.2-fast',
	'glm-5.1': 'zai-org/glm-5.1',
	'glm-5': 'zai-org/glm-5',
	'minimax m3': 'MiniMaxAI/MiniMax-M3',
	'minimax m2.7': 'MiniMaxAI/MiniMax-M2.7',
	'minimax m2.5': 'MiniMaxAI/MiniMax-M2.5',
	'deepseek v4 pro': 'deepseek/deepseek-v4-pro',
	'deepseek v4 flash': 'deepseek/deepseek-v4-flash',
	'qwen 3.6 max preview': 'Qwen/Qwen3.6-Max-Preview',
	'qwen 3.6 plus': 'Qwen/Qwen3.6-Plus',
	'qwen 3.7 max': 'Qwen/Qwen3.7-Max',
	'qwen 3.7 plus': 'Qwen/Qwen3.7-Plus',
	'qwen 3.7 flash': 'Qwen/Qwen3.7-Flash',
	'step 3.7 flash': 'stepfun/Step-3.7-Flash',
	'step 3.5 flash': 'stepfun/Step-3.5-Flash',
	'mimo v2.5 pro': 'xiaomi/mimo-v2.5-pro',
	'mimo v2.5': 'xiaomi/mimo-v2.5',
	'nemotron 3 ultra': 'nvidia/nemotron-3-ultra-550b-a55b',
	'claude fable 5': 'claude-fable-5',
	'claude opus 5': 'claude-opus-5',
	'claude opus 4.8': 'claude-opus-4-8',
	'claude opus 4.7': 'claude-opus-4-7',
	'claude opus 4.6': 'claude-opus-4-6',
	'claude sonnet 5': 'claude-sonnet-5',
	'claude sonnet 4.6': 'claude-sonnet-4-6',
	'claude haiku 4.5': 'claude-haiku-4-5',
	'gpt-5.6 sol': 'gpt-5.6-sol',
	'gpt-5.6 terra': 'gpt-5.6-terra',
	'gpt-5.6 luna': 'gpt-5.6-luna',
	'gpt-5.5': 'gpt-5.5',
	'gpt-5.4': 'gpt-5.4',
	'gpt-5.4 mini': 'gpt-5.4-mini',
	'gpt-5.3 codex': 'gpt-5.3-codex',
	'gemini 3.6 flash': 'google/gemini-3.6-flash',
	'gemini 3.5 flash': 'google/gemini-3.5-flash',
	'gemini 3.5 flash lite': 'google/gemini-3.5-flash-lite',
	'gemini 3.1 flash lite': 'google/gemini-3.1-flash-lite',
	'fugu ultra': 'sakana/fugu-ultra',
	'muse spark 1.1': 'meta/muse-spark-1.1',
	'grok 4.5': 'xai/grok-4.5',
	'inkling': 'thinkingmachines/inkling',
	'inkling small': 'thinkingmachines/inkling-small',
};






export async function fetchCCPricing(
	now: number = Date.now(),
	filterIds?: readonly string[],
): Promise<PricingTable | undefined> {
	try {
		const res = await fetch('https://commandcode.ai/docs/resources/pricing-limits', {
			headers: {'User-Agent': 'deepskrin-pricing/1.0'},
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) return undefined;
		const html = await res.text();
		if (!html.includes('role="row"')) return undefined; 

		const models: ModelPrice[] = [];
		const want = (filterIds ?? []).map(id => normalizeModelId(id));

		
		
		
		
		
		const rowRe = /role="row"[\s\S]*?<(?:span|a)(?:\s[^>]*)?class="[^"]*truncate[^"]*"[^>]*>([^<]+)<\/(?:span|a)>([\s\S]*?)<\/div><div class="px-3 py-3"/g;
		const moneyRe = /\$([\d.]+)/g;
		const struckRe = /<s[^>]*>[\s\S]*?\$([\d.]+)<\/s>/g;
		const SUB_ROW_NAMES = new Set(['standard', 'long context', 'extended 1', 'extended 2', 'extended 3']);

		let currentModelId: string | undefined;
		let m: RegExpExecArray | null;
		while ((m = rowRe.exec(html)) !== null) {
			const rawName = m[1].replace(/[⚡+]/g, '').trim().toLowerCase();
			const rest = m[2];
			const amounts = [...rest.matchAll(moneyRe)].map(x => parseFloat(x[1]));

			
			if (SUB_ROW_NAMES.has(rawName)) {
				if (!currentModelId || amounts.length < 2) continue;
				const struck = new Set([...rest.matchAll(struckRe)].map(x => parseFloat(x[1])));
				const effective = struck.size > 0 ? amounts.filter(a => !struck.has(a)) : amounts;
				if (effective.length < 2) continue;
				models.push({
					id: currentModelId,
					inputPerM: effective[0],
					outputPerM: effective[1],
					cacheReadPerM: effective.length >= 3 ? effective[2] : undefined,
				});
				continue;
			}

			const id = CC_NAME_TO_ID[rawName];
			if (!id) continue;
			if (want.length > 0 && !want.includes(normalizeModelId(id))) continue;

			
			
			if (amounts.length < 2) {
				currentModelId = id;
				continue;
			}
			const struck = new Set([...rest.matchAll(struckRe)].map(x => parseFloat(x[1])));
			const effective = struck.size > 0 ? amounts.filter(a => !struck.has(a)) : amounts;
			if (effective.length < 2) continue;
			currentModelId = id;
			models.push({
				id,
				inputPerM: effective[0],
				outputPerM: effective[1],
				cacheReadPerM: effective.length >= 3 ? effective[2] : undefined,
			});
		}
		if (models.length === 0) return undefined;
		return {models, updatedAt: now};
	} catch {
		return undefined;
	}
}

export class PricingCache {
	private readonly fallback: PricingTable;
	private readonly refreshFn: (() => Promise<PricingTable | undefined>) | undefined;
	private table: PricingTable | undefined;
	private inflight: Promise<PricingTable | undefined> | undefined;

	constructor(
		fallback: PricingTable,
		refreshFn?: () => Promise<PricingTable | undefined>,
	) {
		this.fallback = fallback;
		this.refreshFn = refreshFn;
	}

	get(id: string): ModelPrice | undefined {
		return fuzzyMatchModel(id, this.table ?? this.fallback);
	}

	getTable(): PricingTable {
		return this.table ?? this.fallback;
	}

	
	seed(table: PricingTable): void {
		if (table && Array.isArray(table.models) && table.models.length > 0) {
			this.table = table;
		}
	}

	
	async refresh(now: number = Date.now()): Promise<void> {
		if (!this.refreshFn) return; 
		if (this.table && !isStale(this.table, now)) return;
		this.inflight ??= this.refreshFn()
			.then(fresh => {
				if (fresh) this.table = fresh;
				return fresh;
			})
			.finally(() => {
				this.inflight = undefined;
			});
		await this.inflight;
	}
}



export const HAND_PRICING: PricingTable = {
	updatedAt: 0,
	models: [
		
		{id: 'claude-haiku-4-5', inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1},
		{id: 'claude-sonnet-4-6', inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3},
		{id: 'claude-sonnet-5', inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3},
		{id: 'claude-opus-4-7', inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5},
		{id: 'claude-opus-4-8', inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5},
		{id: 'claude-opus-5', inputPerM: 20, outputPerM: 100, cacheReadPerM: 2},
		{id: 'claude-fable-5', inputPerM: 20, outputPerM: 100, cacheReadPerM: 2},
		
		{id: 'gpt-5.6-sol', inputPerM: 2.5, outputPerM: 15, cacheReadPerM: 1.25},
		{id: 'gpt-5.6-terra', inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.625},
		{id: 'gpt-5.6-luna', inputPerM: 1, outputPerM: 8, cacheReadPerM: 0.5},
		{id: 'gpt-5.5', inputPerM: 2.5, outputPerM: 15, cacheReadPerM: 1.25},
		{id: 'gpt-5.4', inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.625},
		{id: 'gpt-5.3-codex', inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.625},
		{id: 'gpt-5.4-mini', inputPerM: 0.4, outputPerM: 2, cacheReadPerM: 0.2},
		
		{id: 'deepseek/deepseek-v4-pro', inputPerM: 0.28, outputPerM: 0.42, cacheReadPerM: 0.028},
		{id: 'deepseek/deepseek-v4-flash', inputPerM: 0.06, outputPerM: 0.25, cacheReadPerM: 0.006},
		{id: 'moonshotai/kimi-k2.7-code', inputPerM: 0.6, outputPerM: 2.4, cacheReadPerM: 0.6},
		{id: 'moonshotai/kimi-k2.6', inputPerM: 0.6, outputPerM: 2.4, cacheReadPerM: 0.6},
		{id: 'moonshotai/kimi-k3', inputPerM: 3, outputPerM: 8, cacheReadPerM: 3},
		{id: 'xiaomi/mimo-v2.5', inputPerM: 0.12, outputPerM: 0.48, cacheReadPerM: 0.12},
		{id: 'xiaomi/mimo-v2.5-pro', inputPerM: 0.2, outputPerM: 0.8, cacheReadPerM: 0.2},
		{id: 'zai-org/glm-5', inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.05},
		{id: 'zai-org/glm-5.1', inputPerM: 0.15, outputPerM: 0.7, cacheReadPerM: 0.075},
		{id: 'zai-org/glm-5.2', inputPerM: 0.2, outputPerM: 1, cacheReadPerM: 0.1},
		{id: 'qwen/qwen3.7-flash', inputPerM: 0.03, outputPerM: 0.16, cacheReadPerM: 0.003},
		{id: 'qwen/qwen3.7-plus', inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01},
		{id: 'qwen/qwen3.7-max', inputPerM: 0.2, outputPerM: 1, cacheReadPerM: 0.02},
		{id: 'qwen/qwen3.6-plus', inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01},
		{id: 'qwen/qwen3.6-max-preview', inputPerM: 0.2, outputPerM: 1, cacheReadPerM: 0.02},
		{id: 'google/gemini-3.5-flash', inputPerM: 0.2, outputPerM: 0.8, cacheReadPerM: 0.05},
		{id: 'google/gemini-3.5-flash-lite', inputPerM: 0.1, outputPerM: 0.4, cacheReadPerM: 0.025},
		{id: 'google/gemini-3.6-flash', inputPerM: 0.2, outputPerM: 0.8, cacheReadPerM: 0.05},
		{id: 'xai/grok-4.5', inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25},
		{id: 'tencent/hy3', inputPerM: 0.12, outputPerM: 0.5, cacheReadPerM: 0.012},
		{id: 'nvidia/nemotron-3-ultra-550b-a55b', inputPerM: 0.12, outputPerM: 0.48, cacheReadPerM: 0.012},
		{id: 'thinkingmachines/inkling', inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.5},
		{id: 'thinkingmachines/inkling-small', inputPerM: 0.25, outputPerM: 1.25, cacheReadPerM: 0.125},
		{id: 'meta/muse-spark-1.1', inputPerM: 0.5, outputPerM: 2, cacheReadPerM: 0.25},
		{id: 'poolside/laguna-s-2.1-free', inputPerM: 0, outputPerM: 0, cacheReadPerM: 0},
		{id: 'inclusionai/ling-3.0-flash-free', inputPerM: 0, outputPerM: 0, cacheReadPerM: 0},
		{id: 'sakana/fugu-ultra', inputPerM: 0.5, outputPerM: 2, cacheReadPerM: 0.25},
		{id: 'stepfun/step-3.5-flash', inputPerM: 0.05, outputPerM: 0.2, cacheReadPerM: 0.005},
		{id: 'stepfun/step-3.7-flash', inputPerM: 0.05, outputPerM: 0.2, cacheReadPerM: 0.005},
	],
};
