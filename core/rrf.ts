










const DEFAULT_K = 60;

export function rrfScore(rank: number, k = DEFAULT_K): number {
	if (rank <= 0) return 0;
	return 1 / (k + rank);
}

export interface RankedItem<T> {
	item: T;
	ranks: number[];   
}

export function rrfFuse<T>(items: RankedItem<T>[], k = DEFAULT_K): Array<T & { score: number }> {
	const scored = items.map(it => {
		const score = it.ranks.reduce((acc, r) => acc + rrfScore(r, k), 0);
		
		
		
		if (it.item !== null && (typeof it.item === 'object' || typeof it.item === 'function')) {
			return Object.assign({}, it.item as object, { score }) as T & { score: number };
		}
		return { value: it.item, score } as unknown as T & { score: number };
	});
	return scored.sort((a, b) => b.score - a.score);
}
