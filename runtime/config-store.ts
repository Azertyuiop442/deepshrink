

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeepSkrinConfig } from '../core/config.ts';
import { DEFAULT_CONFIG, mergeConfig, isConfig } from '../core/config.ts';

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
		const tmp = this.path + '.tmp';
		await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
		await rename(tmp, this.path);
	}
}
