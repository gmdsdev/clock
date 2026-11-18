import type {
  ChallengeView,
  PhraseView,
  PuzzleAnswer,
  PuzzleKind,
  PuzzleView,
  Question,
  QuestionSeed,
  Stage,
  StepsView,
  UI,
  Verdict,
} from "./types.ts";
import type { KeyValueStorage } from "./storage.ts";
import { normalizeText, parseCanonicalNumber } from "./answer-match.ts";

export const CAPTCHAS_REQUIRED = 3;
export const REQUIRED_CORRECT = 10;
export const MAX_ATTEMPTS = 3;
export const HISTORY_LIMIT = 30;
export const SESSION_STORAGE_KEY = "clock.challenge.v2";
export const LEGACY_SESSION_STORAGE_KEY = "clock.challenge.v1";
export const VICTORY_CLOSE_DELAY_MS = 3000;

const MAX_REPEAT_RETRIES = 2;
const LOADING_MESSAGE = "Gerando pergunta…";
const GENERATION_ERROR = "Não consegui gerar a pergunta. Tentando de novo…";
const CHECK_ERROR = "Não consegui conferir sua resposta. Envie de novo.";
const RESUMED_MESSAGE = "Recarregar a página não desliga o alarme.";
const PENDING_MESSAGE = "Conferindo a resposta enviada antes de recarregar…";
const CAPTCHA_CORRECT = "Captcha certo!";
const CAPTCHAS_DONE = "Captchas concluídos! Agora, as perguntas.";
const CAPTCHA_WRONG = "Errou o captcha. Toma outro.";
const PHRASE_NEXT = "Agora, a frase final.";
const PHRASE_CORRECT = "Frase certa!";
const PHRASE_WRONG = "Frase errada. Digite exatamente como está.";
const FALLBACK_PHRASE = "Eu estou acordado e vou levantar da cama agora";

const PUZZLE_KINDS: readonly PuzzleKind[] = ["distorted-text", "select-grid", "memory-sequence", "click-order"];
const STAGES: readonly Stage[] = ["captcha", "questions", "phrase"];

/** Mesmo formato do `Puzzle` de puzzle.ts (estrutural, para este módulo só importar tipos). */
export type ChallengePuzzle = { view: PuzzleView; solution: unknown };

const UI_METHODS = [
  "openChallenge",
  "closeChallenge",
  "setAlarmsLocked",
  "showLoading",
  "setSteps",
  "showPuzzle",
  "showQuestion",
  "showPhrase",
  "setSubmitting",
  "showFeedback",
  "showVictory",
] as const;

export type ChallengeUI = Pick<UI, (typeof UI_METHODS)[number]>;

export type ChallengeSound = {
  start(options: { startedAt: number; escalations: number }): void;
  stop(): void;
  escalate(): void;
};

export type ChallengeSession = {
  alarmIds: string[];
  startedAt: number;
  /** Total de erros na sessão (mantém a intensidade do som após recarregar). */
  misses: number;
  stage: Stage;
  captchasDone: number;
  /** Captcha atual (etapa "captcha"). */
  puzzle: ChallengePuzzle | null;
  correct: number;
  /** 1..MAX_ATTEMPTS */
  attempt: number;
  current: Question | null;
  /** Resposta enviada cuja conferência ainda não terminou (recarregar não a descarta). */
  pendingAnswer: string | null;
  history: QuestionSeed[];
  /** Frase final (etapa "phrase"). */
  phrase: string | null;
};

export type ChallengePhase = "idle" | "puzzle" | "loading" | "answering" | "submitting" | "phrase";

export type ChallengeDeps = {
  ui: ChallengeUI;
  sound: ChallengeSound;
  generateQuestion: (previous: QuestionSeed[]) => Promise<Question>;
  checkAnswer: (question: Question, answer: string) => Promise<Verdict>;
  createPuzzle: (options?: { exclude?: PuzzleKind[] }) => ChallengePuzzle;
  checkPuzzle: (puzzle: ChallengePuzzle, answer: PuzzleAnswer) => boolean;
  pickPhrase: () => string;
  checkPhrase: (expected: string, typed: string) => boolean;
  phraseHint: string;
  storage?: KeyValueStorage | null;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Chamado ao começar (true) e ao terminar (false) uma sessão de toque. */
  onActiveChange?: (active: boolean) => void;
  /** Pré-carrega a próxima pergunta (inclusive durante os captchas). Padrão: true. */
  prefetch?: boolean;
  retryDelayMs?: (failures: number) => number;
};

