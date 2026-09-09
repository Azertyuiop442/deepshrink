



import { hashForContent, shortHash } from './hash.ts';
import type { DeepSkrinConfig } from './config.ts';

export interface BlobMeta {
	hash: string;        
	size: number;
	createdAt: number;   
	lastRef: number;     
	



	contentAt?: number;
	session: string;     
	kind: 'text' | 'binary';
	
	workspace: string;   
	source: string;      
	command?: string;    
	filePath?: string;   
	searchPattern?: string; 
	fileMtime?: number;  
	fileSize?: number;   
	





	dirMtime?: number;
	dirSize?: number;    
	editedByModel?: boolean; 
	


	fullFile?: boolean;
	

	realPath?: string;
}

export interface BlobStoreState {
	blobs: Map<string, BlobMeta>;
	indexRev: number;
}

export const EMPTY_STORE: BlobStoreState = { blobs: new Map(), indexRev: 0 };

export interface IngestResult {
	hash: string;          
	short: string;         
	chunks: number;
	newBlobs: number;
	reference: string;     
	bypass: boolean;
	superseded: string[];  
	
	
	
	
	
	supersededCause?: { edited: string[]; reIngestSameHash: string[] };
}






export function ingestContent(
	state: BlobStoreState,
	content: string,
	session: string,
	config: DeepSkrinConfig,
	now = Date.now(),
	bypass = false,
	provenance: Partial<Pick<BlobMeta, 'workspace' | 'source' | 'command' | 'filePath' | 'searchPattern' | 'fileMtime' | 'fileSize' | 'dirMtime' | 'dirSize' | 'fullFile' | 'realPath'>> = {},
): IngestResult {
	const hash = hashForContent(content);
	const short = shortHash(content, config.hashPrefixChars);
	const reference = `[blob:${short}:${content.length}]`;

	if (bypass) {
		return { hash, short, chunks: 1, newBlobs: 0, reference, bypass: true, superseded: [] };
	}

	const existing = state.blobs.get(hash);
	if (existing) {
		existing.lastRef = now;
		
		
		if (provenance.workspace !== undefined) existing.workspace = provenance.workspace;
		if (provenance.source !== undefined) existing.source = provenance.source;
		if (provenance.command !== undefined) existing.command = provenance.command;
		if (provenance.filePath !== undefined) existing.filePath = provenance.filePath;
		if (provenance.searchPattern !== undefined) existing.searchPattern = provenance.searchPattern;
		if (provenance.fileMtime !== undefined) existing.fileMtime = provenance.fileMtime;
		if (provenance.fileSize !== undefined) existing.fileSize = provenance.fileSize;
		if (provenance.dirMtime !== undefined) existing.dirMtime = provenance.dirMtime;
		if (provenance.dirSize !== undefined) existing.dirSize = provenance.dirSize;
		if (provenance.fullFile !== undefined) existing.fullFile = provenance.fullFile;
		if (provenance.realPath !== undefined) existing.realPath = provenance.realPath;
		
		
		
		
		
		const superseded: string[] = [];
		const supersededCause: { edited: string[]; reIngestSameHash: string[] } = { edited: [], reIngestSameHash: [] };
		if (provenance.filePath !== undefined && provenance.fileMtime !== undefined) {
			for (const [h, meta] of state.blobs) {
				if (meta.filePath === provenance.filePath && meta.fileMtime !== undefined &&
					meta.fileMtime < provenance.fileMtime && h !== hash) {
					state.blobs.delete(h);
					superseded.push(h);
					if (meta.source === 'read_file' && meta.fileMtime !== provenance.fileMtime) {
						
						supersededCause.edited.push(h);
					} else {
						supersededCause.reIngestSameHash.push(h);
					}
				}
			}
		}
		if (superseded.length > 0) state.indexRev += 1;
		return { hash, short, chunks: 1, newBlobs: 0, reference, bypass: false, superseded, supersededCause };
	}

	
	
	
	const superseded: string[] = [];
	const supersededCause: { edited: string[]; reIngestSameHash: string[] } = { edited: [], reIngestSameHash: [] };
	if (provenance.filePath !== undefined && provenance.fileMtime !== undefined) {
		for (const [h, meta] of state.blobs) {
			if (meta.filePath === provenance.filePath && meta.fileMtime !== undefined &&
				meta.fileMtime < provenance.fileMtime && meta.hash !== hash) {
				state.blobs.delete(h);
				superseded.push(h);
				supersededCause.edited.push(h);
			}
		}
	}
	if (superseded.length > 0) state.indexRev += 1;

	state.blobs.set(hash, {
		hash,
		size: content.length,
		createdAt: now,
		lastRef: now,
		
		
		contentAt: provenance.fileMtime ?? now,
		session,
		kind: detectBinary(content) ? 'binary' : 'text',
		workspace: provenance.workspace ?? '',
		source: provenance.source ?? '',
		command: provenance.command,
		filePath: provenance.filePath,
		searchPattern: provenance.searchPattern,
		fileMtime: provenance.fileMtime,
		fileSize: provenance.fileSize,
		dirMtime: provenance.dirMtime,
		dirSize: provenance.dirSize,
		editedByModel: false,
		fullFile: provenance.fullFile,
		realPath: provenance.realPath,
	});
	state.indexRev += 1;

	return { hash, short, chunks: 1, newBlobs: 1, reference, bypass: false, superseded, supersededCause };
}


