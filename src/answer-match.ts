import type { Question } from "./types.ts";

// Módulo puro (sem DOM / import.meta.env): roda no navegador e no Node para testes.

export type MatchResult = "correct" | "incorrect" | "uncertain";

/** Motivo de um "incorrect" determinístico, usado para escolher o feedback. */
export type MismatchReason = "empty" | "format" | "multiple" | "long" | "near";

export type MatchDetail = { result: MatchResult; reason?: MismatchReason };

const MAX_TOLERANCE_PERCENT = 10;
const MAX_ANSWER_CHARS = 150;

export function matchAnswer(question: Question, answer: string): MatchResult {
  return matchAnswerDetailed(question, answer).result;
}

export function matchAnswerDetailed(question: Question, answer: string): MatchDetail {
  if (!answer.trim()) return { result: "incorrect", reason: "empty" };
  switch (question.answerType) {
    case "year":
      return matchYear(question, answer);
    case "number":
      return matchNumber(question, answer);
    case "text":
      return matchText(question, answer);
    default:
      return { result: "incorrect" };
  }
}

/** Minúsculas, sem acentos, sem pontuação, espaços colapsados e sem artigo inicial (o/a/os/as/the). */
export function normalizeText(input: string): string {
  const s = input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return s.replace(/^(?:o|a|os|as|the)\s+(?=\S)/, "");
}

// ---------------------------------------------------------------------------
// Números
//
// Regras do parser (pt-BR primeiro, inglês tolerado):
// - Os dois separadores presentes: o último é o decimal ("1.234,56" e "1,234.56" = 1234,56).
// - Separador repetido é de milhar, com grupos de 3 dígitos ("1.234.567", "1,234,567").
// - Separador único seguido de exatamente 3 dígitos, com parte inteira de 1 a 3 dígitos
//   diferente de 0, é AMBÍGUO ("9,807" pode ser 9807 ou 9,807): `parseNumber` devolve a
//   leitura de milhar e `matchAnswer` aceita se qualquer uma das duas bater. Senão é decimal
//   ("1.5" = 1,5; "2,5" = 2,5; "0,125" = 0,125; "1234.567" = 1234,567).
// - Grupos de 3 dígitos separados por espaço são milhares ("1 234 567").
// - Sufixos: mil/k = 10³; mi/milhão/million = 10⁶; bi/bilhão/billion/bn = 10⁹; tri/trilhão = 10¹².
//   "m" e "b" sozinhos NÃO são multiplicadores (metros, bytes...).
// - Composição decrescente: "2 milhões e 300 mil" = 2.300.000; "2 mil e 500" = 2.500.
// - Sinal: "-3", "−3", "menos 3", "38,83 graus negativos", "196 abaixo de zero".
//   Notação científica simples: "1e6". Moedas, unidades e palavras ao redor são ignoradas.
// - Mais de um número na resposta ("200 ou 300", "100-200") => inválido (chute múltiplo).
//   Dígitos colados a letras ("km2", "co2") não contam como outro número.
// - Sem dígitos: aceita número por extenso simples ("mil", "um milhão", "meio milhão", "dez").
// ---------------------------------------------------------------------------

const MULTIPLIERS = new Map<string, number>(Object.entries({
  k: 1e3,
  mil: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  mi: 1e6,
  mln: 1e6,
  milhao: 1e6,
  milhoes: 1e6,
  million: 1e6,
  millions: 1e6,
  bi: 1e9,
  bn: 1e9,
  bilhao: 1e9,
  bilhoes: 1e9,
  billion: 1e9,
  billions: 1e9,
  tri: 1e12,
  trilhao: 1e12,
  trilhoes: 1e12,
  trillion: 1e12,
  trillions: 1e12,
}));

const WORD_NUMBERS = new Map<string, number>(Object.entries({
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  vinte: 20,
  cem: 100,
  meio: 0.5,
  meia: 0.5,
}));

const NUMBER_TOKEN = /(?<![\p{L}\d.,])(?:(-)\s?)?(\d{1,3}(?: \d{3})+(?![\d.,]*\d)|\d+(?:[.,]\d+)*)(?:e([+-]?\d{1,3})(?!\d))?/gu;
const MULTIPLIER_AFTER = /^\s*(\p{L}+)(?!\p{L})/u;
const COMPOSITE_JOIN = /^\s+(?:e\s+)?$/;

