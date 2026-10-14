


export interface ModApi {
	hooks(opts: Record<string, (o?: any) => any>): void;
	on(event: string, handler: (opts?: any) => void): void;
	addCommand(opts: {
		name: string;
		description: string;
		argumentHint?: string;
		handler: (opts: { args: string }) => Promise<{ message?: string; prompt?: string }> | { message?: string; prompt?: string };
	}): void;
	addTool(opts: {
		schema: { name: string; description: string; input_schema: { type: string; properties: Record<string, unknown>; required: string[] } };
		run: (opts: { input: Record<string, unknown>; runtime?: unknown; signal?: unknown }) => Promise<{ ok: boolean; content?: Array<{ type: string; text: string }>; error?: string }>;
		readOnly?: boolean;
	}): void;
	addRenderer(type: string, fn: (data?: any) => string[]): void;
	ui: {
		notify(msg: string): void;
		setStatus?(msg: string): void;
		select?(opts: { title: string; options: Array<{ label: string; value: string }> }): Promise<string | number | { label: string; value: string } | null>;
		confirm?(opts: { title: string }): Promise<boolean>;
		asciiPanel?(title: string, body: string): string;
		centerBox?(content: string): string;
	};
	exec(opts: { command: string; args?: string[] }): Promise<{ stdout: string; stderr?: string; code: number }>;
	session?: {
		



		appendCustomMessageEntry?(opts: { customType: string; content: string; display?: string; details?: string }): Promise<{ entryId: string; message: { role: string; content: unknown; meta?: Record<string, unknown> } }>;
		getCustomEntries?(opts: { customType: string }): Promise<Array<{ data: unknown }>>;
	};
	showEntry?(customType: string, data: unknown): void;
	events?: { emit?(type: string, payload: unknown): void };
}