export function supersedeCounts(res: IngestResult): { edited: number; reIngestSameHash: number } {
	return {
		edited: res.supersededCause?.edited.length ?? 0,
		reIngestSameHash: res.supersededCause?.reIngestSameHash.length ?? 0,
	};
}


export function detectBinary(content: string): boolean {
	if (!content) return false;
	
	let ctrl = 0;
	for (let i = 0; i < Math.min(content.length, 8192); i++) {
		const c = content.charCodeAt(i);
		if (c === 0) return true;
		if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
	}
	if (ctrl / Math.min(content.length, 8192) > 0.1) return true;
	
	
	
	const sample = content.slice(0, 8192);
	if (/<\/?[a-z][\s\S]{0,200}?>/.test(sample) || /https?:\/\/\S+/.test(sample) || /^#+\s/m.test(sample) || /[\u00C0-\u017F]/.test(sample)) {
		return false;
	}
	
	const lines = content.split('\n').filter(l => l.trim().length > 0);
	if (lines.length >= 3) {
		const longLines = lines.filter(l => l.length >= 8);
		if (longLines.length >= 3) {
			const base64ish = longLines.every(l => /^[A-Za-z0-9+/=]+$/.test(l.trim()));
			if (base64ish) return true;
		}
	}
	return false;
}


export function gcStore(
	state: BlobStoreState,
	opts: { minAgeMs: number; activeSessions: Set<string>; now?: number },
): { removed: number; blobsRemaining: number } {
	const now = opts.now ?? Date.now();
	const cutoff = now - opts.minAgeMs;
	let removed = 0;
	for (const [hash, meta] of state.blobs) {
		const isActive = opts.activeSessions.has(meta.session);
		if (!isActive && meta.lastRef < cutoff && meta.createdAt < cutoff) {
			state.blobs.delete(hash);
			removed++;
		}
	}
	if (removed > 0) state.indexRev += 1;
	return { removed, blobsRemaining: state.blobs.size };
}


export function recallBlobs(
	state: BlobStoreState,
	blobContents: Map<string, string>,
	pattern: RegExp,
	limit = 10,
): Array<{ hash: string; short: string; content: string; ref: string; lastRef: number }> {
	const out: Array<{ hash: string; short: string; content: string; ref: string; lastRef: number }> = [];
	for (const [hash, meta] of state.blobs) {
		const content = blobContents.get(hash);
		if (content === undefined) continue;
		if (pattern.test(content)) {
			out.push({ hash, short: meta.hash.slice(0, 12), content, ref: `[blob:${meta.hash.slice(0, 12)}:${content.length}]`, lastRef: meta.lastRef });
		}
	}
	out.sort((a, b) => b.lastRef - a.lastRef);
	return out.slice(0, limit);
}


export function rebuildIndex(entries: Array<{ hash: string; content: string; session: string; createdAt: number }>): BlobStoreState {
	const state: BlobStoreState = { blobs: new Map(), indexRev: 0 };
	for (const e of entries) {
		const hash = hashForContent(e.content);
		if (hash !== e.hash) continue; 
		state.blobs.set(hash, {
			hash,
			size: e.content.length,
			createdAt: e.createdAt,
			lastRef: e.createdAt,
			contentAt: e.createdAt,
			session: e.session,
			kind: detectBinary(e.content) ? 'binary' : 'text',
			
			
			
			
			workspace: '',
			source: '',
		});
	}
	state.indexRev = 1;
	return state;
}