/** `alt`: segunda leitura de um separador ambíguo ("9,807" → 9807 e 9.807), ou null. */
type Reading = { value: number; alt: number | null };
type Quantity = Reading & { multiplier: number; start: number; end: number };
type ParseOutcome = Reading | { error: "none" | "multiple" | "invalid" };

const NEGATIVE_WORDS = /\b(?:negativ[oa]s?|abaixo de zero|negatives?|below zero)\b/;

function prepare(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[−‒–]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/\bmenos\s+(?=\d)/g, "-")
    .trim();
}

function validGroups(intPart: string, sep: string): boolean {
  const groups = intPart.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

function parseToken(raw: string): Reading | null {
  const token = raw.replace(/ /g, "");
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let normalized: string;
  let alternative: string | null = null;

  if (!hasDot && !hasComma) {
    normalized = token;
  } else if (hasDot && hasComma) {
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const parts = token.split(decimal);
    if (parts.length !== 2 || parts[1].includes(thousands) || !validGroups(parts[0], thousands)) return null;
    normalized = `${parts[0].split(thousands).join("")}.${parts[1]}`;
  } else {
    const sep = hasDot ? "." : ",";
    const parts = token.split(sep);
    if (parts.length > 2) {
      if (!validGroups(token, sep)) return null;
      normalized = parts.join("");
    } else {
      const [intPart, frac] = parts;
      const ambiguous = frac.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart);
      normalized = ambiguous ? intPart + frac : `${intPart}.${frac}`;
      if (ambiguous) alternative = `${intPart}.${frac}`;
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return { value, alt: alternative === null ? null : Number(alternative) };
}

function scanQuantities(s: string): Quantity[] | null {
  const found: Quantity[] = [];
  for (const m of s.matchAll(NUMBER_TOKEN)) {
    const mantissa = parseToken(m[2]);
    if (mantissa === null) return null;
    const scale = m[3] ? 10 ** Number(m[3]) : 1;
    let end = m.index + m[0].length;
    let multiplier = 1;
    const after = MULTIPLIER_AFTER.exec(s.slice(end));
    const afterMultiplier = after ? MULTIPLIERS.get(after[1]) : undefined;
    if (after && afterMultiplier !== undefined) {
      multiplier = afterMultiplier;
      end += after[0].length;
    }
    const factor = (m[1] ? -1 : 1) * scale * multiplier;
    found.push({
      value: mantissa.value * factor,
      alt: mantissa.alt === null ? null : mantissa.alt * factor,
      multiplier,
      start: m.index,
      end,
    });
  }
  return found;
}

function parseWords(s: string): ParseOutcome {
  const words = s.split(/[^\p{L}]+/u).filter(Boolean);
  const numeric = words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => WORD_NUMBERS.has(w) || (w.length >= 3 && MULTIPLIERS.has(w)));
  if (numeric.length === 0) return { error: "none" };
  const [first, second] = numeric;
  const firstValue = WORD_NUMBERS.get(first.w);
  if (numeric.length === 1) {
    return { value: firstValue ?? MULTIPLIERS.get(first.w)!, alt: null };
  }
  const secondMultiplier = MULTIPLIERS.get(second.w);
  if (numeric.length === 2 && second.i === first.i + 1 && firstValue !== undefined && secondMultiplier !== undefined) {
    return { value: firstValue * secondMultiplier, alt: null };
  }
  return { error: "multiple" };
}

function parseNumberDetailed(input: string): ParseOutcome {
  const s = prepare(input);
  if (!s) return { error: "none" };
  const quantities = scanQuantities(s);
  if (quantities === null) return { error: "invalid" };
  if (quantities.length === 0) {
    return /\d/.test(s) ? { error: "invalid" } : applyNegativeWords(s, parseWords(s));
  }

  let total = quantities[0].value;
  let lastMultiplier = quantities[0].multiplier;
  let index = 1;
  while (index < quantities.length && lastMultiplier > 1) {
    const prev = quantities[index - 1];
    const next = quantities[index];
    const joinsComposite =
      COMPOSITE_JOIN.test(s.slice(prev.end, next.start)) &&
      next.multiplier < lastMultiplier &&
      Math.abs(next.value) < lastMultiplier &&
      Math.sign(next.value) === Math.sign(total || 1);
    if (!joinsComposite) break;
    total += next.value;
    lastMultiplier = next.multiplier;
    index++;
  }
  if (index < quantities.length) return { error: "multiple" };
  return applyNegativeWords(s, { value: total, alt: index === 1 ? quantities[0].alt : null });
}

function applyNegativeWords(s: string, outcome: ParseOutcome): ParseOutcome {
  if (!("value" in outcome) || !NEGATIVE_WORDS.test(s) || outcome.value <= 0) return outcome;
  return { value: -outcome.value, alt: outcome.alt === null ? null : -Math.abs(outcome.alt) };
}

export function parseNumber(input: string): number | null {
  const outcome = parseNumberDetailed(input);
  return "value" in outcome ? outcome.value : null;
}

/** Resposta canônica gerada pela IA ("1500000", "2.5"); aceita também formatos de usuário. */
export function parseCanonicalNumber(input: string): number | null {
  const s = input.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return parseNumber(s);
}

function closeEnough(value: number, expected: number, tolerancePercent: number): boolean {
  const epsilon = 1e-9 * Math.max(1, Math.abs(expected));
  return Math.abs(value - expected) <= (Math.abs(expected) * tolerancePercent) / 100 + epsilon;
}

function clampTolerance(t: number): number {
  return Number.isFinite(t) ? Math.min(MAX_TOLERANCE_PERCENT, Math.max(0, t)) : 0;
}

function matchNumber(question: Question, answer: string): MatchDetail {
  const expected = parseCanonicalNumber(question.expectedAnswer);
  if (expected === null) return { result: "incorrect" };
  const outcome = parseNumberDetailed(answer);
  if (!("value" in outcome)) {
    return { result: "incorrect", reason: outcome.error === "multiple" ? "multiple" : "format" };
  }
  const readings = outcome.alt === null ? [outcome.value] : [outcome.value, outcome.alt];
  const tolerance = clampTolerance(question.tolerancePercent);
  if (readings.some((v) => closeEnough(v, expected, tolerance))) return { result: "correct" };
  const nearPercent = Math.max(2 * tolerance, 5);
  return readings.some((v) => closeEnough(v, expected, nearPercent))
    ? { result: "incorrect", reason: "near" }
    : { result: "incorrect" };
}

// ---------------------------------------------------------------------------
// Anos: exatos. Considera apenas números com a mesma quantidade de dígitos do ano
// esperado (4 na prática), então "22 de abril de 1500" funciona. Mais de um ano
// distinto ("1985 ou 1986") = chute múltiplo. "1.985" é lido como 1985.
// ---------------------------------------------------------------------------

function yearCandidates(answer: string): number[] {
  const merged = answer.replace(/(?<!\d)(\d)\.(\d{3})(?!\d)/g, "$1$2");
  return [...merged.matchAll(/\d+/g)].map((m) => m[0]).map((d) => Number(d));
}

function matchYear(question: Question, answer: string): MatchDetail {
  const expectedDigits = question.expectedAnswer.trim();
  if (!/^\d{1,4}$/.test(expectedDigits)) return { result: "incorrect" };
  const expected = Number(expectedDigits);
  const length = String(expected).length;
  const candidates = [...new Set(yearCandidates(answer).filter((n) => String(n).length === length))];
  if (candidates.length === 0) return { result: "incorrect", reason: "format" };
  if (candidates.length > 1) return { result: "incorrect", reason: "multiple" };
  const [year] = candidates;
  if (year === expected) return { result: "correct" };
  return Math.abs(year - expected) <= 2 ? { result: "incorrect", reason: "near" } : { result: "incorrect" };
}

// ---------------------------------------------------------------------------
// Texto: igualdade normalizada (também sem espaços) com a resposta ou alguma aceita.
// Erro de digitação é avaliado PALAVRA A PALAVRA (ignorando conectivos como de/da/do), com a
// mesma letra inicial e o mesmo número de palavras: distância ≤ 1 em palavras de referência
// com 7+ letras e ≤ 2 com 12+. Palavras curtas precisam ser exatas, porque nomes vizinhos
// costumam ser outra resposta válida (Manet/Monet, Gâmbia/Zâmbia, Claude Manet/Claude Monet).
// Vai direto para incorrect (sem gastar o juiz): lista de chutes separada por , ; / | "ou",
// uma única letra, só dígitos quando a resposta não tem dígitos, ou resposta longa demais.
// O resto é "uncertain" e vai para o juiz IA.
// ---------------------------------------------------------------------------

function compact(s: string): string {
  return s.replace(/ /g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
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

type Allowance = (typed: string, reference: string) => number;

/** Limite pelo tamanho da palavra de referência; a letra inicial tem de ser a mesma. */
const typoAllowance: Allowance = (typed, reference) => {
  if (!typed || typed[0] !== reference[0]) return 0;
  if (reference.length >= 12) return 2;
  if (reference.length >= 7) return 1;
  return 0;
};

/** Limite maior, usado só quando o juiz IA não pode decidir. */
const lenientTypoAllowance: Allowance = (typed, reference) => {
  if (!typed || typed[0] !== reference[0]) return 0;
  if (reference.length >= 15) return 3;
  if (reference.length >= 10) return 2;
  if (reference.length >= 7) return 1;
  return 0;
};

const CONNECTORS = new Set(["de", "da", "do", "dos", "das", "du", "di", "del", "della", "van", "von", "der", "den", "e", "y", "of", "the", "le", "la", "los", "las"]);

function significantWords(normalized: string): string[] {
  return normalized.split(" ").filter((w) => w && !CONNECTORS.has(w));
}

function withinTypos(typed: string, reference: string, allowance: Allowance): boolean {
  if (typed === reference) return true;
  const max = allowance(typed, reference);
  return max > 0 && levenshtein(typed, reference) <= max;
}

/** Mesmas palavras significativas, na mesma ordem, cada uma exata ou dentro do limite de erro. */
function typoMatch(answer: string, candidate: string, allowance: Allowance): boolean {
  const typed = significantWords(answer);
  const reference = significantWords(candidate);
  if (typed.length === 0 || typed.length !== reference.length) return false;
  return typed.every((word, i) => withinTypos(word, reference[i], allowance));
}

function textCandidates(question: Question): string[] {
  const all = [question.expectedAnswer, ...question.acceptedAnswers].map(normalizeText).filter(Boolean);
  return [...new Set(all)];
}

function isGuessList(raw: string): boolean {
  const parts = raw.split(/[,;/|\n]|\s(?:ou|or)\s/i).filter((p) => normalizeText(p));
  return parts.length >= 2;
}

function matchText(question: Question, raw: string): MatchDetail {
  const answer = normalizeText(raw);
  if (!answer) return { result: "incorrect", reason: "empty" };
  const candidates = textCandidates(question);
  const compactAnswer = compact(answer);

  for (const candidate of candidates) {
    if (candidate === answer || compact(candidate) === compactAnswer) return { result: "correct" };
  }
  for (const candidate of candidates) {
    if (typoMatch(answer, candidate, typoAllowance)) return { result: "correct" };
  }

  if (isGuessList(raw)) return { result: "incorrect", reason: "multiple" };
  if (compactAnswer.length <= 1) return { result: "incorrect", reason: "format" };
  if (/^\d+$/.test(compactAnswer) && !candidates.some((c) => /\d/.test(c))) {
    return { result: "incorrect", reason: "format" };
  }
  const maxWords = Math.max(1, ...candidates.map((c) => c.split(" ").length));
  const words = answer.split(" ").length;
  if (raw.length > MAX_ANSWER_CHARS || words > Math.max(2 * maxWords, maxWords + 4)) {
    return { result: "incorrect", reason: "long" };
  }
  return { result: "uncertain" };
}

/**
 * Decisão determinística para quando o juiz IA não pode decidir (falha, timeout, IA desligada).
 * Não pune por indisponibilidade quando há evidência razoável de acerto:
 * - erro de digitação palavra a palavra com limite maior (7+ letras → 1, 10+ → 2, 15+ → 3); ou
 * - a última palavra da resposta (4+ letras) é a última palavra de uma forma aceita
 *   ("William Gates" ~ "Bill Gates") e no máximo UMA outra palavra significativa não aparece
 *   nessa forma. Listas de chutes e nomes curtos vizinhos (Manet/Monet) continuam errados.
 */
export function matchTextLenient(question: Question, answer: string): boolean {
  const detail = matchAnswerDetailed(question, answer);
  if (detail.result !== "uncertain") return detail.result === "correct";
  if (question.answerType !== "text") return false;
  const normalized = normalizeText(answer);
  const candidates = textCandidates(question);
  if (candidates.some((c) => typoMatch(normalized, c, lenientTypoAllowance))) return true;

  const tokens = normalized.split(" ");
  const last = tokens[tokens.length - 1];
  if (last.length < 4) return false;
  return candidates.some((candidate) => {
    const parts = candidate.split(" ");
    const candidateLast = parts[parts.length - 1];
    if (candidateLast.length < 4 || !withinTypos(last, candidateLast, typoAllowance)) return false;
    const unexplained = tokens.filter((t) => t.length >= 4 && !parts.some((p) => withinTypos(t, p, typoAllowance)));
    return unexplained.length <= 1;
  });
}

// ---------------------------------------------------------------------------
// Auxiliares para validar perguntas geradas
// ---------------------------------------------------------------------------

/** true se `text` (pergunta ou dica) entrega a resposta esperada. */
export function mentionsAnswer(text: string, question: Pick<Question, "answerType" | "expectedAnswer" | "acceptedAnswers">): boolean {
  if (question.answerType === "year") {
    const expected = Number(question.expectedAnswer.trim());
    return yearCandidates(text).includes(expected);
  }
  if (question.answerType === "number") {
    const expected = parseCanonicalNumber(question.expectedAnswer);
    if (expected === null) return false;
    const found = scanQuantities(prepare(text)) ?? [];
    return found.some((q) => closeEnough(q.value, expected, 0) || (q.alt !== null && closeEnough(q.alt, expected, 0)));
  }
  const haystack = ` ${normalizeText(text)} `;
  const original = stripAccents(text);
  return [question.expectedAnswer, ...question.acceptedAnswers].some((raw) => {
    const candidate = normalizeText(raw);
    if (!candidate) return false;
    if (compact(candidate).length >= 4) return haystack.includes(` ${candidate} `);
    // Curta (símbolo, sigla): palavra inteira, respeitando maiúsculas ("Fe" ≠ "fe"; "O" ≠ artigo "o").
    const word = stripAccents(raw.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return word.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(original);
  });
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "");
}

/**
 * Avalia uma expressão aritmética simples (números, + - * / ^, parênteses).
 * Usado para conferir as contas geradas pela IA. Retorna null se inválida.
 */
export function evaluateArithmetic(expression: string): number | null {
  const src = expression
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/(?<=[\d)])\s*[xX]\s*(?=[\d(])/g, "*")
    .replace(/\*\*/g, "^")
    .replace(/\s+/g, "");
  if (!src || src.length > 200 || !/^[\d.+\-*/^()]+$/.test(src)) return null;
  let pos = 0;

  const peek = () => src[pos];
  const parseExpr = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = src[pos++];
      const rhs = parseUnary();
      if (op === "/" && rhs === 0) throw new Error("division by zero");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  };
  const parseUnary = (): number => {
    if (peek() === "-") {
      pos++;
      return -parseUnary();
    }
    if (peek() === "+") {
      pos++;
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek() === "^") {
      pos++;
      return base ** parseUnary();
    }
    return base;
  };
  const parsePrimary = (): number => {
    if (peek() === "(") {
      pos++;
      const value = parseExpr();
      if (src[pos++] !== ")") throw new Error("missing )");
      return value;
    }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(pos));
    if (!m) throw new Error("number expected");
    pos += m[0].length;
    return Number(m[0]);
  };

  try {
    const value = parseExpr();
    return pos === src.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
