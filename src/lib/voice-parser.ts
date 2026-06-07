import { correctCommandVerb } from './phonetic-verb';

export type ParsedIntent = {
  type: 'venta' | 'gasto' | 'casa' | 'mercaderia' | 'gasto_casa' | 'fiado' | 'unknown';
  amount: number;
  item: string | null;
  person: string | null;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
};

// ─── Text normalization ───────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[¡!¿?.,:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Written numbers (Spanish) ────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
  doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900, mil: 1000,
};

const WORD_NUM_KEYS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');

// ─── Amount + item extraction ─────────────────────────────────────────────────

type AmountResult = { amount: number | null; item: string | null };

function parseAmountAndItem(text: string): AmountResult {
  // "2 pollos a 25" or "dos pollos a 25" → multiply, extract item in between
  const numMultRe = /(\d+)\s+([a-z]+(?:\s+[a-z]+)?)\s+a\s+(\d+(?:[.,]\d+)?)/;
  const numMult = text.match(numMultRe);
  if (numMult) {
    const qty = parseInt(numMult[1], 10);
    const price = parseFloat(numMult[3].replace(',', '.'));
    return { amount: qty * price, item: numMult[2] };
  }

  const wordMultRe = new RegExp(`(${WORD_NUM_KEYS})\\s+([a-z]+(?:\\s+[a-z]+)?)\\s+a\\s+(\\d+(?:[.,]\\d+)?)`);
  const wordMult = text.match(wordMultRe);
  if (wordMult) {
    const qty = WORD_NUMBERS[wordMult[1]] ?? 1;
    const price = parseFloat(wordMult[3].replace(',', '.'));
    return { amount: qty * price, item: wordMult[2] };
  }

  // Plain digit amount
  const digitRe = /(\d+(?:[.,]\d+)?)/;
  const digit = text.match(digitRe);
  if (digit) return { amount: parseFloat(digit[1].replace(',', '.')), item: null };

  // Written number fallback
  const wordRe = new RegExp(`\\b(${WORD_NUM_KEYS})\\b`);
  const word = text.match(wordRe);
  if (word) return { amount: WORD_NUMBERS[word[1]] ?? null, item: null };

  return { amount: null, item: null };
}

// ─── Type detection ───────────────────────────────────────────────────────────

type EntryType = ParsedIntent['type'];

// Order matters: most specific first to avoid misclassification
const TYPE_RULES: Array<{ type: EntryType; triggers: RegExp[] }> = [
  {
    type: 'fiado',
    triggers: [
      /\bfi[oe]\b/, /\bfiad[oa]\b/, /\bcredito\b/, /\bquedo.{0,10}deber\b/,
      /\bme debe\b/, /\bal fi[eo]\b/, /\bdejo.{0,10}deber\b/,
    ],
  },
  {
    type: 'gasto_casa',
    triggers: [
      /gast[eo].{0,25}(casa|hogar|personal|familiar)/,
      /\b(luz|agua|internet|alquiler|arriendo|electricidad|gas del hogar)\b/,
      /pag[uo].{0,20}(luz|agua|internet|alquiler|arriendo)/,
    ],
  },
  {
    type: 'casa',
    triggers: [
      /saqu[eo].{0,20}(para la |para mi )?(casa|familia|hogar)/,
      /\bretir[eo]\b/, /\bretiro\b/,
      /para (la |mi )?(casa|familia|hogar)/,
      /llev[eo].{0,15}(casa|familia)/,
    ],
  },
  {
    type: 'mercaderia',
    triggers: [
      /\bmercader[ia]a?\b/, /\bmercancia\b/, /\bstock\b/, /\binventario\b/,
      /compr[eo].{0,20}(para vender|restock|reponer|revender)/,
    ],
  },
  {
    type: 'venta',
    triggers: [
      /\bvend[io]\b/, /\bvend[io]mos\b/, /\bcobr[eo]\b/, /\bme pagaron\b/,
      /\bingres[oo]\b/, /\brecibi[oo]\b/, /\bventa\b/, /\bme pago\b/,
      /\bme dieron\b/,
    ],
  },
  {
    type: 'gasto',
    triggers: [
      /\bgast[eo]\b/, /\bpagu[eo]\b/, /\bpago\b/, /\bcompr[eo]\b/,
      /\bgasto\b/, /\binverti[oo]\b/, /\bdesembolso\b/,
    ],
  },
];

