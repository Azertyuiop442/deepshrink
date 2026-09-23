





import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readlinkSync, renameSync } from 'node:fs';




const SIDEBAR_ROOT = process.env.CC_SIDEBAR_DIR || '/tmp/cc-sidebar';
const MODS_DATA = `${SIDEBAR_ROOT}/mods-data`;
const PICKUP = `${SIDEBAR_ROOT}/mod-pickup.json`;
const PID_FILE = `${SIDEBAR_ROOT}/dashboard.pid`;

export interface BridgeModalItem {
	label: string;
	value: string;
	detail?: string;
	color?: string;
}

export interface BridgeModalAction {
	key: string;
	label: string;
	kind?: string;
}

export interface BridgeModal {
	id: string;
	title: string;
	pending: boolean;
	items?: BridgeModalItem[];
	actions?: BridgeModalAction[];
	progress?: { label: string; current: number; total: number };
	readonly?: boolean;
	confirm?: string;
}

export interface BridgeState {
	model?: string;
	segments?: Array<{ text: string; color?: string; bold?: boolean }>;
	turns?: unknown[];
	workspace?: string;
	sections?: unknown[];
	modals?: BridgeModal[];
	
	enabled?: boolean;
	modId?: string;
	seq?: number;
	updatedAt?: number;
}

const TTY_PROBE = `p=$$; for i in 1 2 3 4 5; do t=$(ps -o tty= -p $p 2>/dev/null | tr -d ' '); if [ -n "$t" ] && [ "$t" != "?" ] && [ "$t" != "??" ]; then echo "$t"; exit 0; fi; p=$(ps -o ppid= -p $p 2>/dev/null | tr -d ' '); [ -z "$p" ] && break; done; exit 1`;

let sequence = 0;
let bridgeTtyName = '';

export function bridgeTty(): string {
	return bridgeTtyName;
}

export function setBridgeTty(raw: string): string {
	const cleaned = (raw || '').trim().replace(/^\/dev\//, '').replace(/\//g, '-');
	bridgeTtyName = /^(tty|pts|console)/i.test(cleaned) ? cleaned : '';
	return bridgeTtyName;
}

export interface BridgeHost {
	exec(opts: { command: string; args?: string[] }): Promise<{ stdout: string }>;
}

function ttyFromFileDescriptors(): string {
	for (const fd of ['/dev/fd/0', '/dev/fd/1', '/dev/fd/2']) {
		try {
			const resolved = setBridgeTty(readlinkSync(fd));
			if (resolved) return resolved;
		} catch {}
	}
	return '';
}

export async function resolveBridgeTty(host: BridgeHost): Promise<string> {
	if (bridgeTtyName) return bridgeTtyName;
	const fromFd = ttyFromFileDescriptors();
	if (fromFd) return fromFd;
	try {
		const result = await host.exec({ command: 'bash', args: ['-c', TTY_PROBE] });
		return setBridgeTty(String(result?.stdout ?? ''));
	} catch {
		return bridgeTtyName;
	}
}


export function isDashboardLive(): boolean {
	if (process.env.CC_ASCII === 'false') return false;
	try {
		const raw = readFileSync(PID_FILE, 'utf-8').trim();
		const pid = Number(raw);
		if (!pid || Number.isNaN(pid)) return false;
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}


export function readBridge(modId: string): BridgeState {
	try {
		if (!existsSync(`${MODS_DATA}/${modId}.json`)) return {};
		return JSON.parse(readFileSync(`${MODS_DATA}/${modId}.json`, 'utf-8')) as BridgeState;
	} catch {
		return {};
	}
}


function writeBridgeFile(modId: string, state: BridgeState): boolean {
	try {
		mkdirSync(MODS_DATA, { recursive: true });
		const path = `${MODS_DATA}/${modId}.json`;
		const tmp = `${path}.tmp-${process.pid}`;
		writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
		renameSync(tmp, path);
		return true;
	} catch {
		return false;
	}
}


export function writeBridge(modId: string, state: BridgeState): boolean {
	const stamped: BridgeState = { ...state, modId, seq: ++sequence, updatedAt: Date.now() };
	const ok = writeBridgeFile(modId, stamped);
	if (bridgeTtyName) writeBridgeFile(`${modId}-${bridgeTtyName}`, stamped);
	return ok;
}


export function pushModals(modId: string, modals: BridgeModal[]): boolean {
	const state = readBridge(modId);
	state.modals = [...(state.modals ?? []).filter(m => !modals.some(n => n.id === m.id)), ...modals];
	return writeBridge(modId, state);
}


export function clearModal(modId: string, id: string): void {
	const state = readBridge(modId);
	state.modals = (state.modals ?? []).filter(m => m.id !== id);
	writeBridge(modId, state);
}


export function clearModals(modId: string): void {
	const state = readBridge(modId);
	delete state.modals;
	writeBridge(modId, state);
}


export function pushProgress(modId: string, label: string, current: number, total: number): boolean {
	return pushModals(modId, [{
		id: modId,
		title: label,
		pending: true,
		progress: { label, current, total },
	}]);
}


export function pushConfirm(modId: string, id: string, title: string, banner: string, items: BridgeModalItem[], actions: BridgeModalAction[] = []): boolean {
	return pushModals(modId, [{
		id,
		title,
		pending: true,
		confirm: banner,
		items,
		actions: actions.length > 0 ? actions : [{ key: 'enter', label: 'Confirm', kind: 'danger' }, { key: 'esc', label: 'Cancel', kind: 'secondary' }],
	}]);
}


export function resetBridgeOnStartup(modId: string, empty: BridgeState = {}): void {
	writeBridge(modId, { ...empty });
}






export function pushEnabled(modId: string, enabled: boolean): void {
	try {
		const state = readBridge(modId);
		state.enabled = enabled;
		writeBridge(modId, state);
	} catch {}
}

export interface Pickup {
	mod: string;
	modal: string;
	value: string;
	sessionId?: string;
}


export function peekPickup(modId: string): Pickup | null {
	try {
		if (!existsSync(PICKUP)) return null;
		const raw = JSON.parse(readFileSync(PICKUP, 'utf-8')) as Pickup;
		if (raw.mod !== modId) return null;
		return raw;
	} catch {
		return null;
	}
}


export function consumePickup(): void {
	try {
		if (existsSync(PICKUP)) unlinkSync(PICKUP);
	} catch {}
}











const watchers: ReturnType<typeof setInterval>[] = [];
export function startPickupWatcher(
	modId: string,
	handler: (pickup: Pickup, consume: () => void) => void,
	intervalMs = 2000,
	bypassGuard?: (pickup: Pickup) => boolean,
): void {
	const timer = setInterval(() => {
		try {
			const pickup = peekPickup(modId);
			if (!pickup) return;
			const mySession = (process.env.COMMANDCODE_SESSION_ID || '').trim();
			const bypass = bypassGuard ? bypassGuard(pickup) : false;
			if (!bypass && pickup.sessionId && mySession && pickup.sessionId !== mySession) {
				return; 
			}
			handler(pickup, consumePickup);
		} catch {}
	}, intervalMs);
	timer.unref?.();
	watchers.push(timer);
}


export function stopPickupWatchers(): void {
	for (const w of watchers) clearInterval(w);
	watchers.length = 0;
}
