



import { open, readFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeepSkrinEvent } from '../core/events.ts';
import { shouldEmit } from '../core/events.ts';
import type { LogLevel } from '../core/config.ts';

export interface LogStats {
	files: number;
	entries: number;
	bytes: number;
}

export class EventLog {
	private path: string;
	private pending: Promise<void> = Promise.resolve();
	private level: LogLevel;
	private buffer: DeepSkrinEvent[] = [];
	private dir: string;
	private sessionId: string;

	constructor(dir: string, sessionId: string, level: LogLevel = 'info') {
		this.dir = dir;
		this.sessionId = sessionId;
		this.path = join(dir, `events-${sessionId}.ndjson`);
		this.level = level;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	get filePath(): string {
		return this.path;
	}

	
	append(event: DeepSkrinEvent): void {
		if (!shouldEmit(event.level, this.level)) return;
		this.buffer.push(event);
		if (event.level === 'warn' || event.level === 'error') {
			
			this.pending = this.pending.then(() => this.flushSync());
		}
	}

	private async flushSync(): Promise<void> {
		if (this.buffer.length === 0) return;
		const batch = this.buffer.splice(0, this.buffer.length);
		const lines = batch.map(e => JSON.stringify(e) + '\n').join('');
		await mkdir(this.dir, { recursive: true });
		const handle = await open(this.path, 'a');
		try {
			await handle.write(lines, 'utf8');
		} finally {
			await handle.close();
		}
	}

	
	appendBatched(event: DeepSkrinEvent): void {
		if (!shouldEmit(event.level, this.level)) return;
		this.buffer.push(event);
	}

	
	async flush(): Promise<void> {
		if (this.buffer.length === 0) return;
		const batch = this.buffer.splice(0, this.buffer.length);
		const lines = batch.map(e => JSON.stringify(e) + '\n').join('');
		this.pending = this.pending.then(async () => {
			await mkdir(this.dir, { recursive: true });
			const handle = await open(this.path, 'a');
			try {
				await handle.write(lines, 'utf8');
			} finally {
				await handle.close();
			}
		});
		await this.pending;
	}

	
	async flushNow(): Promise<void> {
		if (this.buffer.length === 0) return;
		await this.flush();
	}

	async readAll(): Promise<DeepSkrinEvent[]> {
		await this.flush();
		const out: DeepSkrinEvent[] = [];
		try {
			const raw = await readFile(this.path, 'utf8');
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue;
				try {
					out.push(JSON.parse(line) as DeepSkrinEvent);
				} catch {
					
				}
			}
		} catch {
			
		}
		return out;
	}

	async stats(): Promise<LogStats> {
		await this.flush();
		try {
			const st = await stat(this.path);
			const raw = await readFile(this.path, 'utf8');
			const entries = raw.split('\n').filter(l => l.trim()).length;
			return { files: 1, entries, bytes: st.size };
		} catch {
			return { files: 0, entries: 0, bytes: 0 };
		}
	}

	
	async clear(): Promise<number> {
		await this.flush();
		try {
			const raw = await readFile(this.path, 'utf8');
			const n = raw.split('\n').filter(l => l.trim()).length;
			await unlink(this.path);
			return n;
		} catch {
			return 0;
		}
	}

	
	async readAllSessions(): Promise<DeepSkrinEvent[]> {
		const out: DeepSkrinEvent[] = [];
		let files: string[];
		try {
			files = await readdir(this.dir);
		} catch {
			return out;
		}
		for (const f of files) {
			if (!f.startsWith('events-') || !f.endsWith('.ndjson')) continue;
			try {
				const raw = await readFile(join(this.dir, f), 'utf8');
				for (const line of raw.split('\n')) {
					if (!line.trim()) continue;
					try {
						out.push(JSON.parse(line) as DeepSkrinEvent);
					} catch {
						
					}
				}
			} catch {
				
			}
		}
		return out;
	}

	
	async prune(days: number): Promise<number> {
		await this.flush();
		let files: string[];
		try {
			files = await readdir(this.dir);
		} catch {
			return 0;
		}
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		let removed = 0;
		for (const f of files) {
			if (!f.startsWith('events-') || !f.endsWith('.ndjson')) continue;
			try {
				const st = await stat(join(this.dir, f));
				if (st.mtimeMs < cutoff) {
					await unlink(join(this.dir, f));
					removed += 1;
				}
			} catch {
				
			}
		}
		return removed;
	}
}
