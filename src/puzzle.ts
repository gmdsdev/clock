import type { GridCell, PuzzleAnswer, PuzzleKind, PuzzleView, Shape } from "./types.ts";

// Captchas locais, gerados e conferidos sem rede. Módulo puro (roda no Node para testes).
// O objeto `Puzzle` inteiro é serializável em JSON (persistido no localStorage).

export type PuzzleSolution =
  | { kind: "distorted-text"; text: string }
  /** Índices (0..8) das células corretas, em ordem crescente. */
  | { kind: "select-grid"; correct: number[] }
  /** Índices em `view.symbols`, na ordem exata. */
  | { kind: "memory-sequence"; sequence: number[] }
  /** Ordem esperada dos cliques (1..N) e limite de tempo. */
  | { kind: "click-order"; order: number[]; timeLimitMs: number };

export type Puzzle = { view: PuzzleView; solution: PuzzleSolution };

type Random = () => number;

const KINDS: PuzzleKind[] = ["distorted-text", "select-grid", "memory-sequence", "click-order"];

export function createPuzzle(options: { exclude?: PuzzleKind[]; random?: () => number } = {}): Puzzle {
  const random = options.random ?? Math.random;
  const allowed = KINDS.filter((k) => !options.exclude?.includes(k));
  const kind = pick(allowed.length ? allowed : KINDS, random);
  const id = newId(random);
  switch (kind) {
    case "distorted-text":
      return createDistortedText(id, random);
    case "select-grid":
      return createSelectGrid(id, random);
    case "memory-sequence":
      return createMemorySequence(id, random);
    case "click-order":
      return createClickOrder(id, random);
  }
}

