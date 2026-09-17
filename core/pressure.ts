export interface PressureSignals {
	tokens: number;
	growthPerTurn: number;
	cacheHitRatio: number | null;
	turnsSinceCompaction: number;
	maskedChars: number;
}

export interface PressureReading {
	level: 'low' | 'medium' | 'high';
	score: number;
	reason: string;
	advice: string;
}

export const PRESSURE_THRESHOLDS = {
	growthMedium: 1500,
	growthHigh: 4000,
	cacheMedium: 0.6,
	cacheHigh: 0.4,
	turnsMedium: 35,
	turnsHigh: 60,
};

export function computePressure(s: PressureSignals): PressureReading {
	let score = 0;
	const reasons: string[] = [];
	if (s.growthPerTurn > PRESSURE_THRESHOLDS.growthHigh) {
		score += 3;
		reasons.push('context grows fast');
	} else if (s.growthPerTurn > PRESSURE_THRESHOLDS.growthMedium) {
		score += 1;
		reasons.push('steady context growth');
	}
	if (s.cacheHitRatio !== null) {
		if (s.cacheHitRatio < PRESSURE_THRESHOLDS.cacheHigh) {
			score += 3;
			reasons.push('cache thrash');
		} else if (s.cacheHitRatio < PRESSURE_THRESHOLDS.cacheMedium) {
			score += 1;
			reasons.push('cache under-used');
		}
	}
	if (s.turnsSinceCompaction > PRESSURE_THRESHOLDS.turnsHigh) {
		score += 2;
		reasons.push('long run since compaction');
	} else if (s.turnsSinceCompaction > PRESSURE_THRESHOLDS.turnsMedium) {
		score += 1;
		reasons.push('many turns since compaction');
	}
	const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
	const advice =
		level === 'high'
			? 'consider /compact soon - masking and elision keep running'
			: level === 'medium'
				? 'watch the growth - masking is active'
				: 'no action needed';
	return { level, score, reason: reasons.join(', ') || 'nominal', advice };
}
