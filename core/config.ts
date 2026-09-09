

export type Locale = 'en' | 'fr';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DeepSkrinConfig {
	enabled: boolean;
	locale: Locale;
	logLevel: LogLevel;
	
	maxBlobBytes: number;        
	hashPrefixChars: number;     
	
	
	
	
	maxFullFileBytes: number;
	elideWindowedReads: boolean;
	warmWindowK: number;
	compactGuard: boolean;
	
	maxViewTokens: number;       
	tocMaxEntries: number;
	activeFileTtlMs: number;
	recallBudgetChars: number;   
	fidelityServeChars: number;  
	
	warnThresholdPct: number;    
	estimateCharsPerToken: number; 
	
	breakerThreshold: number;    
	breakerHalfOpenTurns: number;
	
	gcMinBlobAgeMs: number;
	gcIntervalMs: number;        
	
	digestEnabled: boolean;
	
	
	
	
	neverElidePrefixes: string[];
	
	compressEnabled: boolean;
	compressMinChars: number;
	compressTargetRatio: number;
	language: 'auto' | 'fr' | 'en';
	
	
	
	viewEnabled: boolean;
}

export const DEFAULT_CONFIG: DeepSkrinConfig = {
	enabled: false, 
	locale: 'en',
	logLevel: 'info',
	maxBlobBytes: 256 * 1024,
	maxFullFileBytes: 1024 * 1024,
	elideWindowedReads: true,
	hashPrefixChars: 12,
	warmWindowK: 40,
	compactGuard: true,
	maxViewTokens: 2000,
	tocMaxEntries: 24,
	activeFileTtlMs: 5 * 60_000,
	recallBudgetChars: 2000,
	fidelityServeChars: 24 * 1024,
	warnThresholdPct: 0.8,
	estimateCharsPerToken: 3.3,
	breakerThreshold: 3,
	breakerHalfOpenTurns: 5,
	gcMinBlobAgeMs: 30 * 60_000,
	gcIntervalMs: 30 * 60_000,
	digestEnabled: true,
	
	
	
	neverElidePrefixes: [
		'open', 'npm install', 'npm i', 'npm run', 'bun install', 'bun run', 'bunx',
		'git add', 'git commit', 'git push', 'git pull', 'git fetch', 'git merge', 'git rebase', 'git reset', 'git checkout', 'git branch -d', 'git tag',
		'rm ', 'rm -rf', 'mv ', 'cp ', 'mkdir', 'touch', 'chmod', 'chown',
		'kill', 'pkill', 'taskkill', 'systemctl', 'launchctl', 'brew install', 'brew upgrade', 'brew uninstall',
		'pip install', 'pip uninstall', 'cargo install', 'cargo build', 'cargo run', 'cargo test', 'bun test',
		'node ', 'node --', 'python3', 'python ', 'curl', 'wget', 'ping', 'ssh', 'scp',
		'watch', 'tail -f', 'yes', 'sleep', 'time', 'sudo',
	],
	compressEnabled: true,
	compressMinChars: 500,
	compressTargetRatio: 0.65,
	language: 'auto',
	viewEnabled: false,
};

export function mergeConfig(partial: Partial<DeepSkrinConfig> | null | undefined): DeepSkrinConfig {
	if (!partial || typeof partial !== 'object') return { ...DEFAULT_CONFIG };
	const out: DeepSkrinConfig = { ...DEFAULT_CONFIG };
	for (const k of Object.keys(out) as (keyof DeepSkrinConfig)[]) {
		const v = (partial as Record<string, unknown>)[k];
		const target = out[k];
		if (typeof v === 'boolean' && typeof target === 'boolean') (out as unknown as Record<string, unknown>)[k] = v;
		else if (typeof v === 'number' && typeof target === 'number') (out as unknown as Record<string, unknown>)[k] = v;
		else if (typeof v === 'string' && typeof target === 'string') (out as unknown as Record<string, unknown>)[k] = v;
	}
	
	if (partial.locale !== 'en' && partial.locale !== 'fr') out.locale = DEFAULT_CONFIG.locale;
	if (!['debug', 'info', 'warn', 'error'].includes(partial.logLevel ?? '')) out.logLevel = DEFAULT_CONFIG.logLevel;
	
	if (Array.isArray(partial.neverElidePrefixes) && partial.neverElidePrefixes.every(v => typeof v === 'string')) {
		out.neverElidePrefixes = partial.neverElidePrefixes;
	}
	return out;
}

export function isConfig(v: unknown): v is DeepSkrinConfig {
	if (!v || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return typeof o.enabled === 'boolean' && typeof o.locale === 'string' && typeof o.logLevel === 'string';
}
