



import type { BlobMeta } from './store.ts';

export interface FreshnessSignals {
	
	workspace: string;
	
	meta: BlobMeta;
	
	fileNow?: { mtimeMs: number; size: number } | null; 
	
	supplanted?: boolean;
	
	editedByModel?: boolean;
	
	now?: number;
	


	shellFileNow?: { mtimeMs: number; size: number } | null;
	


	shellFileMtime?: number;
	


	dirNow?: { mtimeMs: number; size: number } | null;
	
	dirMtime?: number;
	dirSize?: number;
}



export interface FreshnessProvenance {
	fileNow?: { mtimeMs: number; size: number } | null;
	shellFileNow?: { mtimeMs: number; size: number } | null;
	shellFileMtime?: number;
	dirNow?: { mtimeMs: number; size: number } | null;
}

export interface ConfidenceResult {
	score: number;        
	flags: string[];      
	stale: boolean;       
}

export const STALE_THRESHOLD = 40;





export function scoreConfidence(s: FreshnessSignals): ConfidenceResult {
	let score = 50; 
	const flags: string[] = [];
	const now = s.now ?? Date.now();
	const meta = s.meta;

	
	if (meta.workspace && s.workspace) {
		if (meta.workspace === s.workspace) score += 25;
		else { score -= 70; flags.push('other workspace'); }
	} else {
		flags.push('no workspace');
	}

	
	if (meta.source === 'read_file' && meta.filePath) {
		if (s.editedByModel || meta.editedByModel) {
			score -= 60;
			flags.push('edited by model');
		} else if (s.fileNow === undefined) {
			
			flags.push('read_file (unverified)');
		} else if (s.fileNow === null) {
			score -= 60;
			flags.push('file deleted');
		} else if (meta.fileMtime !== undefined && meta.fileSize !== undefined) {
			if (s.fileNow.mtimeMs === meta.fileMtime && s.fileNow.size === meta.fileSize) {
				score += 40;
				flags.push('file unchanged');
			} else {
				score -= 60;
				flags.push('file modified');
			}
		} else {
			
			
			flags.push('read_file (unverified)');
		}
	} else if (meta.source === 'shell_command' && s.shellFileNow !== undefined) {
		
		
		
		if (meta.editedByModel) {
			score -= 60;
			flags.push('edited by model');
		} else if (s.shellFileNow === null) {
			score -= 60;
			flags.push('file deleted');
		} else if (s.shellFileMtime !== undefined) {
			if (s.shellFileNow.mtimeMs === s.shellFileMtime) {
				score += 40;
				flags.push('file unchanged');
			} else {
				score -= 60;
				flags.push('file modified');
			}
		} else {
			flags.push('command (unverified)');
		}
	} else if (meta.source === 'shell_command' && s.dirNow !== undefined) {
		
		
		
		
		
		
		if (meta.editedByModel) {
			score -= 60;
			flags.push('edited by model');
		} else if (s.dirNow === null) {
			score -= 60;
			flags.push('directory deleted');
		} else if (meta.dirMtime !== undefined && meta.dirSize !== undefined) {
			if (s.dirNow.mtimeMs === meta.dirMtime && s.dirNow.size === meta.dirSize) {
				score += 40;
				flags.push('dir unchanged');
			} else {
				score -= 60;
				flags.push('dir changed');
			}
		} else {
			flags.push('command (unverified)');
		}
	} else if (meta.source && meta.source !== 'read_file') {
		
		if (meta.source === 'web_search' || meta.source === 'web_fetch') {
			
			
			
			
			
			
			
			flags.push('web result — may have changed, re-search if critical');
			const webAgeMs = now - (meta.lastRef || meta.createdAt || now);
			if (webAgeMs < 2 * 60_000) score += 10;   
			else if (webAgeMs < 15 * 60_000) score -= 15;
			else score -= 35;                          
		} else if (meta.source === 'shell_command' && meta.command && /^git (status|diff|log)/.test(meta.command)) {
			
			
			
			
			flags.push('git state — may have changed, re-run if acting on it');
			const gitAgeMs = now - (meta.lastRef || meta.createdAt || now);
			if (gitAgeMs < 5 * 60_000) score += 5;
			else if (gitAgeMs < 30 * 60_000) score -= 10;
			else score -= 25;
		} else {
			flags.push('command (age only)');
		}
	}

	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	const ageMs = now - (meta.contentAt ?? meta.createdAt ?? now);
	const fileProven = meta.source === 'read_file' && meta.fileMtime !== undefined;
	const shellProven = meta.source === 'shell_command' && meta.fileMtime !== undefined;
	const dirProven = meta.source === 'shell_command' && meta.dirMtime !== undefined && meta.dirSize !== undefined;
	if (!fileProven && !shellProven && !dirProven) {
		if (ageMs < 5 * 60_000) score += 20;
		else if (ageMs < 60 * 60_000) score += 5;
		else if (ageMs < 4 * 60 * 60_000) score -= 10;
		else if (ageMs < 24 * 60 * 60_000) score -= 40;
		else score -= 55;
	}

	
	if (s.supplanted) {
		score -= 30;
		flags.push('superseded');
	}

	score = Math.max(0, Math.min(100, score));
	const stale = score < STALE_THRESHOLD;
	if (stale) flags.push('stale');
	return { score, flags, stale };
}








export function freshnessSignals(
	meta: BlobMeta,
	workspace: string,
	provenance: FreshnessProvenance = {},
	opts: { editedByModel?: boolean; supplanted?: boolean; now?: number } = {},
): FreshnessSignals {
	return {
		workspace,
		meta,
		fileNow: provenance.fileNow,
		shellFileNow: provenance.shellFileNow,
		shellFileMtime: provenance.shellFileMtime ?? meta.fileMtime,
		dirNow: provenance.dirNow,
		dirMtime: meta.dirMtime,
		dirSize: meta.dirSize,
		editedByModel: opts.editedByModel ?? meta.editedByModel,
		supplanted: opts.supplanted,
		now: opts.now,
	};
}