export type Challenge = {
  isActive(): boolean;
  /** Abre uma sessão. Se já houver uma, só incorpora os alarmes e retorna false. */
  start(alarmIds: readonly string[]): boolean;
  /** Retoma a sessão persistida (após recarregar). Retorna true se havia uma. */
  resume(): boolean;
  /** Resposta das perguntas ou da frase final, conforme a etapa. */
  submit(answer: string): Promise<void>;
  /** `puzzleId` = id do captcha respondido; se não for o atual, a resposta é descartada. */
  submitPuzzle(puzzleId: string, answer: PuzzleAnswer): void;
  snapshot(): { phase: ChallengePhase; session: ChallengeSession | null };
};

// --- Persistência (ofuscação leve, não é segurança) -----------------------

const OBFUSCATION_KEY = "acorda-ja";

function xorBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length);
  }
  return out;
}

/** Ofusca qualquer valor JSON (também usado nos testes para simular sessões v1). */
export function encodePayload(value: unknown): string {
  const bytes = xorBytes(new TextEncoder().encode(JSON.stringify(value)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const encodeSession = (session: ChallengeSession): string => encodePayload(session);

export function decodeSession(raw: string): ChallengeSession | null {
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return parseSession(JSON.parse(new TextDecoder().decode(xorBytes(bytes))));
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isStage = (value: unknown): value is Stage => STAGES.includes(value as Stage);
const isPuzzleKind = (value: unknown): value is PuzzleKind => PUZZLE_KINDS.includes(value as PuzzleKind);

export function normalizeQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null;
  const text = isString(value.text) ? value.text.trim() : "";
  if (!text) return null;
  const answerType = value.answerType === "year" || value.answerType === "number" ? value.answerType : "text";
  const tolerance = value.tolerancePercent;
  return {
    ...(value as Partial<Question>),
    id: isString(value.id) && value.id ? value.id : `q-${text.length}-${text.slice(0, 24)}`,
    theme: isString(value.theme) ? value.theme : "",
    text,
    answerType,
    hint: isString(value.hint) ? value.hint : "",
    expectedAnswer: isString(value.expectedAnswer) ? value.expectedAnswer : "",
    acceptedAnswers: Array.isArray(value.acceptedAnswers) ? value.acceptedAnswers.filter(isString) : [],
    tolerancePercent: typeof tolerance === "number" && Number.isFinite(tolerance) ? tolerance : 0,
    source: value.source === "ai" ? "ai" : "fallback",
  };
}

export function isValidPuzzle(value: unknown): value is ChallengePuzzle {
  return (
    isRecord(value) &&
    "solution" in value &&
    isRecord(value.view) &&
    isString(value.view.id) &&
    value.view.id !== "" &&
    isPuzzleKind(value.view.kind)
  );
}

function parseHistory(value: unknown): QuestionSeed[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((seed) => ({ theme: isString(seed.theme) ? seed.theme : "", text: isString(seed.text) ? seed.text : "" }))
    .filter((seed) => seed.text)
    .slice(-HISTORY_LIMIT);
}

/** Aceita sessões v2 e v1 (sem `stage`: estavam nas perguntas, então os captchas contam como feitos). */
function parseSession(value: unknown): ChallengeSession | null {
  if (!isRecord(value)) return null;
  const { alarmIds, startedAt, misses } = value;
  if (!Array.isArray(alarmIds) || !alarmIds.every(isString)) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  const stage = value.stage === undefined ? "questions" : value.stage;
  if (!isStage(stage)) return null;

  const base: ChallengeSession = {
    alarmIds,
    startedAt,
    misses: isInt(misses) && misses >= 0 ? misses : 0,
    stage,
    captchasDone: CAPTCHAS_REQUIRED,
    puzzle: null,
    correct: 0,
    attempt: 1,
    current: null,
    pendingAnswer: null,
    history: parseHistory(value.history),
    phrase: null,
  };

  if (stage === "captcha") {
    const done = value.captchasDone;
    if (!isInt(done) || done < 0 || done >= CAPTCHAS_REQUIRED) return null;
    return { ...base, captchasDone: done, puzzle: isValidPuzzle(value.puzzle) ? value.puzzle : null };
  }

  if (stage === "phrase") {
    const phrase = isString(value.phrase) && value.phrase.trim() ? value.phrase : null;
    return { ...base, correct: REQUIRED_CORRECT, phrase };
  }

  const { correct, attempt, current, pendingAnswer } = value;
  if (!isInt(correct) || correct < 0 || correct >= REQUIRED_CORRECT) return null;
  if (!isInt(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) return null;
  const question = current == null ? null : normalizeQuestion(current);
  return {
    ...base,
    correct,
    attempt: question ? attempt : 1,
    current: question,
    pendingAnswer: question && isString(pendingAnswer) && pendingAnswer.trim() ? pendingAnswer : null,
  };
}

// --- Helpers puros ----------------------------------------------------------

export function isRepeated(question: QuestionSeed, history: readonly QuestionSeed[]): boolean {
  const key = normalizeText(question.text);
  return history.some((seed) => normalizeText(seed.text) === key);
}

const seedOf = (question: Question): QuestionSeed => ({ theme: question.theme, text: question.text });

const withPeriod = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

function incorrectMessage(feedback: string, attempt: number): string {
  return `${withPeriod(feedback || "Resposta errada")} Tentativa ${attempt} de ${MAX_ATTEMPTS}.`;
}

function displayAnswer(question: Question): string {
  const answer = question.expectedAnswer.trim().replace(/[.\s]+$/, "");
  if (question.answerType !== "number") return answer;
  const value = parseCanonicalNumber(answer);
  return value === null ? answer : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function revealMessage(question: Question): string {
  const answer = displayAnswer(question);
  const reveal = answer ? ` A resposta era: ${answer}.` : "";
  return `${MAX_ATTEMPTS} erros.${reveal} Nova pergunta…`;
}

function logError(label: string, error: unknown): void {
  try {
    console.error(`[challenge] ${label} falhou`, error);
  } catch {
    // Sem console.
  }
}

/** Uma exceção na UI nunca pode travar a máquina de estados (nem o som). */
function guardUI(ui: ChallengeUI): ChallengeUI {
  const guarded = {} as Record<string, (...args: never[]) => void>;
  for (const name of UI_METHODS) {
    const method = ui[name] as (...args: unknown[]) => void;
    guarded[name] = (...args: unknown[]) => {
      try {
        method.apply(ui, args);
      } catch (error) {
        logError(`ui.${name}`, error);
      }
    };
  }
  return guarded as unknown as ChallengeUI;
}

function guardSound(sound: ChallengeSound): ChallengeSound {
  const call = (label: string, run: () => void) => {
    try {
      run();
    } catch (error) {
      logError(`sound.${label}`, error);
    }
  };
  return {
    start: (options) => call("start", () => sound.start(options)),
    stop: () => call("stop", () => sound.stop()),
    escalate: () => call("escalate", () => sound.escalate()),
  };
}

export function stepsOf(session: ChallengeSession): StepsView {
  return {
    stage: session.stage,
    captchasDone: session.captchasDone,
    captchasRequired: CAPTCHAS_REQUIRED,
    questionsDone: session.correct,
    questionsRequired: REQUIRED_CORRECT,
  };
}

// --- Máquina de estados -------------------------------------------------------

export function createChallenge(deps: ChallengeDeps): Challenge {
  const ui = guardUI(deps.ui);
  const sound = guardSound(deps.sound);
  const storage = deps.storage ?? null;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const notifyActive = (active: boolean) => {
    try {
      deps.onActiveChange?.(active);
    } catch (error) {
      logError("onActiveChange", error);
    }
  };
  const prefetchEnabled = deps.prefetch ?? true;
  const retryDelay = deps.retryDelayMs ?? ((failures: number) => Math.min(15_000, 1000 * 2 ** (failures - 1)));

  let session: ChallengeSession | null = null;
  let phase: ChallengePhase = "idle";
  /** Toda operação assíncrona guarda o token; se mudou, o resultado é obsoleto e é ignorado. */
  let seq = 0;
  let prefetched: Promise<Question | null> | null = null;
  let errorVisible = false;
  /** Fechamento agendado pela vitória; uma sessão nova o cancela. */
  let closeTimer: { handle: unknown } | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => void setTimer(resolve, ms));

  function persist(): boolean {
    if (!session || !storage) return false;
    try {
      storage.setItem(SESSION_STORAGE_KEY, encodeSession(session));
      return true;
    } catch {
      return false;
    }
  }

  function removeKey(key: string): void {
    try {
      storage?.removeItem(key);
    } catch {
      // Ignora.
    }
  }

  function readKey(key: string): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function readPersisted(): { saved: ChallengeSession; legacy: boolean } | null {
    for (const key of [SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]) {
      const raw = readKey(key);
      if (!raw) continue;
      const saved = decodeSession(raw);
      if (saved) return { saved, legacy: key === LEGACY_SESSION_STORAGE_KEY };
      removeKey(key);
    }
    return null;
  }

  function view(s: ChallengeSession, question: Question): ChallengeView {
    return {
      question: question.text,
      hint: question.hint,
      correct: s.correct,
      required: REQUIRED_CORRECT,
      attempt: s.attempt,
      maxAttempts: MAX_ATTEMPTS,
    };
  }

  const phraseView = (phrase: string): PhraseView => ({ phrase, hint: deps.phraseHint });

  async function generate(previous: QuestionSeed[]): Promise<Question | null> {
    try {
      return normalizeQuestion(await deps.generateQuestion(previous));
    } catch {
      return null;
    }
  }

  async function check(question: Question, answer: string): Promise<Verdict | null> {
    try {
      const verdict = await deps.checkAnswer(question, answer);
      if (!isRecord(verdict) || typeof verdict.correct !== "boolean") return null;
      return { correct: verdict.correct, feedback: isString(verdict.feedback) ? verdict.feedback.trim() : "" };
    } catch {
      return null;
    }
  }

  function newPuzzle(exclude: PuzzleKind[], previousId?: string): ChallengePuzzle | null {
    for (let i = 0; i < 3; i++) {
      try {
        const puzzle = deps.createPuzzle({ exclude });
        if (isValidPuzzle(puzzle) && puzzle.view.id !== previousId) return puzzle;
      } catch {
        // Tenta de novo.
      }
    }
    return null;
  }

  function pickPhrase(): string {
    try {
      const phrase = deps.pickPhrase();
      if (isString(phrase) && phrase.trim()) return phrase;
    } catch {
      // Usa a reserva.
    }
    return FALLBACK_PHRASE;
  }

  function startPrefetch(): void {
    const s = session;
    if (!prefetchEnabled || !s || prefetched || s.stage === "phrase") return;
    // Na última pergunta, a próxima pré-carregada quase nunca seria usada.
    if (s.stage === "questions" && s.correct >= REQUIRED_CORRECT - 1) return;
    const previous = s.current ? [...s.history, seedOf(s.current)] : [...s.history];
    prefetched = generate(previous.slice(-HISTORY_LIMIT));
  }

  async function obtainQuestion(token: number, history: QuestionSeed[]): Promise<Question | null> {
    const pending = prefetched;
    prefetched = null;
    let candidate = pending ? await pending : null;
    let repeats = 0;
    let failures = 0;
    while (token === seq) {
      if (candidate) {
        if (repeats >= MAX_REPEAT_RETRIES || !isRepeated(candidate, history)) return candidate;
        repeats += 1;
      }
      candidate = await generate([...history]);
      if (candidate || token !== seq) continue;
      failures += 1;
      errorVisible = true;
      ui.showFeedback("error", GENERATION_ERROR);
      await sleep(retryDelay(failures));
    }
    return null;
  }

  async function loadNext(): Promise<void> {
    const s = session;
    if (!s || s.stage !== "questions") return;
    const token = ++seq;
    phase = "loading";
    ui.showLoading(LOADING_MESSAGE);
    const question = await obtainQuestion(token, s.history);
    if (!question || token !== seq || session !== s) return;
    s.current = question;
    s.attempt = 1;
    s.pendingAnswer = null;
    persist();
    phase = "answering";
    if (errorVisible) {
      errorVisible = false;
      ui.showFeedback("info", "");
    }
    ui.showQuestion(view(s, question));
    startPrefetch();
  }

  function retire(s: ChallengeSession, question: Question): void {
    s.history = [...s.history, seedOf(question)].slice(-HISTORY_LIMIT);
    s.current = null;
    s.attempt = 1;
    s.pendingAnswer = null;
  }

  // --- Etapas ---

  function enterStage(s: ChallengeSession): void {
    if (s.stage === "captcha") {
      showCaptcha(s);
      return;
    }
    if (s.stage === "phrase") {
      showPhraseStage(s);
      return;
    }
    const question = s.current;
    if (!question) {
      void loadNext();
      return;
    }
    phase = "answering";
    ui.showQuestion(view(s, question));
    if (s.pendingAnswer) void evaluate(s, question, s.pendingAnswer);
    else startPrefetch();
  }

  function goToStage(s: ChallengeSession, stage: Stage): void {
    s.stage = stage;
    if (stage !== "captcha") {
      s.captchasDone = CAPTCHAS_REQUIRED;
      s.puzzle = null;
    }
    if (stage === "phrase") {
      prefetched = null;
      s.correct = REQUIRED_CORRECT;
      s.phrase = pickPhrase();
    }
    persist();
    ui.setSteps(stepsOf(s));
    enterStage(s);
  }

  function showCaptcha(s: ChallengeSession): void {
    if (!s.puzzle) {
      const puzzle = newPuzzle([]);
      // Sem captcha (bug no gerador), não prende o usuário: segue para as perguntas.
      if (!puzzle) {
        goToStage(s, "questions");
        return;
      }
      s.puzzle = puzzle;
      persist();
    }
    phase = "puzzle";
    ui.showPuzzle(s.puzzle.view);
    startPrefetch();
  }

  function replacePuzzle(s: ChallengeSession, exclude: PuzzleKind[]): void {
    const next = newPuzzle(exclude, s.puzzle?.view.id);
    if (!next) {
      goToStage(s, "questions");
      return;
    }
    s.puzzle = next;
    persist();
    ui.setSteps(stepsOf(s));
    ui.showPuzzle(next.view);
  }

  function showPhraseStage(s: ChallengeSession): void {
    if (!s.phrase) {
      s.phrase = pickPhrase();
      persist();
    }
    phase = "phrase";
    ui.showPhrase(phraseView(s.phrase));
  }

  function submitPhrase(s: ChallengeSession, typed: string): void {
    const phrase = s.phrase;
    if (phase !== "phrase" || !phrase) return;
    let ok = false;
    try {
      ok = deps.checkPhrase(phrase, typed) === true;
    } catch {
      ok = false;
    }
    if (ok) {
      ui.showFeedback("correct", PHRASE_CORRECT);
      finish();
      return;
    }
    sound.escalate();
    s.misses += 1;
    persist();
    ui.showFeedback("incorrect", PHRASE_WRONG);
    ui.showPhrase(phraseView(phrase));
  }

  async function evaluate(s: ChallengeSession, question: Question, answer: string): Promise<void> {
    const token = ++seq;
    phase = "submitting";
    ui.setSubmitting(true);
    const verdict = await check(question, answer);
    if (token !== seq || session !== s) return;
    ui.setSubmitting(false);
    s.pendingAnswer = null;

    if (!verdict) {
      persist();
      phase = "answering";
      ui.showFeedback("error", CHECK_ERROR);
      return;
    }

    if (verdict.correct) {
      s.correct += 1;
      const praise = verdict.feedback || "Resposta certa!";
      retire(s, question);
      if (s.correct >= REQUIRED_CORRECT) {
        ui.showFeedback("correct", `${withPeriod(praise)} ${PHRASE_NEXT}`);
        goToStage(s, "phrase");
        return;
      }
      ui.showFeedback("correct", praise);
      persist();
      ui.setSteps(stepsOf(s));
      await loadNext();
      return;
    }

    sound.escalate();
    s.misses += 1;
    s.attempt += 1;
    if (s.attempt <= MAX_ATTEMPTS) {
      persist();
      phase = "answering";
      ui.showFeedback("incorrect", incorrectMessage(verdict.feedback, s.attempt));
      ui.showQuestion(view(s, question));
      return;
    }
    ui.showFeedback("info", revealMessage(question));
    retire(s, question);
    persist();
    await loadNext();
  }

  function finish(): void {
    seq += 1;
    prefetched = null;
    session = null;
    phase = "idle";
    sound.stop();
    ui.showVictory();
    removeKey(SESSION_STORAGE_KEY);
    removeKey(LEGACY_SESSION_STORAGE_KEY);
    ui.setAlarmsLocked(false);
    notifyActive(false);
    const timer: { handle: unknown } = { handle: undefined };
    closeTimer = timer;
    timer.handle = setTimer(() => {
      if (closeTimer !== timer || session) return;
      closeTimer = null;
      ui.closeChallenge();
    }, VICTORY_CLOSE_DELAY_MS);
  }

  function cancelPendingClose(): void {
    const timer = closeTimer;
    closeTimer = null;
    if (!timer) return;
    try {
      clearTimer(timer.handle);
    } catch {
      // O guarda dentro do callback já impede o fechamento.
    }
  }

  function activate(s: ChallengeSession, resumed: boolean): void {
    cancelPendingClose();
    session = s;
    seq += 1;
    prefetched = null;
    errorVisible = false;
    persist();
    // O som vem antes de qualquer UI: mesmo que a interface falhe, o alarme toca.
    sound.start({ startedAt: s.startedAt, escalations: s.misses });
    notifyActive(true);
    ui.openChallenge();
    ui.setAlarmsLocked(true);
    ui.setSubmitting(false);
    const pending = s.stage === "questions" && s.current ? s.pendingAnswer : null;
    ui.showFeedback("info", pending ? PENDING_MESSAGE : resumed ? RESUMED_MESSAGE : "");
    ui.setSteps(stepsOf(s));
    try {
      enterStage(s);
    } catch (error) {
      logError("enterStage", error);
    }
  }

  return {
    isActive: () => session !== null,

    start(alarmIds) {
      if (session) {
        session.alarmIds = [...new Set([...session.alarmIds, ...alarmIds])];
        persist();
        return false;
      }
      activate(
        {
          alarmIds: [...new Set(alarmIds)],
          startedAt: now(),
          misses: 0,
          stage: "captcha",
          captchasDone: 0,
          puzzle: null,
          correct: 0,
          attempt: 1,
          current: null,
          pendingAnswer: null,
          history: [],
          phrase: null,
        },
        false,
      );
      return true;
    },

    resume() {
      if (session) return false;
      const found = readPersisted();
      if (!found) return false;
      activate(found.saved, true);
      // Migração v1 → v2: só apaga a chave antiga depois de gravar a nova.
      if (found.legacy && storage && readKey(SESSION_STORAGE_KEY)) removeKey(LEGACY_SESSION_STORAGE_KEY);
      return true;
    },

    async submit(answer) {
      const s = session;
      if (!s) return;
      const text = isString(answer) ? answer : "";
      if (!text.trim()) return;
      if (s.stage === "phrase") {
        submitPhrase(s, text);
        return;
      }
      const question = s.current;
      if (s.stage !== "questions" || !question || phase !== "answering") return;
      const trimmed = text.trim();
      s.pendingAnswer = trimmed;
      persist();
      await evaluate(s, question, trimmed);
    },

    submitPuzzle(puzzleId, answer) {
      const s = session;
      const puzzle = s?.puzzle;
      if (!s || !puzzle || s.stage !== "captcha" || phase !== "puzzle") return;
      // Resposta de um captcha que já foi trocado (clique duplo, evento atrasado) ou malformada:
      // descarta e remonta o captcha atual, porque a UI já se travou ao enviar.
      if (puzzleId !== puzzle.view.id || !isRecord(answer) || answer.kind !== puzzle.view.kind) {
        ui.showPuzzle(puzzle.view);
        return;
      }

      let solved = false;
      try {
        solved = deps.checkPuzzle(puzzle, answer) === true;
      } catch {
        solved = false;
      }

      if (solved) {
        s.captchasDone += 1;
        if (s.captchasDone >= CAPTCHAS_REQUIRED) {
          ui.showFeedback("correct", CAPTCHAS_DONE);
          goToStage(s, "questions");
          return;
        }
        ui.showFeedback("correct", CAPTCHA_CORRECT);
        replacePuzzle(s, [puzzle.view.kind]);
        return;
      }

      sound.escalate();
      s.misses += 1;
      ui.showFeedback("incorrect", CAPTCHA_WRONG);
      replacePuzzle(s, []);
    },

    snapshot: () => ({
      phase,
      session: session ? (JSON.parse(JSON.stringify(session)) as ChallengeSession) : null,
    }),
  };
}
