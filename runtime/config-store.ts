

import { readFile, writeFile, rename, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeepSkrinConfig } from '../core/config.ts';
import { DEFAULT_CONFIG, mergeConfig, isConfig } from '../core/config.ts';

const TMP_PREFIX = 'tmp-';
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

export class ConfigStore {
	private dir: string;
	private name: string;

	constructor(dir: string, name = 'config.json') {
		this.dir = dir;
		this.name = name;
	}

	private get path(): string {
		return join(this.dir, this.name);
	}

	async load(): Promise<{ config: DeepSkrinConfig; corrupt: boolean }> {
		await this.sweepTemps();
		try {
			const raw = await readFile(this.path, 'utf8');
			const parsed = JSON.parse(raw) as unknown;
			if (!isConfig(parsed)) return { config: { ...DEFAULT_CONFIG }, corrupt: true };
			return { config: mergeConfig(parsed as Partial<DeepSkrinConfig>), corrupt: false };
		} catch {
			return { config: { ...DEFAULT_CONFIG }, corrupt: true };
		}
	}

	async save(config: DeepSkrinConfig): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const tmp = `${this.path}.${TMP_PREFIX}${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		try {
			await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
			await rename(tmp, this.path);
		} catch (err) {
			await unlink(tmp).catch(() => {});
			throw err;
		}
	}

	async sweepTemps(): Promise<number> {
		let removed = 0;
		let entries: string[];
		try {
			entries = await readdir(this.dir);
		} catch {
			return 0;
		}
		const prefix = `${this.name}.`;
		const now = Date.now();
		for (const entry of entries) {
			if (!entry.startsWith(prefix) || !entry.includes(TMP_PREFIX)) continue;
			const full = join(this.dir, entry);
			try {
				const st = await stat(full);
				if (now - st.mtimeMs < TMP_MAX_AGE_MS) continue;
				await unlink(full);
				removed += 1;
			} catch {}
		}
		return removed;
	}
}
