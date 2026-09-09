


export interface MenuOption {
	label: string;
	value: string;
}

export type MenuState = 'main' | 'status' | 'stats' | 'recall' | 'store' | 'logs' | 'config' | 'help' | 'exit';

export interface MenuContext {
	select: (title: string, options: MenuOption[]) => Promise<string | null>;
}

export type MenuAction = { kind: 'render'; text: string } | { kind: 'navigate'; to: MenuState } | { kind: 'exit'; text: string } | { kind: 'back' };

export interface MenuDefinition {
	title: string;
	options: MenuOption[];
	handler: (choice: string) => MenuAction;
}

export const MAIN_MENU: MenuDefinition = {
	title: 'DeepSkrin  ·  main menu',
	options: [
		{ label: 'STATUS    · session + store + guard state', value: 'status' },
		{ label: 'STATS     · efficiency, break-even, cache hit', value: 'stats' },
		{ label: 'RECALL    · query the content store', value: 'recall' },
		{ label: 'STORE     · blobs, GC, sessions', value: 'store' },
		{ label: 'LOGS      · tail / level / stats / export', value: 'logs' },
		{ label: 'CONFIG    · budgets, thresholds, locale', value: 'config' },
		{ label: 'HELP      · all commands + usage', value: 'help' },
		{ label: '✕ Cancel', value: 'cancel' },
	],
	handler: (choice: string): MenuAction => {
		switch (choice) {
			case 'status': return { kind: 'navigate', to: 'status' };
			case 'stats': return { kind: 'navigate', to: 'stats' };
			case 'recall': return { kind: 'navigate', to: 'recall' };
			case 'store': return { kind: 'navigate', to: 'store' };
			case 'logs': return { kind: 'navigate', to: 'logs' };
			case 'config': return { kind: 'navigate', to: 'config' };
			case 'help': return { kind: 'navigate', to: 'help' };
			case 'cancel': return { kind: 'exit', text: 'cancelled' };
			default: return { kind: 'exit', text: 'unknown action' };
		}
	},
};

export interface SubMenuSpec {
	state: MenuState;
	definition: MenuDefinition;
	
	render: () => Promise<string> | string;
}





export async function runMenu(
	ctx: MenuContext,
	submenus: SubMenuSpec[],
): Promise<string> {
	if (!ctx.select) {
		return renderStatic(MAIN_MENU);
	}
	let current: MenuState = 'main';
	let exit = false;
	let result = '';

	while (!exit) {
		const def: MenuDefinition | undefined = current === 'main' ? MAIN_MENU : submenus.find(s => s.state === current)?.definition;
		if (!def) {
			result = 'unknown state';
			break;
		}
		const title = current === 'main' ? MAIN_MENU.title : def.title;
		const choice = await ctx.select(title, def.options);
		if (choice === null) {
			result = 'cancelled';
			break;
		}
		const action: MenuAction = def.handler(choice);
		switch (action.kind) {
			case 'render':
				result = action.text;
				break;
			case 'navigate':
				current = action.to;
				break;
			case 'exit':
				result = action.text;
				exit = true;
				break;
			case 'back':
				current = 'main';
				break;
		}
	}
	return result;
}


export function renderStatic(def: MenuDefinition): string {
	return `${def.title}\n${def.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`;
}
