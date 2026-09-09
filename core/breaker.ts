


export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerStatus {
	state: BreakerState;
	failures: number;
	turnsSinceOpen: number;
}

export const CLOSED: BreakerStatus = { state: 'closed', failures: 0, turnsSinceOpen: 0 };


export function recordFailure(s: BreakerStatus, threshold: number): BreakerStatus {
	const failures = s.failures + 1;
	if (failures >= threshold) {
		return { state: 'open', failures, turnsSinceOpen: 0 };
	}
	return { ...s, failures };
}


export function recordSuccess(s: BreakerStatus): BreakerStatus {
	if (s.state === 'half-open') {
		return { ...CLOSED };
	}
	if (s.state === 'closed') return { ...s, failures: 0 };
	return s;
}


export function advanceTurn(s: BreakerStatus, halfOpenTurns: number): BreakerStatus {
	if (s.state === 'open') {
		const turns = s.turnsSinceOpen + 1;
		if (turns >= halfOpenTurns) return { ...s, state: 'half-open', turnsSinceOpen: turns };
		return { ...s, turnsSinceOpen: turns };
	}
	return s;
}


export function allowed(s: BreakerStatus): boolean {
	return s.state !== 'open';
}
