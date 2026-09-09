









export type Language = 'fr' | 'en' | 'es' | 'de' | 'mixed' | 'unknown';


export function foldAscii(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') 
		.replace(/[œæ]/g, (c) => (c === 'œ' ? 'oe' : 'ae'))
		.replace(/ß/g, 'ss');
}



const FR_WORDS = new Set([
	'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'sont', 'que', 'qui',
	'qu', 'pour', 'dans', 'sur', 'avec', 'par', 'pas', 'ne', 'ce', 'cet', 'cette', 'ces',
	'mais', 'ou', 'donc', 'or', 'ni', 'car', 'si', 'en', 'au', 'aux', 'se', 'sa', 'son',
	'ses', 'leur', 'leurs', 'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'bien',
	'tres', 'aussi', 'comme', 'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'je',
	'j', 'tu', 'etre', 'avoir', 'faire', 'cela', 'ca', 'celui', 'celle', 'dont', 'ou',
	'quand', 'comment', 'pourquoi', 'combien', 'alors', 'apres', 'avant', 'pendant',
	'entre', 'chez', 'sans', 'selon', 'vers', 'depuis', 'jusqu', 'ainsi', 'voici',
]);
const EN_WORDS = new Set([
	'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these',
	'those', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'are',
	'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
	'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall', 'not',
	'no', 'nor', 'so', 'too', 'very', 'just', 'about', 'into', 'over', 'under', 'again',
	'further', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
	'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
	'same', 's', 't', 'don', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'them',
	'his', 'her', 'their', 'our', 'your', 'my', 'me', 'us', 'him', 'out', 'up', 'down',
]);


const ES_WORDS = new Set([
	'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o', 'u',
	'que', 'quien', 'es', 'son', 'esta', 'este', 'estos', 'estas', 'en', 'por', 'para',
	'con', 'sin', 'sobre', 'entre', 'pero', 'mas', 'menos', 'muy', 'bien', 'como',
	'cuando', 'donde', 'porque', 'tambien', 'entonces', 'asi', 'se', 'su', 'sus',
	'me', 'te', 'nos', 'les', 'lo', 'le', 'al', 'a', 'ha', 'han', 'he', 'hay', 'era',
	'fue', 'ser', 'estar', 'tener', 'hacer', 'todo', 'toda', 'todos', 'todas', 'nada',
	'algo', 'cada', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'aunque',
	'siempre', 'nunca', 'ya', 'despues', 'antes', 'durante', 'hasta', 'desde', 'casi',
]);


const DE_WORDS = new Set([
	'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'eines',
	'einer', 'und', 'oder', 'aber', 'auch', 'nicht', 'nur', 'ist', 'sind', 'war',
	'waren', 'wird', 'werden', 'wurde', 'hat', 'haben', 'hatte', 'kann', 'konnen',
	'muss', 'mussen', 'soll', 'sollen', 'will', 'wollen', 'mit', 'von', 'fur', 'auf',
	'an', 'in', 'uber', 'unter', 'zwischen', 'nach', 'vor', 'bei', 'aus', 'zu', 'zur',
	'zum', 'als', 'wie', 'wenn', 'weil', 'dass', 'denn', 'doch', 'man', 'ich', 'du',
	'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein', 'ihr', 'unser', 'euer',
	'sich', 'nichts', 'etwas', 'jeder', 'jede', 'jedes', 'alle', 'viel', 'wenig',
	'immer', 'nie', 'schon', 'noch', 'auch', 'ganz', 'sehr', 'wieder', 'dann',
]);


export function countStopwords(text: string): { fr: number; en: number; es: number; de: number } {
	let fr = 0;
	let en = 0;
	let es = 0;
	let de = 0;
	
	
	const folded = foldAscii(text.toLowerCase());
	for (const w of folded.match(/[a-z']+/g) ?? []) {
		if (FR_WORDS.has(w)) fr++;
		if (EN_WORDS.has(w)) en++;
		if (ES_WORDS.has(w)) es++;
		if (DE_WORDS.has(w)) de++;
	}
	return { fr, en, es, de };
}





export function detectLanguage(text: string, minLen = 40): Language {
	if (!text || text.length < minLen) return 'unknown';
	const { fr, en, es, de } = countStopwords(text);
	const counts = { fr, en, es, de } as Record<string, number>;
	
	
	const accentBoost = /[àâäéèêëîïôöùûüçœæ]/i.test(text) ? 1 : 0;
	const frEff = fr + accentBoost;
	counts.fr = frEff;
	
	const entries = Object.entries(counts).filter(([, n]) => n > 0) as Array<[string, number]>;
	if (entries.length === 0) return 'unknown';
	entries.sort((a, b) => b[1] - a[1]);
	const [topLang, topN] = entries[0];
	const secondN = entries[1]?.[1] ?? 0;
	if (topN > secondN * 1.5) return topLang as Language;
	
	return entries.length > 1 ? 'mixed' : (topLang as Language);
}


export function stopwordsFor(lang: Language): Set<string> {
	switch (lang) {
		case 'fr': return FR_WORDS;
		case 'en': return EN_WORDS;
		case 'es': return ES_WORDS;
		case 'de': return DE_WORDS;
		default: return new Set([...FR_WORDS, ...EN_WORDS, ...ES_WORDS, ...DE_WORDS]);
	}
}


export function isProtectedToken(tok: string): boolean {
	
	if (/^[\d.,%$€£-]+$/.test(tok)) return true;
	if (/^[a-f0-9]{6,}$/i.test(tok)) return true;
	
	if (/^0x[0-9a-f]+$/i.test(tok)) return true;
	if (/^--?[a-z][a-z0-9-]*$/i.test(tok)) return true;
	
	if (/^[A-Z]{2,}$/.test(tok)) return true;
	
	if (/[/\\@:~.#_-]/.test(tok) && /\.[a-z0-9]{1,6}$/i.test(tok)) return true;
	
	if (/^[a-z0-9]+([_-][a-z0-9]+)+$/i.test(tok)) return true;
	if (/^[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]+$/.test(tok)) return true;
	
	if (/\d/.test(tok) && /^[a-z0-9]+$/i.test(tok)) return true;
	return false;
}
