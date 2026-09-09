




import type { CrushOptions } from './jsoncrush.ts';

export interface TabularResult {
	text: string;
	wasCompacted: boolean;
	rows: number;
	cols: number;
}

const CELL_CAP = 80;      
const MAX_COLS = 24;      
const MAX_ROWS = 500;     

function isScalar(v: unknown): boolean {
	return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function cell(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') {
		const s = v.replace(/[\n\r\t,]/g, ' ').trim();
		return s.length > CELL_CAP ? s.slice(0, CELL_CAP - 1) + '…' : s;
	}
	return String(v);
}


function colType(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'num';
	if (typeof v === 'boolean') return 'bool';
	if (typeof v === 'string') {
		if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
		if (/^-?\d+(\.\d+)?$/.test(v)) return 'num';
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'uuid';
		return 'str';
	}
	return '';
}






export function compactTable(arr: unknown[]): TabularResult {
	const noOp: TabularResult = { text: JSON.stringify(arr), wasCompacted: false, rows: arr.length, cols: 0 };
	if (!Array.isArray(arr) || arr.length === 0 || arr.length > MAX_ROWS) return noOp;
	if (!arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return noOp;
	const rows = arr as Array<Record<string, unknown>>;

	
	const firstKeys = Object.keys(rows[0]);
	if (firstKeys.length === 0 || firstKeys.length > MAX_COLS) return noOp;
	for (const r of rows) {
		const ks = Object.keys(r);
		if (ks.length !== firstKeys.length || !ks.every((k) => firstKeys.includes(k))) return noOp;
	}
	
	for (const r of rows) {
		for (const k of firstKeys) {
			if (!isScalar(r[k])) return noOp;
		}
	}

	try {
		const schema = firstKeys.map((k) => {
			const sample = rows.find((r) => r[k] !== null && r[k] !== undefined)?.[k];
			return `${k}:${colType(sample)}`;
		});
		const header = `[N=${rows.length}]{${schema.join(',')}}`;
		const body = rows.map((r) => firstKeys.map((k) => cell(r[k])).join(','));
		const text = header + '\n' + body.join('\n');
		
		if (text.length >= JSON.stringify(arr).length) return noOp;
		return { text, wasCompacted: true, rows: rows.length, cols: firstKeys.length };
	} catch {
		return noOp;
	}
}

export type { CrushOptions };
