

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENT_SCHEMA_VERSION } from '../core/events.ts';
import type { DeepSkrinConfig } from '../core/config.ts';
import type { BlobStoreState } from '../core/store.ts';
import { redact } from '../core/redact.ts';

export interface ExportResult {
	path: string;
	entries: number;
	blobs: number;
	redacted: boolean;
}


export async function exportBundle(opts: {
	dir: string;          
	outPath: string;
	config: DeepSkrinConfig;
	state: BlobStoreState;
	sessionEvents: Array<{ file: string; lines: string[] }>;
	redactPaths?: boolean;
}): Promise<ExportResult> {
	const { dir, outPath, config, state } = opts;
	const redactPaths = opts.redactPaths ?? true;
	await mkdir(join(outPath, '..'), { recursive: true });

	const eventsDir = join(dir, 'events');
	await mkdir(eventsDir, { recursive: true });
	let entries = 0;
	const eventLines: string[] = [];
	let files: string[] = [];
	try {
		files = await readdir(eventsDir);
	} catch {
		
	}
	for (const f of files) {
		if (!f.endsWith('.ndjson')) continue;
		try {
			const raw = await readFile(join(eventsDir, f), 'utf8');
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue;
				let l = line;
				if (redactPaths) l = redact(l).text; 
				eventLines.push(l);
				entries++;
			}
		} catch {
			
		}
	}

	let blobs = 0;
	const blobManifest: Array<{ hash: string; size: number; kind: string }> = [];
	for (const [hash, meta] of state.blobs) {
		blobManifest.push({ hash, size: meta.size, kind: meta.kind });
		blobs++;
	}

	const bundle = {
		version: EVENT_SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		config,
		store: { rev: state.indexRev, blobs: blobManifest },
		events: eventLines,
		note: redactPaths ? 'paths and secrets redacted by default' : 'unredacted (explicit)',
	};
	await writeFile(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
	return { path: outPath, entries, blobs, redacted: redactPaths };
}