/** Nunca lança: puzzle ou resposta malformados (ex.: localStorage corrompido) = false. */
export function checkPuzzle(puzzle: Puzzle, answer: PuzzleAnswer): boolean {
  try {
    const { view, solution } = puzzle;
    if (!view || !solution || view.kind !== solution.kind || answer?.kind !== solution.kind) return false;
    switch (solution.kind) {
      case "distorted-text":
        return (
          answer.kind === "distorted-text" &&
          typeof answer.text === "string" &&
          normalizeCaptchaText(answer.text) === solution.text
        );
      case "select-grid": {
        if (answer.kind !== "select-grid" || !isIntArray(answer.selected)) return false;
        const selected = new Set(answer.selected);
        return selected.size === solution.correct.length && solution.correct.every((i) => selected.has(i));
      }
      case "memory-sequence":
        return answer.kind === "memory-sequence" && sameArray(answer.sequence, solution.sequence);
      case "click-order":
        return (
          answer.kind === "click-order" &&
          sameArray(answer.clicks, solution.order) &&
          typeof answer.elapsedMs === "number" &&
          Number.isFinite(answer.elapsedMs) &&
          answer.elapsedMs >= 0 &&
          answer.elapsedMs <= solution.timeLimitMs + CLICK_GRACE_MS
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Texto distorcido
// Alfabeto sem confundíveis: fora 0/O/Q, 1/I/L, 5/S, 2/Z, 8/B, 6/9/G e V (vs. U).
// D fica porque não há 0 nem O. Sem caracteres iguais vizinhos e sem palavrões óbvios.
// ---------------------------------------------------------------------------

const CAPTCHA_ALPHABET = [..."ACDEFHJKMNPRTUWXY347"];
const CAPTCHA_LENGTH = 6;
const CAPTCHA_BLOCKLIST = ["CU", "PUT", "FUC", "FDP", "KKK", "XXX", "CAC", "MERD"];
/** Só usado se o gerador aleatório estiver quebrado (ex.: sempre o mesmo valor). */
const CAPTCHA_SAFE_TEXT = "HKMRTX";
/** Limite para laços de "sorteia de novo": nada pode travar o alarme. */
const MAX_ATTEMPTS = 50;

function normalizeCaptchaText(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

function createDistortedText(id: string, random: Random): Puzzle {
  const generate = () => {
    let out = "";
    while (out.length < CAPTCHA_LENGTH) {
      let index = randomInt(0, CAPTCHA_ALPHABET.length - 1, random);
      if (CAPTCHA_ALPHABET[index] === out.at(-1)) index = (index + 1) % CAPTCHA_ALPHABET.length;
      out += CAPTCHA_ALPHABET[index];
    }
    return out;
  };
  const isClean = (t: string) => !CAPTCHA_BLOCKLIST.some((bad) => t.includes(bad));
  let text = generate();
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !isClean(text); attempt++) text = generate();
  if (!isClean(text)) text = CAPTCHA_SAFE_TEXT;
  return {
    view: {
      id,
      kind: "distorted-text",
      instruction: "Digite os caracteres da imagem",
      text,
      seed: randomInt(1, 2_147_483_646, random),
    },
    solution: { kind: "distorted-text", text },
  };
}

// ---------------------------------------------------------------------------
// Grade "selecione todos"
// ---------------------------------------------------------------------------

const GRID_SIZE = 9;
const MIN_CORRECT = 2;
const MAX_CORRECT = 5;
const GLYPH_MAX_ROTATION = 12;
const SHAPE_MAX_ROTATION = 35;

type GridRule = {
  instruction: string;
  correct: readonly CellSpec[];
  /** Função quando os distratores dependem do sorteio (formas confundíveis). */
  incorrect: readonly CellSpec[] | ((random: Random) => CellSpec[]);
  /** Células podem se repetir (formas); glifos são sempre distintos. */
  repeat: boolean;
};

type CellSpec = { glyph: string; shape: Shape | null };

const NUMBERS = Array.from({ length: 48 }, (_, i) => i + 2); // 2..49: sem 0 (par?) nem 1 (primo?)
const isPrime = (n: number) => n >= 2 && Array.from({ length: n - 2 }, (_, i) => i + 2).every((d) => n % d !== 0);
const VOWELS = ["A", "E", "I", "O", "U"];
const CONSONANTS = ["B", "C", "D", "F", "G", "H", "J", "L", "M", "N", "P", "R", "S", "T", "V", "X", "Z"];

const ANIMALS = ["🐶", "🐱", "🐭", "🐰", "🦊", "🐻", "🐼", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🦆", "🦉", "🐴", "🐝", "🐢", "🐍", "🐙", "🦀", "🐬", "🐳", "🐟", "🐘", "🦒"];
const FRUITS = ["🍎", "🍌", "🍇", "🍓", "🍉", "🍍", "🍒", "🍑", "🍐", "🍋", "🥝", "🥥"];
const OTHER_FOODS = ["🍕", "🍔", "🍟", "🍞", "🧀", "🥚", "🍩", "🍪", "🥕", "🥦", "🍫", "🍦"];
const OBJECTS = ["🚗", "🚲", "⚽", "🎸", "📱", "💡", "🔑", "⏰", "🎈", "📚", "🔨", "🎧", "🧦", "🏠", "⌚", "🎁"];

const SHAPE_NAMES: Record<Shape, string> = {
  circle: "todos os círculos",
  square: "todos os quadrados",
  triangle: "todos os triângulos",
  diamond: "todos os losangos",
  star: "todas as estrelas",
  hexagon: "todos os hexágonos",
};
/** Pares que podem se confundir quando girados ou pequenos nunca aparecem na mesma grade. */
const CONFUSABLE_PAIRS: [Shape, Shape][] = [
  ["square", "diamond"],
  ["circle", "hexagon"],
];
const SHAPES = Object.keys(SHAPE_NAMES) as Shape[];

const glyphs = (list: readonly (string | number)[]): CellSpec[] => list.map((g) => ({ glyph: String(g), shape: null }));

function numberRule(instruction: string, match: (n: number) => boolean): GridRule {
  return {
    instruction,
    correct: glyphs(NUMBERS.filter(match)),
    incorrect: glyphs(NUMBERS.filter((n) => !match(n))),
    repeat: false,
  };
}

function shapeRule(target: Shape): GridRule {
  return {
    instruction: `Selecione ${SHAPE_NAMES[target]}`,
    correct: [{ glyph: "", shape: target }],
    incorrect: (random) => {
      const excluded = new Set<Shape>([target]);
      for (const [a, b] of CONFUSABLE_PAIRS) {
        if (a === target) excluded.add(b);
        else if (b === target) excluded.add(a);
        else excluded.add(random() < 0.5 ? a : b);
      }
      return SHAPES.filter((s) => !excluded.has(s)).map((s) => ({ glyph: "", shape: s }));
    },
    repeat: true,
  };
}

const GRID_FAMILIES: (() => GridRule[])[] = [
  () => [
    numberRule("Selecione todos os números pares", (n) => n % 2 === 0),
    numberRule("Selecione todos os números ímpares", (n) => n % 2 === 1),
    numberRule("Selecione todos os números primos", isPrime),
    numberRule("Selecione todos os múltiplos de 3", (n) => n % 3 === 0),
  ],
  () => [
    { instruction: "Selecione todas as vogais", correct: glyphs(VOWELS), incorrect: glyphs(CONSONANTS), repeat: false },
    { instruction: "Selecione todas as consoantes", correct: glyphs(CONSONANTS), incorrect: glyphs(VOWELS), repeat: false },
  ],
  () => SHAPES.map(shapeRule),
  () => [
    {
      instruction: "Selecione todos os animais",
      correct: glyphs(ANIMALS),
      incorrect: glyphs([...FRUITS, ...OTHER_FOODS, ...OBJECTS]),
      repeat: false,
    },
    {
      instruction: "Selecione todas as frutas",
      correct: glyphs(FRUITS),
      incorrect: glyphs([...OTHER_FOODS, ...OBJECTS, ...ANIMALS]),
      repeat: false,
    },
  ],
];

function createSelectGrid(id: string, random: Random): Puzzle {
  const rule = pick(pick(GRID_FAMILIES, random)(), random);
  const incorrect = typeof rule.incorrect === "function" ? rule.incorrect(random) : rule.incorrect;
  const minCorrect = Math.max(MIN_CORRECT, rule.repeat ? 0 : GRID_SIZE - incorrect.length);
  const maxCorrect = Math.min(MAX_CORRECT, rule.repeat ? MAX_CORRECT : rule.correct.length, GRID_SIZE - 2);

  const banned = random() < 0.5 ? "6" : "9";
  const allowed = (list: readonly CellSpec[]) => list.filter((c) => c.glyph !== banned);
  const k = randomInt(minCorrect, maxCorrect, random);
  const correctSpecs = rule.repeat ? repeatPick(rule.correct, k, random) : sample(allowed(rule.correct), k, random);
  const wrongSpecs = rule.repeat
    ? repeatPick(incorrect, GRID_SIZE - k, random)
    : sample(allowed(incorrect), GRID_SIZE - k, random);
  const specs = shuffle(
    [...correctSpecs.map((spec) => ({ spec, correct: true })), ...wrongSpecs.map((spec) => ({ spec, correct: false }))],
    random,
  );

  const cells: GridCell[] = specs.map(({ spec }) => {
    const max = spec.shape && !spec.glyph ? SHAPE_MAX_ROTATION : GLYPH_MAX_ROTATION;
    return { glyph: spec.glyph, shape: spec.shape, rotation: randomInt(-max, max, random) };
  });
  const correct = specs.flatMap((s, i) => (s.correct ? [i] : []));
  return {
    view: { id, kind: "select-grid", instruction: rule.instruction, cells },
    solution: { kind: "select-grid", correct },
  };
}

// ---------------------------------------------------------------------------
// Sequência de memória
// ---------------------------------------------------------------------------

const MEMORY_SYMBOLS = ["▲", "●", "■", "★", "◆", "✚"];
const MEMORY_LENGTH = 6;
const MEMORY_STEP_MS = 700;

function createMemorySequence(id: string, random: Random): Puzzle {
  const symbols = shuffle(MEMORY_SYMBOLS, random);
  const sequence: number[] = [];
  while (sequence.length < MEMORY_LENGTH) {
    let n = randomInt(0, symbols.length - 1, random);
    const len = sequence.length;
    if (len >= 2 && sequence[len - 1] === n && sequence[len - 2] === n) n = (n + 1) % symbols.length;
    sequence.push(n);
  }
  return {
    view: {
      id,
      kind: "memory-sequence",
      instruction: "Memorize a sequência e repita na mesma ordem",
      symbols,
      sequence: [...sequence],
      stepMs: MEMORY_STEP_MS,
    },
    solution: { kind: "memory-sequence", sequence },
  };
}

// ---------------------------------------------------------------------------
// Clique em ordem
// ---------------------------------------------------------------------------

const CLICK_COUNT = 12;
const CLICK_TIME_LIMIT_MS = 25_000;
const CLICK_GRACE_MS = 500;

function createClickOrder(id: string, random: Random): Puzzle {
  const order = Array.from({ length: CLICK_COUNT }, (_, i) => i + 1);
  const numbers = shuffle(order, random);
  // Troca cada número que caiu na própria posição com o vizinho: a grade nunca fica "quase em ordem".
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) continue;
    const j = (i + 1) % numbers.length;
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return {
    view: {
      id,
      kind: "click-order",
      instruction: `Clique nos números de 1 a ${CLICK_COUNT}, em ordem, em até ${CLICK_TIME_LIMIT_MS / 1000} segundos`,
      numbers,
      timeLimitMs: CLICK_TIME_LIMIT_MS,
    },
    solution: { kind: "click-order", order, timeLimitMs: CLICK_TIME_LIMIT_MS },
  };
}

// ---------------------------------------------------------------------------
// Frase final
// ---------------------------------------------------------------------------

export const PHRASE_HINT = "Digite a frase exatamente como está. Acentos são opcionais.";

const PHRASES = [
  "Estou acordado e não vou voltar a dormir",
  "Prometo que vou levantar da cama agora mesmo",
  "Eu juro que este alarme é mais forte do que eu",
  "Hoje eu acordo cedo e nunca mais aperto a soneca",
  "Meu travesseiro não manda em mim e eu vou levantar",
  "Acordar cedo foi uma escolha minha e eu aceito sofrer",
  "Cinco minutinhos a mais é uma mentira que não conto mais",
  "Abro os olhos e coloco os dois pés no chão gelado agora",
  "Nenhum despertador me humilhou tanto quanto este aqui",
];

export function pickPhrase(random: () => number = Math.random): string {
  return pick(PHRASES, random);
}

/** Ignora maiúsculas, acentos, espaços extras e pontuação final; as palavras precisam ser exatas e na ordem. */
export function checkPhrase(expected: string, typed: string): boolean {
  const target = normalizePhrase(expected);
  return target.length > 0 && normalizePhrase(typed) === target;
}

function normalizePhrase(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.!?…;,]+$/u, "");
}

// ---------------------------------------------------------------------------
// Utilitários (aleatoriedade injetável para testes)
// ---------------------------------------------------------------------------

function newId(random: Random): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const chunk = () => Math.floor(random() * 0x100000000).toString(36);
  return `pz-${Date.now().toString(36)}-${chunk()}${chunk()}`;
}

function randomInt(min: number, max: number, random: Random): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i, random);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sample<T>(items: readonly T[], count: number, random: Random): T[] {
  return shuffle(items, random).slice(0, count);
}

function repeatPick<T>(items: readonly T[], count: number, random: Random): T[] {
  return Array.from({ length: count }, () => pick(items, random));
}

function isIntArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isInteger(v));
}

function sameArray(a: unknown, b: readonly number[]): boolean {
  return isIntArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}
