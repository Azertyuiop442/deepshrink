


export interface UsageSample {
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
}


export interface ModelPrice {
	readonly id: string;
	
	readonly inputPerM: number;
	readonly outputPerM: number;
	
	readonly cacheReadPerM?: number;
}

export const DEFAULT_CACHE_RATIO = 0.1;

export interface SessionStatsInput {
	usages: UsageSample[];
	totalCharsIn: number;
	totalCharsOut: number;
	ruleSaves: number;      
	overheadTokens: number; 
	recallInjectedTokens?: number; 
	                               
	                               
	recalls: number;
	reReads: number;
	errors: number;
	price?: ModelPrice;       
	
	
	
	windowedRead?: number;
	windowServed?: number;
	windowMissNoBlob?: number;
	windowMissStale?: number;
	windowMissOutOfBounds?: number;
	windowRereadModified?: number;
	
	recallMeter?: SessionStats['recallMeter'];
}

export interface SessionStats {
	reReadRate: number;       
	errorRate: number;        
	cacheHitRatio: number | null; 
	netGainTokens: number;
	savedTokens: number;
	overheadTokens: number;
	breakEvenPositive: boolean;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheRead: number;
	
	costUsd: number;
	costInputUsd: number;
	costOutputUsd: number;
	costCacheUsd: number;
	
	windowedRead: number;
	windowServed: number;
	windowMissNoBlob: number;
	windowMissStale: number;
	windowMissOutOfBounds: number;
	windowRereadModified: number;
	
	recallMeter: {
		recalls: number;
		served: number;
		droppedStale: number;
		pathLookups: number;
		indexSize: number;
	};
	
	
	readsWithoutPriorRecall?: number;
	recallThenRead?: number;      
	supersededByEdit?: number;    
	supersededReIngest?: number;  
}


export function computeStats(input: SessionStatsInput): SessionStats {
	const totalTurns = Math.max(1, input.usages.length);
	const reReadRate = totalTurns > 0 ? input.reReads / totalTurns : 0;
	const errorRate = totalTurns > 0 ? input.errors / totalTurns : 0;
	const totalInput = input.usages.reduce((a, u) => a + u.inputTokens, 0);
	const totalOutput = input.usages.reduce((a, u) => a + u.outputTokens, 0);
	const totalCacheRead = input.usages.reduce((a, u) => a + u.cacheRead, 0);
	const cacheHitRatio = totalInput + totalCacheRead > 0 ? totalCacheRead / (totalInput + totalCacheRead) : null;
	const savedTokens = input.ruleSaves;
	
	
	const netGain = savedTokens - input.overheadTokens - (input.recallInjectedTokens ?? 0);
	
	const price = input.price;
	const cachePerM = price?.cacheReadPerM ?? (price ? price.inputPerM * DEFAULT_CACHE_RATIO : 0);
	const costInputUsd = price ? (totalInput / 1e6) * price.inputPerM : 0;
	const costOutputUsd = price ? (totalOutput / 1e6) * price.outputPerM : 0;
	const costCacheUsd = price ? (totalCacheRead / 1e6) * cachePerM : 0;
	const costUsd = costInputUsd + costOutputUsd + costCacheUsd;
	return {
		reReadRate,
		errorRate,
		cacheHitRatio,
		netGainTokens: netGain,
		savedTokens,
		overheadTokens: input.overheadTokens,
		breakEvenPositive: netGain >= 0,
		totalInputTokens: totalInput,
		totalOutputTokens: totalOutput,
		totalCacheRead,
		costUsd,
		costInputUsd,
		costOutputUsd,
		costCacheUsd,
		windowedRead: input.windowedRead ?? 0,
		windowServed: input.windowServed ?? 0,
		windowMissNoBlob: input.windowMissNoBlob ?? 0,
		windowMissStale: input.windowMissStale ?? 0,
		windowMissOutOfBounds: input.windowMissOutOfBounds ?? 0,
		windowRereadModified: input.windowRereadModified ?? 0,
		recallMeter: input.recallMeter ?? { recalls: 0, served: 0, droppedStale: 0, pathLookups: 0, indexSize: 0 },
		readsWithoutPriorRecall: input.readsWithoutPriorRecall ?? 0,
		recallThenRead: input.recallThenRead ?? 0,
		supersededByEdit: input.supersededByEdit ?? 0,
		supersededReIngest: input.supersededReIngest ?? 0,
	};
}
