



import type { BlobStoreState } from './store.ts';
import type { DeepSkrinConfig } from './config.ts';
import type { I18n } from './i18n.ts';

export interface ViewInput {
	state: BlobStoreState;
	blobContents: Map<string, string>;
	config: DeepSkrinConfig;
	i18n: I18n;
	messages: Array<{ role: string; content: string }>;
	toolCallHistory: Array<{ tool: string; input: string; path?: string; hash?: string }>;
}

export interface ViewResult {
	view: string;
	unchanged: boolean;
	stats: { refs: number; elided: number; binary: number; toc: number; lines: number };
}





export function buildView(input: ViewInput): ViewResult {
	const { config, i18n } = input;
	const warmLines: string[] = [];
	const refs: string[] = [];
	const toc: string[] = [];
	let elided = 0;
	let binary = 0;

	
	const warm = input.toolCallHistory.slice(-config.warmWindowK);
	for (const tc of warm) {
		
		
		
		const key = tc.hash ?? hashKey(tc);
		const content = input.blobContents.get(key);
		if (content !== undefined) {
			warmLines.push(`# tool: ${tc.tool}\n${content}`);
		} else {
			refs.push(`[blob:${key.slice(0, config.hashPrefixChars)}:${tc.input.length}]`);
		}
	}

	
	const blobEntries = [...input.state.blobs.entries()];
	for (const [hash, meta] of blobEntries.slice(0, config.tocMaxEntries)) {
		if (meta.kind === 'binary') continue; 
		const content = input.blobContents.get(hash);
		if (content === undefined) continue;
		const firstLine = content.split('\n')[0]?.slice(0, 80) ?? '';
		toc.push(`  ${meta.hash.slice(0, config.hashPrefixChars)} · ${meta.size} chars${firstLine ? ' · ' + firstLine : ''}`);
	}

	
	for (const [hash, meta] of blobEntries) {
		if (meta.size > config.maxBlobBytes) {
			elided++;
			refs.push(i18n.t('view.tooBig', { kind: meta.kind, bytes: meta.size }));
		} else if (meta.kind === 'binary') {
			binary++;
			refs.push(i18n.t('view.binary', { bytes: meta.size }));
		}
	}

	
	const parts: string[] = [];
	if (warmLines.length > 0) parts.push(warmLines.join('\n\n'));
	if (refs.length > 0) parts.push(refs.join('\n'));
	if (toc.length > 0) parts.push(`# ${i18n.t('view.toc')}\n${toc.join('\n')}`);

	const view = parts.join('\n\n');
	const unchanged = view.length === 0;
	return {
		view,
		unchanged,
		stats: { refs: refs.length, elided, binary, toc: toc.length, lines: view.split('\n').length },
	};
}

function hashKey(tc: { tool: string; input: string; path?: string }): string {
	
	
	return sha256Local(tc.tool + '\n' + tc.input);
}

function sha256Local(s: string): string {
	
	let h = 0xcbf29ce484222325n;
	for (let i = 0; i < s.length; i++) {
		h ^= BigInt(s.charCodeAt(i));
		h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	return h.toString(16).padStart(16, '0');
}
