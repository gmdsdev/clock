// Contratos compartilhados entre os módulos do app.
// gpt.ts produz `Question`/`Verdict`, ui.ts implementa `UI`, challenge.ts/main.ts orquestram.

export type AnswerType = "year" | "number" | "text";

export type Question = {
  id: string;
  /** Tema (item do array `questions`) usado para gerar a pergunta. */
  theme: string;
  /** Pergunta exibida ao usuário, em pt-BR. */
  text: string;
  answerType: AnswerType;
  /** Instrução de formato exibida ao usuário, ex.: "Responda apenas com o ano (ex.: 1985)". */
  hint: string;
  /** Resposta canônica, revelada apenas quando a pergunta é trocada após 3 erros. */
  expectedAnswer: string;
  /** Variações aceitas (apenas para `text`). */
  acceptedAnswers: string[];
  /** Margem aceita em % (0 para `year` e `text`). */
  tolerancePercent: number;
  source: "ai" | "fallback";
};

/** O mínimo de uma pergunta anterior para evitar repetições. */
export type QuestionSeed = Pick<Question, "theme" | "text">;

export type Verdict = {
  correct: boolean;
  /** Mensagem curta para o usuário (sem revelar a resposta). */
  feedback: string;
};

export type AlarmView = {
  id: string;
  /** "HH:MM" */
  time: string;
  enabled: boolean;
  /** Ex.: "Toca em 7 h 12 min", "Desativado". */
  label: string;
};

export type ChallengeView = {
  question: string;
  hint: string;
  /** Acertos até agora. */
  correct: number;
  /** Acertos necessários para desligar (10). */
  required: number;
  /** Tentativa atual nesta pergunta (1..maxAttempts). */
  attempt: number;
  maxAttempts: number;
};

export type FeedbackKind = "correct" | "incorrect" | "info" | "error";

/** Etapas para desligar: 3 captchas → 10 perguntas → frase final. */
export type Stage = "captcha" | "questions" | "phrase";

export type StepsView = {
  stage: Stage;
  captchasDone: number;
  captchasRequired: number;
  questionsDone: number;
  questionsRequired: number;
};

export type PuzzleKind = "distorted-text" | "select-grid" | "memory-sequence" | "click-order";

export type Shape = "circle" | "square" | "triangle" | "diamond" | "star" | "hexagon";

/** Célula da grade "selecione todos": glifo (número, letra ou emoji; "" se só forma) e/ou forma desenhada. */
export type GridCell = { glyph: string; shape: Shape | null; rotation: number };

/** O que a UI precisa para desenhar o captcha. Tudo roda no navegador, então pode conter o necessário para desenhar. */
export type PuzzleView =
  | {
      id: string;
      kind: "distorted-text";
      instruction: string;
      /** Texto a desenhar distorcido no canvas. */
      text: string;
      /** Semente para a distorção ser idêntica após reload. */
      seed: number;
    }
  | {
      id: string;
      kind: "select-grid";
      /** Ex.: "Selecione todos os números pares". */
      instruction: string;
      /** 9 células (grade 3×3). */
      cells: GridCell[];
    }
  | {
      id: string;
      kind: "memory-sequence";
      instruction: string;
      /** Glifos dos botões (formas distintas, não só cor). */
      symbols: string[];
      /** Índices em `symbols`, na ordem que deve ser repetida. */
      sequence: number[];
      /** Tempo de destaque de cada item ao mostrar a sequência. */
      stepMs: number;
    }
  | {
      id: string;
      kind: "click-order";
      instruction: string;
      /** Números de 1..N embaralhados; índice = posição na grade. */
      numbers: number[];
      timeLimitMs: number;
    };

export type PuzzleAnswer =
  | { kind: "distorted-text"; text: string }
  | { kind: "select-grid"; selected: number[] }
  | { kind: "memory-sequence"; sequence: number[] }
  /** `clicks`: números clicados em ordem (a UI envia no 1º clique errado, ao completar ou ao estourar o tempo). */
  | { kind: "click-order"; clicks: number[]; elapsedMs: number };

export type PhraseView = {
  /** Frase que deve ser digitada (enviada via `onSubmitAnswer`). */
  phrase: string;
  hint: string;
};

export type UIHandlers = {
  /** time no formato "HH:MM". */
  onAddAlarm: (time: string) => void;
  onToggleAlarm: (id: string) => void;
  onDeleteAlarm: (id: string) => void;
  /** Resposta das perguntas e também da frase final. */
  onSubmitAnswer: (answer: string) => void;
  /** `puzzleId` = `view.id` do captcha respondido; respostas de um captcha que já não é o atual são descartadas. */
  onSubmitPuzzle: (puzzleId: string, answer: PuzzleAnswer) => void;
};

export interface UI {
  renderClock(now: Date): void;
  renderAlarms(alarms: AlarmView[]): void;
  /** Enquanto o alarme toca, não é possível adicionar/remover/alternar alarmes. */
  setAlarmsLocked(locked: boolean): void;
  /**
   * Tela principal: `false` mostra o aviso "Toque em qualquer lugar para liberar o som do alarme"
   * (há alarme ativo, mas o navegador ainda não liberou o áudio). `true` esconde.
   */
  setSoundReady(ready: boolean): void;

  /** Mostra a tela cheia do alarme tocando. Não pode ser fechada pela interface. */
  openChallenge(): void;
  closeChallenge(): void;
  /** Estado de carregamento da pergunta (desabilita o campo de resposta). */
  showLoading(message: string): void;
  /** Indicador de etapas (Captchas 2/3 → Perguntas 4/10 → Frase). */
  setSteps(view: StepsView): void;
  /** Mostra um captcha. Mesmo `id` de novo = mesmo captcha (ex.: após reload); `id` novo = captcha novo. */
  showPuzzle(view: PuzzleView): void;
  /** Mostra a pergunta, limpa e foca o campo, habilita o envio. */
  showQuestion(view: ChallengeView): void;
  /** Etapa final: frase a digitar no mesmo campo de resposta (colar bloqueado). */
  showPhrase(view: PhraseView): void;
  setSubmitting(submitting: boolean): void;
  showFeedback(kind: FeedbackKind, message: string): void;
  /** Intensidade do alarme de 0 a 1, para efeitos visuais (pulso, tremor, cor). */
  setIntensity(level: number): void;
  /** Sobreposição "Toque em qualquer lugar para continuar" quando o navegador bloqueia o áudio. */
  showAudioBlocked(show: boolean): void;
  /** Estado final: alarme desligado. */
  showVictory(): void;
}
