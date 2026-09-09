


export const STATE_SECTIONS = [
	'Active Plan',
	'Current Phase',
	'TaskList Summary',
	'Session Decisions',
	'Constraints and Blockers',
	'Worker Topology',
	'Skills Invoked',
	'Editing Files',
	'Failed Attempts',
	'Recovery Notes',
] as const;

export type StateSection = (typeof STATE_SECTIONS)[number];

export interface GuardState {
	enabled: boolean;
	markers: Map<string, number>; 
	stateSummary: string | undefined;
}

export const EMPTY_GUARD: GuardState = { enabled: false, markers: new Map(), stateSummary: undefined };


export function buildStateSummary(input: {
	sections: Partial<Record<StateSection, string>>;
}): string {
	const parts: string[] = [];
	for (const section of STATE_SECTIONS) {
		const v = input.sections[section];
		parts.push(`## ${section}`);
		parts.push(v && v.trim() ? v : '(not verified)');
	}
	return parts.join('\n');
}


export function markDelivered(state: GuardState, session: string, key: string, now = Date.now()): boolean {
	const existing = state.markers.get(`${session}:${key}`);
	if (existing !== undefined) return false;
	state.markers.set(`${session}:${key}`, now);
	return true;
}


export function isDelivered(state: GuardState, session: string, key: string): boolean {
	return state.markers.has(`${session}:${key}`);
}


export function pruneMarkers(state: GuardState, maxAgeMs: number, now = Date.now()): number {
	let removed = 0;
	for (const [k, ts] of state.markers) {
		if (now - ts > maxAgeMs) {
			state.markers.delete(k);
			removed++;
		}
	}
	return removed;
}