function detectType(text: string): { type: EntryType; confidence: 'high' | 'medium' | 'low' } {
  for (const { type, triggers } of TYPE_RULES) {
    const hits = triggers.filter((r) => r.test(text)).length;
    if (hits >= 2) return { type, confidence: 'high' };
    if (hits === 1) return { type, confidence: 'medium' };
  }
  return { type: 'unknown', confidence: 'low' };
}

// ─── Person extraction (fiados only) ─────────────────────────────────────────

function extractPerson(originalText: string): string | null {
  // "fié a Juan", "le fié a María López", "crédito a Pedro"
  const named = originalText.match(
    /(?:fi[oó]|fiad[oa]|credito|quedo a deber|me debe)(?:\s+\w+)?\s+a\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/i,
  );
  if (named) return named[1];

  // Generic "a [CapitalizedName]"
  const generic = originalText.match(/\ba\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/);
  return generic ? generic[1] : null;
}

// ─── Item extraction from context ────────────────────────────────────────────

const NOISE_WORDS = new Set([
  'de', 'la', 'el', 'en', 'a', 'para', 'por', 'un', 'una', 'los', 'las', 'le',
  'soles', 'pesos', 'dolares', 'bolivares', 'colones', 'hoy', 'ayer', 'que',
  'me', 'se', 'lo', 'y', 'o', 'con', 'del', 'al',
]);

function extractItemFromContext(text: string): string | null {
  const patterns = [
    // "vendí/cobré [item] a/por amount"
    /(?:vendi|cobre|recibi|ingreso)\s+(.+?)\s+(?:a|por)\s+\d/,
    // "gasté/compré/pagué en [item]"
    /(?:en|de|por)\s+([a-z]+(?:\s+[a-z]+){0,3})(?:\s+\d|\s*$)/,
    // "compré [item] amount"
    /(?:compre|gaste|pague)\s+(.+?)(?:\s+\d|\s*$)/,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const cleaned = m[1]
      .split(' ')
      .filter((w) => !NOISE_WORDS.has(w) && !/^\d/.test(w) && w.length > 1)
      .join(' ')
      .trim();
    if (cleaned.length > 1) return cleaned;
  }
  return null;
}

// ─── Category detection ───────────────────────────────────────────────────────

const CATEGORY_MAP: Array<{ id: string; keywords: string[] }> = [
  { id: 'transporte', keywords: ['taxi', 'bus', 'colectivo', 'moto', 'gasolina', 'combustible', 'uber', 'transporte', 'pasaje', 'micro'] },
  { id: 'comida',     keywords: ['comida', 'almuerzo', 'desayuno', 'cena', 'restaurante', 'alimento', 'bebida', 'pollo', 'carne', 'pan'] },
  { id: 'salud',      keywords: ['medico', 'medicina', 'farmacia', 'salud', 'doctor', 'clinica', 'hospital', 'pastilla'] },
  { id: 'servicios',  keywords: ['agua', 'luz', 'internet', 'telefono', 'alquiler', 'arriendo', 'electricidad', 'gas'] },
  { id: 'educacion',  keywords: ['colegio', 'universidad', 'curso', 'libros', 'educacion', 'estudio', 'escuela'] },
];

function detectCategory(text: string, type: EntryType): string | null {
  if (type !== 'gasto' && type !== 'gasto_casa') return null;
  for (const { id, keywords } of CATEGORY_MAP) {
    if (keywords.some((kw) => text.includes(kw))) return id;
  }
  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function parseVoiceCommand(rawText: string): ParsedIntent {
  // Fuzzy-correct a misheard command verb at the start before detection, so
  // "veinte 20 soles" / "hasta 5 en luz" classify correctly. Person extraction
  // below still uses rawText, so names keep their original casing/accents.
  const text = correctCommandVerb(normalize(rawText));

  const { amount, item: multiItem } = parseAmountAndItem(text);
  const { type, confidence } = detectType(text);
  const person = type === 'fiado' ? extractPerson(rawText) : null;
  const item = multiItem ?? extractItemFromContext(text);
  const category = detectCategory(text, type);

  return {
    type,
    amount: amount ?? 0,
    item,
    person,
    category,
    confidence: amount === null || type === 'unknown' ? 'low' : confidence,
  };
}
