// Fuzzy command-verb normalizer (backend mirror of the app's phoneticDictionary).
//
// Speech-to-text mishears the four command verbs that open a Lucas command
// ("vendí" → "veinte", "gasté" → "hasta", "fié" → "fe"/"fiel"). Rather than keep
// a hand-maintained list of every misspelling, we FUZZY-MATCH the command-verb
// slot against the four canonical verbs with Levenshtein distance.
//
// Safety rules:
//   1. Only the verb slot is evaluated — the first word after the optional
//      "lucas" (plus its concatenation with the next word for tiny fragments,
//      e.g. "ven di" → "vendi"). Nouns/numbers elsewhere are never rewritten.
//   2. A number-looking candidate ("veinte", "diez", "20") is only treated as a
//      misheard verb when ANOTHER number remains to be the amount.
//   3. A leading "veinte"/"20" is forced to "vendí" (STT confuses them and the
//      edit distance is too large to catch) — still subject to rule 2.
//   4. "cobr…" (cobrar = income) is never fuzzed; it sits 2 edits from "compre".
//
// Input is the already-normalized text (lowercased, accent-stripped) produced by
// voice-parser's normalize(). Canonical forms align with the detectType regexes
// (fi[oe] / vend[io] / gast[eo] / compr[eo]).

const CANON_VERBS = ['fie', 'vendi', 'gaste', 'compre'] as const;

const WAKE_TOKEN_RE = /^lu[ckg]a[sz]?$/;
const COBRAR_RE = /^cobr/;
const NUMBER_RE =
  /^(?:\d+(?:[.,]\d+)?|dieci\w+|veinti\w+|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil)$/;

function isNumberish(tok?: string): boolean {
  return !!tok && NUMBER_RE.test(tok);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

type VerbMatch = { canon: string; dist: number };

function matchVerb(candidate: string): VerbMatch | null {
  if (!candidate) return null;
  let best: VerbMatch | null = null;
  for (const v of CANON_VERBS) {
    const dist = levenshtein(candidate, v);
    if (!best || dist < best.dist) best = { canon: v, dist };
  }
  if (!best) return null;
  const ratio = 1 - best.dist / Math.max(candidate.length, best.canon.length);
  return best.dist <= 2 && ratio >= 0.5 ? best : null;
}

/**
 * Rewrites a misheard command verb at the start of a normalized phrase to its
 * canonical form, leaving everything else untouched. Returns the phrase unchanged
 * when the verb slot is already correct or no safe match is found.
 */
export function correctCommandVerb(normalizedText: string): string {
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  if (!tokens.length) return normalizedText;

  let i = 0;
  if (WAKE_TOKEN_RE.test(tokens[i])) i++;
  if (i >= tokens.length) return tokens.join(' ');

  const slot = tokens[i];
  const otherNumberAfter = tokens.slice(i + 1).some(isNumberish);

  if ((slot === 'veinte' || slot === '20') && otherNumberAfter) {
    tokens[i] = 'vendi';
    return tokens.join(' ');
  }

  if (COBRAR_RE.test(slot)) return tokens.join(' ');

  const single = matchVerb(slot);
  const joined = i + 1 < tokens.length ? matchVerb(slot + tokens[i + 1]) : null;

  if (joined && (!single || joined.dist < single.dist)) {
    tokens.splice(i, 2, joined.canon);
    return tokens.join(' ');
  }
  if (single) {
    if (!isNumberish(slot) || otherNumberAfter) tokens[i] = single.canon;
  }
  return tokens.join(' ');
}
