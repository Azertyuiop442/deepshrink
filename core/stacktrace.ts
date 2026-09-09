




export interface StackTraceOptions {
	maxTraces: number;      
	maxFramesPerTrace: number;
	collapseRuntime: boolean; 
}

export const DEFAULT_STACKTRACE_OPTIONS: StackTraceOptions = {
	maxTraces: 3,
	maxFramesPerTrace: 20,
	collapseRuntime: true,
};

export interface StackTraceResult {
	text: string;
	wasCompressed: boolean;
	tracesFound: number;
}


const RUNTIME_FRAMES = [
	/node_modules\//,
	/\/dist\/|\\dist\\/,
	/\/build\/|\\build\\/,
	/\b(?:core|lib|rt|runtime)\/(?:python|go|java|js)\b/,
	/^at (?:process|Module|Function|Object)\./,
	/^File "<(?:frozen|stdin|string)[^"]*"/,
	/goroutine \d+ \[/,
	/java\.base\//,                 
	/jdk\.internal\./,              
	/\(Native Method\)/,            
	/^runtime\.main\(\)/,           
	/^runtime\.(?:proc|panic)/,     
	/^at jdk\./,                    
];


export function isFrameLine(line: string): boolean {
	const t = line.trim();
	if (/^File ".*", line \d+/.test(t)) return true;                    
	if (/^at [\w$./<>-]+\(.*\)$/.test(t)) return true;                  
	if (/^at [\w$./<>-]+ \(.*\)$/.test(t)) return true;                 
	if (/^at [\w$./<>-]+$/.test(t)) return true;                        
	if (/^at .*:\d+(?::\d+)?$/.test(t)) return true;                   
	if (/^\s+at .*:\d+:\d+$/.test(t)) return true;                     
	if (/^\w+\.\w+\(.*\)$/.test(t) && /:\d+/.test(t)) return true;     
	if (/^\s+in .+:\d+$/.test(t)) return true;                         
	if (/^\s+\d+:\s/.test(t) && /\(.*\)/.test(t)) return true;         
	
	
	if (/^\s{4,}[\w.]+\([^)]*\)$/.test(t)) return true;
	
	if (/^[\w./]+\(\)$/.test(t)) return true;
	
	
	if (/^\/?[\w./-]+:\d+\s+\+0x[0-9a-f]+$/.test(t)) return true;
	return false;
}

function isRuntimeFrame(line: string): boolean {
	const t = line.trim();
	return RUNTIME_FRAMES.some((re) => re.test(t));
}


function collapseFrames(frames: string[], maxKeep: number): { kept: string[]; runtime: number } {
	const app = frames.filter((f) => !isRuntimeFrame(f));
	const runtimeCount = frames.length - app.length;
	const kept = app.slice(0, maxKeep);
	return { kept, runtime: runtimeCount };
}










export function compressStackTraces(text: string, options: Partial<StackTraceOptions> = {}): StackTraceResult {
	const opts = { ...DEFAULT_STACKTRACE_OPTIONS, ...options };
	const lines = text.split('\n');
	const out: string[] = [];
	let tracesFound = 0;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const isError = /error|exception|traceback|panic|failed|✗|×|not ok|fatal/i.test(line);
		
		
		let frameStart = -1;
		if (isError && tracesFound < opts.maxTraces) {
			
			
			for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
				if (isFrameLine(lines[k])) { frameStart = k; break; }
			}
		}
		if (frameStart >= 0) {
			let j = frameStart;
			const frames: string[] = [];
			while (j < lines.length && isFrameLine(lines[j])) {
				frames.push(lines[j]);
				j++;
			}
			tracesFound++;
			const { kept, runtime } = collapseFrames(frames, opts.maxFramesPerTrace);
			out.push(line);
			for (const f of kept.slice(0, opts.maxFramesPerTrace)) out.push(f);
			if (runtime > 0) out.push(`    [... ${runtime} runtime frames collapsed]`);
			if (kept.length > opts.maxFramesPerTrace) out.push(`    [... ${kept.length - opts.maxFramesPerTrace} more frames]`);
			i = j;
			continue;
		}
		out.push(line);
		i++;
	}

	const result = out.join('\n');
	if (result === text) return { text, wasCompressed: false, tracesFound: 0 };
	return { text: result, wasCompressed: true, tracesFound };
}
