


import { mkdir, readFile, writeFile, rename, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hashForContent, shortHash } from '../core/hash.ts';
import { detectBinary } from '../core/store.ts';
import type { BlobStoreState, BlobMeta } from '../core/store.ts';
import { rebuildIndex } from '../core/store.ts';
import type { DeepSkrinConfig } from '../core/config.ts';

const INDEX_NAME = 'index.json';


const METRICS_NAME = 'metrics.json';



const ACTIVE_GRACE_MS = 30_000;

export interface PersistentStore {
	loadState(): Promise<{ state: BlobStoreState; rebuilt: boolean }>;
	saveBlob(hash: string, content: string): Promise<void>;
	readBlob(hash: string): Promise<string | undefined>;
	deleteBlob(hash: string): Promise<void>;
	checkpoint(state: BlobStoreState): Promise<void>;
	listBlobs(): Promise<string[]>;
	
	markPurged(): Promise<void>;
	
	purgedAt(): Promise<number>;
	
	saveMetrics(m: Record<string, unknown>): Promise<void>;
	
	loadMetrics(): Promise<Record<string, unknown>>;
}

export class DiskStore implements PersistentStore {
	private dir: string;
	private blobDir: string;

	constructor(dir: string, blobDir = 'blobs') {
		this.dir = dir;
		this.blobDir = blobDir;
	}

	private blobPath(hash: string): string {
		return join(this.dir, this.blobDir, hash);
	}

	async loadState(): Promise<{ state: BlobStoreState; rebuilt: boolean }> {
		
		try {
			const raw = await readFile(join(this.dir, INDEX_NAME), 'utf8');
			const parsed = JSON.parse(raw) as { rev: number; blobs: BlobMeta[] };
			const blobs = new Map<string, BlobMeta>();
			for (const b of parsed.blobs ?? []) blobs.set(b.hash, b);
			if (blobs.size === 0) throw new Error('empty index');
			return { state: { blobs, indexRev: parsed.rev ?? 0 }, rebuilt: false };
		} catch {
			
			const entries: Array<{ hash: string; content: string; session: string; createdAt: number }> = [];
			let files: string[] = [];
			try {
				files = await readdir(join(this.dir, this.blobDir));
			} catch {
				
			}
			for (const f of files) {
				try {
					const content = await readFile(join(this.dir, this.blobDir, f), 'utf8');
					const st = await stat(join(this.dir, this.blobDir, f));
					entries.push({ hash: f, content, session: 'unknown', createdAt: st.mtimeMs });
				} catch {
					
				}
			}
			const state = rebuildIndex(entries);
			return { state, rebuilt: true };
		}
	}

	async saveBlob(hash: string, content: string): Promise<void> {
		await mkdir(join(this.dir, this.blobDir), { recursive: true });
		const tmp = this.blobPath(hash) + '.tmp';
		await writeFile(tmp, content, 'utf8');
		await rename(tmp, this.blobPath(hash));
	}

	async readBlob(hash: string): Promise<string | undefined> {
		try {
			return await readFile(this.blobPath(hash), 'utf8');
		} catch {
			return undefined;
		}
	}

	async deleteBlob(hash: string): Promise<void> {
		try {
			await unlink(this.blobPath(hash));
		} catch {
			
		}
	}

	async checkpoint(state: BlobStoreState): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		
		
		
		
		
		let onDisk = new Map<string, BlobMeta>();
		let onDiskRev = 0;
		try {
			const raw = await readFile(join(this.dir, INDEX_NAME), 'utf8');
			const parsed = JSON.parse(raw) as { rev: number; blobs: BlobMeta[] };
			for (const b of parsed.blobs ?? []) onDisk.set(b.hash, b);
			onDiskRev = parsed.rev ?? 0;
		} catch {
			
		}
		
		
		const merged = new Map<string, BlobMeta>();
		for (const [h, meta] of state.blobs) {
			const exists = await this.fileExists(this.blobPath(h));
			if (exists) merged.set(h, meta);
		}
		for (const [h, meta] of onDisk) {
			if (!merged.has(h)) {
				const exists = await this.fileExists(this.blobPath(h));
				if (exists) merged.set(h, meta);
			}
		}
		const tmp = join(this.dir, INDEX_NAME + '.tmp');
		const payload = { rev: Math.max(state.indexRev, onDiskRev), blobs: [...merged.values()] };
		await writeFile(tmp, JSON.stringify(payload), 'utf8');
		await rename(tmp, join(this.dir, INDEX_NAME));
	}

	private async fileExists(p: string): Promise<boolean> {
		try {
			await stat(p);
			return true;
		} catch {
			return false;
		}
	}

	async listBlobs(): Promise<string[]> {
		try {
			return await readdir(join(this.dir, this.blobDir));
		} catch {
			return [];
		}
	}

	async markPurged(): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		await writeFile(join(this.dir, 'PURGED'), String(Date.now()), 'utf8');
	}

	async purgedAt(): Promise<number> {
		try {
			return Number(await readFile(join(this.dir, 'PURGED'), 'utf8')) || 0;
		} catch {
			return 0;
		}
	}

	async saveMetrics(m: Record<string, unknown>): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const tmp = join(this.dir, METRICS_NAME + '.tmp');
		await writeFile(tmp, JSON.stringify(m), 'utf8');
		await rename(tmp, join(this.dir, METRICS_NAME));
	}

	async loadMetrics(): Promise<Record<string, unknown>> {
		try {
			return JSON.parse(await readFile(join(this.dir, METRICS_NAME), 'utf8')) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
}


export class SessionRegistry {
	private sessions = new Set<string>();
	private heartbeats = new Map<string, number>();
	private file: string;

	constructor(file: string) {
		this.file = file;
	}

	register(sessionId: string): void {
		this.sessions.add(sessionId);
		this.heartbeats.set(sessionId, Date.now());
	}

	unregister(sessionId: string): void {
		this.sessions.delete(sessionId);
		this.heartbeats.delete(sessionId);
	}

	heartbeat(sessionId: string): void {
		if (this.sessions.has(sessionId)) this.heartbeats.set(sessionId, Date.now());
	}

	activeSessions(): Set<string> {
		
		
		
		
		
		const now = Date.now();
		const out = new Set<string>();
		for (const [sid, at] of this.heartbeats) {
			if (now - at <= ACTIVE_GRACE_MS) out.add(sid);
		}
		return out;
	}

	async load(): Promise<void> {
		try {
			const raw = await readFile(this.file, 'utf8');
			const parsed = JSON.parse(raw) as string[];
			for (const s of parsed) {
				
				
				
				
				
				this.sessions.add(s);
			}
		} catch {
			
		}
	}

	async save(): Promise<void> {
		await mkdir(join(this.file, '..'), { recursive: true });
		const tmp = this.file + '.tmp';
		await writeFile(tmp, JSON.stringify([...this.sessions]), 'utf8');
		await rename(tmp, this.file);
	}
}


export function refFor(content: string, prefixChars = 12): string {
	return `[blob:${shortHash(content, prefixChars)}:${content.length}]`;
}

export { hashForContent, detectBinary };
