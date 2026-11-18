import type {
  AlarmView,
  ChallengeView,
  FeedbackKind,
  GridCell,
  PhraseView,
  PuzzleAnswer,
  PuzzleView,
  Shape,
  Stage,
  StepsView,
  UI,
  UIHandlers,
} from "./types.ts";

type Screen = "loading" | "question" | "phrase" | "puzzle" | "victory";
type InputMode = "answer" | "phrase" | "captcha";

type AlarmRow = {
  root: HTMLLIElement;
  hours: HTMLElement;
  colon: HTMLElement;
  minutes: HTMLElement;
  label: HTMLElement;
  toggle: HTMLButtonElement;
  remove: HTMLButtonElement;
};

type StepRefs = {
  root: HTMLElement;
  marker: HTMLElement;
  count: HTMLElement;
  state: HTMLElement;
};

type PuzzleController = {
  /** Memória e ordem dependem de tempo: só começam visíveis e reiniciam em vez de destravar. */
  timed: boolean;
  start(): void;
  stop(): void;
  setBusy(busy: boolean): void;
  focusFirst(): void;
};

const FEEDBACK_KINDS = new Set<FeedbackKind>(["correct", "incorrect", "info", "error"]);
const BLOCKED_INPUT_TYPES = new Set([
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
  "insertFromYank",
]);
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
const HISTORY_KEY = "despertadorInfinitoTrap";
const DEFAULT_LOADING = "Carregando…";
const PASTE_MESSAGE = "Colar está desativado 😈 Digite com os próprios dedos.";
const PASTE_WARNING_MS = 2600;
/** Rede de segurança: se o Motor não responder a um captcha enviado, destrava sozinho. */
const PUZZLE_UNLOCK_MS = 6000;
const ZERO_WIDTH = "​";
const STAGES: readonly Stage[] = ["captcha", "questions", "phrase"];
const STEP_STATE_TEXT = { done: "concluída", current: "etapa atual", pending: "próxima" } as const;

const INPUT_MODES: Record<
  InputMode,
  { label: string; button: string; capitalize: string; describedBy: string }
> = {
  answer: {
    label: "Sua resposta",
    button: "Responder",
    capitalize: "off",
    describedBy: "question-text question-hint paste-warning",
  },
  phrase: {
    label: "Digite a frase",
    button: "Enviar frase",
    capitalize: "off",
    describedBy: "question-eyebrow question-text question-hint paste-warning",
  },
  captcha: {
    label: "Texto da imagem",
    button: "Verificar",
    capitalize: "characters",
    describedBy: "puzzle-instruction paste-warning",
  },
};

const SHAPE_NAMES: Record<Shape, string> = {
  circle: "círculo",
  square: "quadrado",
  triangle: "triângulo",
  diamond: "losango",
  star: "estrela",
  hexagon: "hexágono",
};

const SVG_NS = "http://www.w3.org/2000/svg";
const STAR_POINTS = Array.from({ length: 10 }, (_, i) => {
  const angle = ((-90 + i * 36) * Math.PI) / 180;
  const radius = i % 2 === 0 ? 46 : 19;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(54 + radius * Math.sin(angle)).toFixed(1)}`;
}).join(" ");

const CAPTCHA_W = 360;
const CAPTCHA_H = 120;
const CAPTCHA_FONTS = [
  '"Atkinson Hyperlegible Next", system-ui, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Courier New", Courier, monospace',
  '"Trebuchet MS", Verdana, sans-serif',
  'Impact, "Arial Black", sans-serif',
  '"Atkinson Hyperlegible Mono", ui-monospace, monospace',
] as const;
const CAPTCHA_INKS = ["#ffd08a", "#ffb23e", "#f6e7d8", "#ff9aa3", "#9ff5c6", "#c7dbff"] as const;

const pad2 = (value: number) => String(value).padStart(2, "0");
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const secondsFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} não encontrado no index.html`);
  return element as T;
}

function slot<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Template sem ${selector}`);
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className: string, text?: string): HTMLButtonElement {
  const element = el("button", className, text);
  element.type = "button";
  return element;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

function shapeSvg(shape: Shape): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" });
  const child =
    shape === "circle"
      ? svgEl("circle", { cx: 50, cy: 50, r: 40 })
      : shape === "square"
        ? svgEl("rect", { x: 13, y: 13, width: 74, height: 74, rx: 6 })
        : shape === "triangle"
          ? svgEl("polygon", { points: "50,9 93,87 7,87" })
          : shape === "diamond"
            ? svgEl("polygon", { points: "50,5 95,50 50,95 5,50" })
            : shape === "star"
              ? svgEl("polygon", { points: STAR_POINTS })
              : svgEl("polygon", { points: "50,6 88,28 88,72 50,94 12,72 12,28" });
  svg.append(child);
  return svg;
}

function setText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function setAttr(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Reinicia uma animação CSS reaplicando a classe. */
function replay(element: HTMLElement, className: string, ...others: string[]) {
  element.classList.remove(className, ...others);
  void element.offsetWidth;
  element.classList.add(className);
}

function isTrapState(state: unknown): boolean {
  return typeof state === "object" && state !== null && HISTORY_KEY in state;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Desenha o captcha de forma determinística: mesma semente e tamanho = mesmos pixels. */
function drawDistortedText(canvas: HTMLCanvasElement, text: string, seed: number) {
  const cssWidth = canvas.getBoundingClientRect().width || CAPTCHA_W;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = (cssWidth / CAPTCHA_W) * dpr;
  const width = Math.max(1, Math.round(CAPTCHA_W * scale));
  const height = Math.max(1, Math.round(CAPTCHA_H * scale));
  canvas.width = width;
  canvas.height = height;
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const ctx = canvas.getContext("2d");
  const lctx = layer.getContext("2d");
  if (!ctx || !lctx) return;

  const rand = mulberry32(Number.isFinite(seed) ? seed : 1);
  const between = (min: number, max: number) => min + (max - min) * rand();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length) % items.length];
  const speckles = (count: number, minAlpha: number, maxAlpha: number) => {
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = between(minAlpha, maxAlpha);
      ctx.fillStyle = pick(CAPTCHA_INKS);
      ctx.beginPath();
      ctx.arc(between(0, CAPTCHA_W), between(0, CAPTCHA_H), between(0.5, 1.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const background = ctx.createLinearGradient(0, 0, CAPTCHA_W, CAPTCHA_H);
  background.addColorStop(0, "#1c0e18");
  background.addColorStop(1, "#0f0b1d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CAPTCHA_W, CAPTCHA_H);
  speckles(150, 0.15, 0.45);

  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  lctx.textAlign = "center";
  lctx.textBaseline = "middle";
  lctx.lineJoin = "round";
  const glyphs = Array.from(text).map((char) => {
    const font = `${pick([700, 800])} ${between(46, 62).toFixed(1)}px ${pick(CAPTCHA_FONTS)}`;
    lctx.font = font;
    return {
      char,
      font,
      rotation: between(-0.4, 0.4),
      dy: between(-11, 11),
      scaleX: between(0.82, 1.18),
      skew: between(-0.28, 0.28),
      gap: between(-2, 6),
      ink: pick(CAPTCHA_INKS),
      width: lctx.measureText(char).width,
    };
  });
  const total = glyphs.reduce((sum, g) => sum + g.width * g.scaleX + g.gap, 0);
  const fit = Math.min(1, (CAPTCHA_W - 40) / Math.max(total, 1));
  let x = (CAPTCHA_W - total * fit) / 2;
  for (const g of glyphs) {
    const advance = g.width * g.scaleX * fit;
    lctx.save();
    lctx.translate(x + advance / 2, CAPTCHA_H / 2 + g.dy * fit);
    lctx.rotate(g.rotation);
    lctx.transform(g.scaleX * fit, 0, g.skew * fit, fit, 0, 0);
    lctx.font = g.font;
    lctx.lineWidth = 3;
    lctx.strokeStyle = "rgb(10 4 8 / 0.85)";
    lctx.strokeText(g.char, 0, 0);
    lctx.fillStyle = g.ink;
    lctx.fillText(g.char, 0, 0);
    lctx.restore();
    x += advance + g.gap * fit;
  }

  // Warp: faixas horizontais deslocadas por uma senoide.
  const amplitude = between(2.5, 5) * scale;
  const frequency = between(0.045, 0.085) / scale;
  const phase = between(0, Math.PI * 2);
  const band = Math.max(1, Math.round(scale * 1.5));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = 0; y < height; y += band) {
    const h = Math.min(band, height - y);
    ctx.drawImage(layer, 0, y, width, h, Math.sin(y * frequency + phase) * amplitude, y, width, h);
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const baseY = between(34, 86);
    const amp = between(5, 14);
    const freq = between(0.018, 0.045);
    const shift = between(0, Math.PI * 2);
    const slope = between(-0.12, 0.12);
    ctx.beginPath();
    for (let px = -4; px <= CAPTCHA_W + 4; px += 4) {
      const py = baseY + slope * (px - CAPTCHA_W / 2) + Math.sin(px * freq + shift) * amp;
      if (px === -4) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = pick(CAPTCHA_INKS);
    ctx.globalAlpha = between(0.55, 0.8);
    ctx.lineWidth = between(1.4, 2.4);
    ctx.stroke();
  }
  speckles(70, 0.4, 0.8);
}

export function createUI(handlers: UIHandlers): UI {
  const root = document.documentElement;

  const app = byId("app");
  const clock = byId<HTMLTimeElement>("clock");
  const clockHours = byId("clock-hours");
  const clockMinutes = byId("clock-minutes");
  const clockSeconds = byId("clock-seconds");
  const clockDate = byId("clock-date");

  const alarmForm = byId<HTMLFormElement>("alarm-form");
  const alarmInput = byId<HTMLInputElement>("alarm-time");
  const alarmSubmit = byId<HTMLButtonElement>("alarm-submit");
  const quickButtons = Array.from(
    alarmForm.querySelectorAll<HTMLButtonElement>("[data-quick-minutes]"),
  );
  const alarmList = byId<HTMLUListElement>("alarm-list");
  const alarmsEmpty = byId("alarms-empty");
  const alarmsCount = byId("alarms-count");
  const alarmsLockedNote = byId("alarms-locked");
  const soundGate = byId("sound-gate");
  const rowTemplate = byId<HTMLTemplateElement>("alarm-row-template");
  const heartTemplate = byId<HTMLTemplateElement>("heart-template");

  const challenge = byId("challenge");
  const scroller = byId("challenge-scroll");
  const quake = byId("challenge-quake");
  const card = byId("challenge-card");
  const titleIcon = byId("challenge-icon");
  const titleText = byId("challenge-title-text");
  const challengeHours = byId("challenge-clock-hours");
  const challengeMinutes = byId("challenge-clock-minutes");
  const stepsList = byId<HTMLOListElement>("steps");
  const steps = new Map<Stage, StepRefs>(
    STAGES.map((stage) => {
      const item = slot<HTMLElement>(stepsList, `[data-step="${stage}"]`);
      return [
        stage,
        {
          root: item,
          marker: slot(item, ".step__marker"),
          count: slot(item, ".step__count"),
          state: slot(item, "[data-slot='state']"),
        },
      ];
    }),
  );
  const meters = byId("challenge-meters");
  const progress = byId("progress");
  const progressValue = byId("progress-value");
  const livesBox = byId("lives-box");
  const lives = byId("lives");
  const attemptText = byId("attempt-text");
  const loadingPanel = byId("challenge-loading");
  const loadingText = byId("challenge-loading-text");
  const questionPanel = byId("challenge-question");
  const questionEyebrow = byId("question-eyebrow");
  const questionText = byId("question-text");
  const questionHint = byId("question-hint");
  const puzzlePanel = byId("challenge-puzzle");
  const puzzleInstruction = byId("puzzle-instruction");
  const puzzleBody = byId("puzzle-body");
  const puzzleNote = byId("puzzle-note");
  const victoryPanel = byId("challenge-victory");
  const victoryTitle = byId("victory-title");
  const answerForm = byId<HTMLFormElement>("answer-form");
  const answerLabel = byId("answer-label");
  const answerInput = byId<HTMLInputElement>("answer-input");
  const answerSubmit = byId<HTMLButtonElement>("answer-submit");
  const answerSubmitLabel = byId("answer-submit-label");
  const pasteWarning = byId("paste-warning");
  const feedback = byId("feedback");
  const status = byId("challenge-status");
  const audioBlocked = byId("audio-blocked");

  const dateFormat = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const rows = new Map<string, AlarmRow>();
  let hasRenderedAlarms = false;
  let alarmsLocked = false;

  let isOpen = false;
  let screen: Screen = "loading";
  let inputMode: InputMode = "answer";
  let submitting = false;
  let lastQuestion = "";
  let litSegments = 0;
  let heartsLeft = 0;
  let pasteTimer = 0;
  let restoreFocus: HTMLElement | null = null;
  let lastSteps: StepsView | null = null;

  let puzzleView: PuzzleView | null = null;
  let puzzle: PuzzleController | null = null;
  let puzzleSent = false;
  let puzzleStarted = false;
  let puzzleWatchdog = 0;

  // ---------- Relógio ----------

  function renderClock(now: Date) {
    const hours = pad2(now.getHours());
    const minutes = pad2(now.getMinutes());
    const seconds = pad2(now.getSeconds());
    setText(clockHours, hours);
    setText(clockMinutes, minutes);
    setText(clockSeconds, seconds);
    clock.dateTime = `${hours}:${minutes}:${seconds}`;
    clock.dataset.tick = now.getSeconds() % 2 === 0 ? "on" : "off";
    const date = dateFormat.format(now);
    setText(clockDate, date.charAt(0).toUpperCase() + date.slice(1));
    setText(challengeHours, hours);
    setText(challengeMinutes, minutes);
  }

  // ---------- Alarmes ----------

  function createRow(id: string): AlarmRow {
    const fragment = rowTemplate.content.cloneNode(true) as DocumentFragment;
    const li = slot<HTMLLIElement>(fragment, "li");
    li.dataset.id = id;
    return {
      root: li,
      hours: slot(li, "[data-slot='hours']"),
      colon: slot(li, "[data-slot='colon']"),
      minutes: slot(li, "[data-slot='minutes']"),
      label: slot(li, "[data-slot='label']"),
      toggle: slot<HTMLButtonElement>(li, "[data-action='toggle']"),
      remove: slot<HTMLButtonElement>(li, "[data-action='delete']"),
    };
  }

  function updateRow(row: AlarmRow, alarm: AlarmView) {
    const enabled = String(alarm.enabled);
    const match = /^(\d{1,2}):(\d{2})$/.exec(alarm.time);
    setText(row.hours, match ? match[1] : alarm.time);
    setText(row.minutes, match ? match[2] : "");
    row.colon.hidden = !match;
    setText(row.label, alarm.label);
    if (row.root.dataset.enabled !== enabled) row.root.dataset.enabled = enabled;
    setAttr(row.toggle, "aria-checked", enabled);
    setAttr(row.toggle, "aria-label", `Alarme das ${alarm.time}`);
    setAttr(row.remove, "aria-label", `Excluir alarme das ${alarm.time}`);
    row.toggle.disabled = alarmsLocked;
    row.remove.disabled = alarmsLocked;
  }

  function renderAlarms(alarms: AlarmView[]) {
    const ids = new Set(alarms.map((alarm) => alarm.id));
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusWasInList = active !== null && alarmList.contains(active);
    let lostFocus: { index: number; action: string } | null = null;

    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      if (active && row.root.contains(active)) {
        lostFocus = {
          index: Array.prototype.indexOf.call(alarmList.children, row.root),
          action: active.dataset.action ?? "",
        };
      }
      row.root.remove();
      rows.delete(id);
    }

    alarms.forEach((alarm, index) => {
      let row = rows.get(alarm.id);
      if (!row) {
        row = createRow(alarm.id);
        rows.set(alarm.id, row);
        if (hasRenderedAlarms) row.root.classList.add("is-new");
      }
      updateRow(row, alarm);
      const current = alarmList.children[index] ?? null;
      if (current !== row.root) alarmList.insertBefore(row.root, current);
    });

    const empty = alarms.length === 0;
    alarmList.hidden = empty;
    alarmsEmpty.hidden = !empty;
    const armed = alarms.filter((alarm) => alarm.enabled).length;
    setText(
      alarmsCount,
      empty ? "" : armed === 0 ? "nenhum armado" : armed === 1 ? "1 armado" : `${armed} armados`,
    );
    hasRenderedAlarms = true;

    if (lostFocus) {
      const next = alarms[Math.min(lostFocus.index, alarms.length - 1)];
      const row = next ? rows.get(next.id) : undefined;
      const target = row ? (lostFocus.action === "toggle" ? row.toggle : row.remove) : alarmInput;
      if (!target.disabled) target.focus({ preventScroll: true });
    } else if (focusWasInList && active?.isConnected && document.activeElement !== active) {
      active.focus({ preventScroll: true });
    }
  }

  function setAlarmsLocked(locked: boolean) {
    alarmsLocked = locked;
    alarmInput.disabled = locked;
    alarmSubmit.disabled = locked;
    for (const quick of quickButtons) quick.disabled = locked;
    for (const row of rows.values()) {
      row.toggle.disabled = locked;
      row.remove.disabled = locked;
    }
    alarmsLockedNote.hidden = !locked;
  }

  alarmForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (alarmsLocked) return;
    const time = alarmInput.value.slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      replay(alarmInput, "is-shaking");
      alarmInput.focus();
      return;
    }
    handlers.onAddAlarm(time);
  });

  for (const quick of quickButtons) {
    quick.addEventListener("click", () => {
      const minutes = Number(quick.dataset.quickMinutes);
      if (alarmsLocked || !Number.isFinite(minutes)) return;
      const at = new Date(Date.now() + minutes * 60_000);
      handlers.onAddAlarm(`${pad2(at.getHours())}:${pad2(at.getMinutes())}`);
    });
  }

  alarmList.addEventListener("click", (event) => {
    if (alarmsLocked || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>("button[data-action]");
    const id = target?.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!target || target.disabled || !id) return;
    if (target.dataset.action === "toggle") handlers.onToggleAlarm(id);
    else if (target.dataset.action === "delete") handlers.onDeleteAlarm(id);
  });

  function setSoundReady(ready: boolean) {
    soundGate.hidden = ready;
  }

  // ---------- Desafio: estado interno ----------

  function announce(text: string) {
    status.textContent = status.textContent === text ? text + ZERO_WIDTH : text;
  }

  function stepsStage(): Stage | null {
    return lastSteps ? lastSteps.stage : null;
  }

  function applyStage() {
    const textPuzzle = screen === "puzzle" && puzzleView?.kind === "distorted-text";
    loadingPanel.hidden = screen !== "loading";
    questionPanel.hidden = screen !== "question" && screen !== "phrase";
    questionPanel.classList.toggle("is-phrase", screen === "phrase");
    questionEyebrow.hidden = screen !== "phrase";
    puzzlePanel.hidden = screen !== "puzzle";
    victoryPanel.hidden = screen !== "victory";
    answerForm.hidden =
      screen === "victory" ||
      (screen === "puzzle" && !textPuzzle) ||
      (screen === "loading" && stepsStage() === "captcha");
    const stage = stepsStage();
    const metersVisible =
      screen !== "victory" &&
      (stage ? stage === "questions" : screen !== "puzzle" && screen !== "phrase");
    meters.hidden = !metersVisible;
    livesBox.hidden = !metersVisible || lives.childElementCount === 0;
    challenge.dataset.state = screen === "victory" ? "victory" : "ringing";
    challenge.dataset.screen = screen;
  }

  function applyControls() {
    // readOnly (e não disabled) mantém o foco e o teclado virtual no campo entre tentativas.
    const mode = INPUT_MODES[inputMode];
    const textPuzzle = screen === "puzzle" && puzzleView?.kind === "distorted-text";
    const busy = submitting || (textPuzzle && puzzleSent);
    const active = (screen === "question" || screen === "phrase" || textPuzzle) && !busy;
    answerInput.readOnly = !active;
    if (active) answerInput.removeAttribute("aria-disabled");
    else answerInput.setAttribute("aria-disabled", "true");
    answerSubmit.disabled = !active;
    answerForm.classList.toggle("is-locked", !active);
    answerForm.classList.toggle("is-submitting", busy);
    setText(answerLabel, mode.label);
    setAttr(answerInput, "autocapitalize", mode.capitalize);
    setAttr(answerInput, "aria-describedby", mode.describedBy);
    setText(answerSubmitLabel, busy ? "Verificando…" : mode.button);
  }

  function focusInside() {
    if (screen === "victory") victoryTitle.focus({ preventScroll: true });
    else if (screen === "puzzle" && puzzle) puzzle.focusFirst();
    else answerInput.focus({ preventScroll: true });
    if (!challenge.contains(document.activeElement)) challenge.focus({ preventScroll: true });
  }

  function renderProgress(correct: number, required: number) {
    const total = Math.max(1, Math.floor(required) || 1);
    const done = clamp(Math.floor(correct) || 0, 0, total);
    if (progress.childElementCount !== total) {
      const segments = Array.from({ length: total }, () => el("span", "segment"));
      progress.replaceChildren(...segments);
      progress.style.setProperty("--segments", String(total));
      litSegments = Math.min(litSegments, done);
    }
    Array.from(progress.children).forEach((child, index) => {
      const segment = child as HTMLElement;
      const on = index < done;
      segment.dataset.on = String(on);
      if (on && index >= litSegments) replay(segment, "is-fresh");
    });
    litSegments = done;
    setAttr(progress, "aria-valuemax", String(total));
    setAttr(progress, "aria-valuenow", String(done));
    setAttr(progress, "aria-valuetext", `${done} de ${total} acertos`);
    setText(progressValue, `${done}/${total}`);
  }

  function renderLives(attempt: number, maxAttempts: number) {
    const max = Math.max(1, Math.floor(maxAttempts) || 1);
    const current = clamp(Math.floor(attempt) || 1, 1, max);
    const left = max - current + 1;
    if (lives.childElementCount !== max) {
      const hearts = Array.from({ length: max }, () => heartTemplate.content.cloneNode(true));
      lives.replaceChildren(...hearts);
      heartsLeft = max;
    }
    Array.from(lives.children).forEach((child, index) => {
      const heart = child as HTMLElement;
      const full = index < left;
      heart.dataset.state = full ? "full" : "lost";
      if (!full && index < heartsLeft) replay(heart, "is-breaking", "is-refilled");
      else if (full && index >= heartsLeft) replay(heart, "is-refilled", "is-breaking");
    });
    heartsLeft = left;
    setText(attemptText, `Tentativa ${current} de ${max}`);
  }

  function renderSteps(view: StepsView, complete: boolean) {
    const currentIndex = Math.max(0, STAGES.indexOf(view.stage));
    const counts: Record<Stage, string> = {
      captcha: `${clamp(Math.floor(view.captchasDone) || 0, 0, 99)}/${Math.max(1, Math.floor(view.captchasRequired) || 1)}`,
      questions: `${clamp(Math.floor(view.questionsDone) || 0, 0, 99)}/${Math.max(1, Math.floor(view.questionsRequired) || 1)}`,
      phrase: "",
    };
    STAGES.forEach((stage, index) => {
      const refs = steps.get(stage);
      if (!refs) return;
      const state = complete || index < currentIndex ? "done" : index === currentIndex ? "current" : "pending";
      refs.root.dataset.state = state;
      if (state === "current") refs.root.setAttribute("aria-current", "step");
      else refs.root.removeAttribute("aria-current");
      setText(refs.marker, state === "done" ? "✓" : String(index + 1));
      setText(refs.count, counts[stage]);
      setText(refs.state, `(${STEP_STATE_TEXT[state]})`);
    });
    stepsList.hidden = false;
  }

  function clearPasteWarning() {
    window.clearTimeout(pasteTimer);
    pasteWarning.textContent = "";
    pasteWarning.classList.remove("is-visible");
  }

  function warnPaste() {
    pasteWarning.textContent = PASTE_MESSAGE;
    replay(pasteWarning, "is-visible");
    replay(answerInput, "is-shaking");
    window.clearTimeout(pasteTimer);
    pasteTimer = window.setTimeout(clearPasteWarning, PASTE_WARNING_MS);
  }

  // ---------- Captchas ----------

  function puzzleCanRun() {
    return isOpen && audioBlocked.hidden && screen === "puzzle";
  }

  function maybeStartPuzzle() {
    if (!puzzle || puzzleStarted || puzzleSent || !puzzleCanRun()) return;
    puzzleStarted = true;
    puzzle.start();
  }

  function stopPuzzle() {
    window.clearTimeout(puzzleWatchdog);
    puzzle?.stop();
    puzzle = null;
    puzzleView = null;
    puzzleSent = false;
    puzzleStarted = false;
    puzzleBody.replaceChildren();
    delete puzzleBody.dataset.kind;
    puzzleNote.textContent = "";
  }

  function note(text: string) {
    puzzleNote.textContent = puzzleNote.textContent === text ? text + ZERO_WIDTH : text;
  }

  function unlockPuzzle() {
    window.clearTimeout(puzzleWatchdog);
    if (!puzzleSent) return;
    // Memória e ordem consomem o estado: recomeçam do zero em vez de só destravar.
    if (puzzle?.timed) {
      remountPuzzle();
    } else {
      puzzleSent = false;
      puzzle?.setBusy(false);
    }
  }

  function submitPuzzle(answer: PuzzleAnswer) {
    if (screen !== "puzzle" || !puzzle || !puzzleView || puzzleSent || submitting) return;
    const id = puzzleView.id;
    puzzleSent = true;
    puzzle.setBusy(true);
    applyControls();
    window.clearTimeout(puzzleWatchdog);
    puzzleWatchdog = window.setTimeout(() => {
      if (screen !== "puzzle" || submitting || puzzleView?.id !== id) return;
      unlockPuzzle();
      applyControls();
      if (isOpen) puzzle?.focusFirst();
    }, PUZZLE_UNLOCK_MS);
    handlers.onSubmitPuzzle(id, answer);
  }

  function mountPuzzle(view: PuzzleView) {
    stopPuzzle();
    puzzleView = view;
    puzzleInstruction.textContent = view.instruction;
    puzzleBody.dataset.kind = view.kind;
    switch (view.kind) {
      case "distorted-text":
        puzzle = renderDistortedText(view.text, view.seed);
        break;
      case "select-grid":
        puzzle = renderSelectGrid(view.cells);
        break;
      case "memory-sequence":
        puzzle = renderMemory(view.symbols, view.sequence, view.stepMs);
        break;
      case "click-order":
        puzzle = renderClickOrder(view.numbers, view.timeLimitMs);
        break;
    }
  }

  function remountPuzzle() {
    if (!puzzleView) return;
    mountPuzzle(puzzleView);
    if (isOpen) puzzle?.focusFirst();
    maybeStartPuzzle();
  }

  function renderDistortedText(text: string, seed: number): PuzzleController {
    const frame = el("div", "captcha-frame");
    const canvas = el("canvas", "captcha-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Imagem com caracteres distorcidos");
    frame.append(canvas);
    puzzleBody.append(frame);
    let alive = true;
    let drawnWidth = -1;
    const draw = () => {
      if (!alive) return;
      const width = canvas.getBoundingClientRect().width;
      if (width === drawnWidth) return;
      drawnWidth = width;
      drawDistortedText(canvas, text, seed);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    void document.fonts?.ready.then(() => {
      drawnWidth = -1;
      draw();
    });
    return {
      timed: false,
      start() {},
      stop() {
        alive = false;
        observer.disconnect();
      },
      setBusy() {},
      focusFirst() {
        answerInput.focus({ preventScroll: true });
      },
    };
  }

  function renderSelectGrid(cells: GridCell[]): PuzzleController {
    const grid = el("div", "pick-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", "puzzle-instruction");
    const selected = new Set<number>();
    let busy = false;
    const actions = el("div", "puzzle__actions");
    const count = el("span", "puzzle__count", "Nenhuma selecionada");
    const verify = button("btn btn--alarm puzzle__verify", "Verificar");

    const updateCount = () => {
      const n = selected.size;
      setText(count, n === 0 ? "Nenhuma selecionada" : n === 1 ? "1 selecionada" : `${n} selecionadas`);
    };

    const cellButtons = cells.map((cell, index) => {
      const cellButton = button("pick-cell");
      const rotation = Number(cell.rotation) || 0;
      const parts = [cell.glyph, cell.shape ? SHAPE_NAMES[cell.shape] : ""].filter(Boolean);
      if (rotation % 360 !== 0) parts.push(`girado ${Math.abs(rotation)}°`);
      cellButton.setAttribute("aria-label", `Opção ${index + 1}: ${parts.join(", ") || "vazia"}`);
      cellButton.setAttribute("aria-pressed", "false");
      const art = el("span", "pick-cell__art");
      art.setAttribute("aria-hidden", "true");
      art.style.transform = `rotate(${rotation}deg)`;
      if (cell.shape) art.append(shapeSvg(cell.shape));
      if (cell.glyph) art.append(el("span", "pick-cell__glyph", cell.glyph));
      if (cell.shape && cell.glyph) art.classList.add("has-both");
      const check = el("span", "pick-cell__check", "✓");
      check.setAttribute("aria-hidden", "true");
      cellButton.append(art, check);
      cellButton.addEventListener("click", () => {
        if (busy) return;
        if (selected.has(index)) selected.delete(index);
        else selected.add(index);
        cellButton.setAttribute("aria-pressed", String(selected.has(index)));
        updateCount();
        if (puzzleNote.textContent) puzzleNote.textContent = "";
      });
      return cellButton;
    });
    grid.append(...cellButtons);

    verify.addEventListener("click", () => {
      if (busy) return;
      if (selected.size === 0) {
        note("Selecione pelo menos uma opção.");
        replay(grid, "is-shaking");
        return;
      }
      submitPuzzle({ kind: "select-grid", selected: [...selected].sort((a, b) => a - b) });
    });
    actions.append(count, verify);
    puzzleBody.append(grid, actions);

    return {
      timed: false,
      start() {},
      stop() {},
      setBusy(value) {
        busy = value;
        for (const item of [...cellButtons, verify]) {
          if (value) item.setAttribute("aria-disabled", "true");
          else item.removeAttribute("aria-disabled");
        }
        verify.classList.toggle("is-busy", value);
        setText(verify, value ? "Verificando…" : "Verificar");
      },
      focusFirst() {
        (cellButtons[0] ?? verify).focus({ preventScroll: true });
      },
    };
  }

  function renderMemory(symbols: string[], sequence: number[], stepMs: number): PuzzleController {
    const step = clamp(Number(stepMs) || 700, 200, 3000);
    const gap = Math.max(160, Math.round(step * 0.35));
    const total = sequence.length;
    const statusLine = el("div", "memory-status");
    const statusText = el("span", "memory-status__text", "Prepare-se…");
    const dots = el("span", "memory-dots");
    dots.setAttribute("aria-hidden", "true");
    const dotItems = sequence.map(() => el("span", "memory-dot"));
    dots.append(...dotItems);
    statusLine.append(statusText, dots);

    const pad = el("div", "memory-pad");
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-labelledby", "puzzle-instruction");
    pad.style.setProperty("--keys", String(symbols.length <= 4 ? symbols.length : Math.ceil(symbols.length / 2)));

    let phase: "waiting" | "show" | "repeat" = "waiting";
    let busy = false;
    const entered: number[] = [];
    const timers: number[] = [];

    const keys = symbols.map((symbol, index) => {
      const key = button("memory-key", symbol);
      key.setAttribute("aria-label", `Símbolo ${symbol}`);
      key.addEventListener("click", () => {
        if (phase !== "repeat" || busy || entered.length >= total) return;
        entered.push(index);
        replay(key, "is-pressed");
        dotItems[entered.length - 1]?.setAttribute("data-on", "true");
        setText(statusText, `Sua vez: ${entered.length} de ${total}`);
        if (entered.length === total) submitPuzzle({ kind: "memory-sequence", sequence: [...entered] });
      });
      return key;
    });
    pad.append(...keys);
    puzzleBody.append(statusLine, pad);

    const setKeysEnabled = (enabled: boolean) => {
      for (const key of keys) {
        if (enabled) key.removeAttribute("aria-disabled");
        else key.setAttribute("aria-disabled", "true");
      }
    };
    setKeysEnabled(false);

    const clearTimers = () => {
      while (timers.length) window.clearTimeout(timers.pop());
      for (const key of keys) key.classList.remove("is-lit");
    };

    return {
      timed: true,
      start() {
        phase = "show";
        setText(statusText, "Observe a sequência…");
        let at = 700;
        sequence.forEach((symbolIndex, position) => {
          const key = keys[symbolIndex];
          if (!key) return;
          timers.push(
            window.setTimeout(() => {
              key.classList.add("is-lit");
              setText(statusText, `Observe: ${position + 1} de ${total}`);
            }, at),
            window.setTimeout(() => key.classList.remove("is-lit"), at + step),
          );
          at += step + gap;
        });
        timers.push(
          window.setTimeout(() => {
            phase = "repeat";
            setKeysEnabled(!busy);
            setText(statusText, `Sua vez: 0 de ${total}`);
            announce("Sua vez: repita a sequência.");
          }, at),
        );
      },
      stop: clearTimers,
      setBusy(value) {
        busy = value;
        setKeysEnabled(!value && phase === "repeat");
      },
      focusFirst() {
        keys[0]?.focus({ preventScroll: true });
      },
    };
  }

  function renderClickOrder(numbers: number[], timeLimitMs: number): PuzzleController {
    const limit = Math.max(1000, Number(timeLimitMs) || 10_000);
    const order = [...numbers].sort((a, b) => a - b);
    const clicks: number[] = [];
    let running = false;
    let busy = false;
    let startedAt = 0;
    let deadline = 0;
    let ticker = 0;

    const timebar = el("div", "timebar");
    const head = el("div", "timebar__head");
    const label = el("span", "", "Tempo");
    const value = el("span", "timebar__value", `${secondsFormat.format(limit / 1000)} s`);
    head.append(label, value);
    const track = el("div", "timebar__track");
    track.setAttribute("aria-hidden", "true");
    const fill = el("div", "timebar__fill");
    track.append(fill);
    timebar.append(head, track);
    timebar.style.setProperty("--time-limit", `${limit}ms`);

    const grid = el("div", "order-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", "puzzle-instruction");
    grid.style.setProperty("--cols", String(numbers.length > 9 ? 4 : 3));

    const setKeysEnabled = (enabled: boolean) => {
      for (const key of keys) {
        if (enabled && !key.classList.contains("is-done")) key.removeAttribute("aria-disabled");
        else key.setAttribute("aria-disabled", "true");
      }
    };

    const stopTimers = () => {
      window.clearTimeout(deadline);
      window.clearInterval(ticker);
      timebar.classList.add("is-paused");
    };

    const finish = (timedOut: boolean) => {
      if (!running) return;
      running = false;
      stopTimers();
      const elapsedMs = timedOut ? limit : Math.min(limit, Math.round(performance.now() - startedAt));
      if (timedOut) {
        setText(value, "0,0 s");
        note("Tempo esgotado!");
      }
      submitPuzzle({ kind: "click-order", clicks: [...clicks], elapsedMs });
    };

    const keys = numbers.map((n) => {
      const key = button("order-key", String(n));
      key.addEventListener("click", () => {
        if (!running || busy || key.classList.contains("is-done")) return;
        clicks.push(n);
        if (n === order[clicks.length - 1]) {
          key.classList.add("is-done");
          key.setAttribute("aria-disabled", "true");
          key.setAttribute("aria-label", `${n}, feito`);
          if (clicks.length === order.length) finish(false);
        } else {
          key.classList.add("is-wrong");
          key.setAttribute("aria-label", `${n}, errado`);
          finish(false);
        }
      });
      return key;
    });
    grid.append(...keys);
    puzzleBody.append(timebar, grid);
    setKeysEnabled(false);

    return {
      timed: true,
      start() {
        running = true;
        startedAt = performance.now();
        timebar.classList.remove("is-paused");
        timebar.classList.add("is-running");
        setKeysEnabled(!busy);
        deadline = window.setTimeout(() => finish(true), limit);
        ticker = window.setInterval(() => {
          const left = Math.max(0, limit - (performance.now() - startedAt));
          setText(value, `${secondsFormat.format(left / 1000)} s`);
          timebar.classList.toggle("is-low", left < limit * 0.3);
        }, 100);
      },
      stop() {
        running = false;
        stopTimers();
      },
      setBusy(next) {
        busy = next;
        setKeysEnabled(!next && running);
      },
      focusFirst() {
        keys[0]?.focus({ preventScroll: true });
      },
    };
  }

  function resetChallenge() {
    stopPuzzle();
    screen = "loading";
    inputMode = "answer";
    submitting = false;
    lastQuestion = "";
    lastSteps = null;
    litSegments = 0;
    heartsLeft = 0;
    stepsList.hidden = true;
    loadingText.textContent = DEFAULT_LOADING;
    questionText.textContent = "";
    questionHint.textContent = "";
    puzzleInstruction.textContent = "";
    answerInput.value = "";
    feedback.textContent = "";
    delete feedback.dataset.kind;
    feedback.classList.remove("is-fresh");
    status.textContent = "";
    clearPasteWarning();
    progress.replaceChildren();
    lives.replaceChildren();
    renderProgress(0, 10);
    setText(attemptText, "");
    card.classList.remove("shake", "flash-correct");
    answerInput.classList.remove("is-shaking");
    titleIcon.textContent = "⏰";
    titleText.textContent = "ACORDA!";
    setIntensity(0);
    showAudioBlocked(false);
    applyStage();
    applyControls();
  }

  // ---------- Desafio: anti-fuga ----------

  function focusables(): HTMLElement[] {
    return Array.from(challenge.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) =>
        !element.matches(":disabled") &&
        !element.closest("[hidden]") &&
        element.getClientRects().length > 0,
    );
  }

  function cycleFocus(event: KeyboardEvent) {
    const items = focusables();
    event.preventDefault();
    if (items.length === 0) {
      challenge.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const step = event.shiftKey ? -1 : 1;
    const nextIndex =
      index === -1 ? (event.shiftKey ? items.length - 1 : 0) : (index + step + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isOpen) return;
      const key = event.key.toLowerCase();
      if (key === "escape" || key === "f5" || ((event.metaKey || event.ctrlKey) && key === "r")) {
        event.preventDefault();
      } else if (key === "tab") {
        cycleFocus(event);
      }
    },
    true,
  );

  document.addEventListener("focusin", (event) => {
    if (!isOpen) return;
    if (event.target instanceof Node && challenge.contains(event.target)) return;
    focusInside();
  });

  window.addEventListener("popstate", () => {
    if (isOpen) history.pushState({ [HISTORY_KEY]: true }, "");
  });

  // Clique no fundo não faz nada (nem tira o foco do campo).
  challenge.addEventListener("mousedown", (event) => {
    if (event.target === scroller || event.target === quake || event.target === challenge) {
      event.preventDefault();
    }
  });

  // A frase final não pode ser copiada.
  for (const type of ["copy", "cut", "dragstart"]) {
    questionPanel.addEventListener(type, (event) => {
      if (screen === "phrase") event.preventDefault();
    });
  }

  // ---------- Desafio: resposta ----------

  answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = answerInput.value.trim();
    if (screen === "puzzle") {
      if (puzzleView?.kind !== "distorted-text" || puzzleSent || submitting) return;
      answerInput.focus({ preventScroll: true });
      if (!value) {
        replay(answerInput, "is-shaking");
        return;
      }
      submitPuzzle({ kind: "distorted-text", text: value });
      return;
    }
    if ((screen !== "question" && screen !== "phrase") || submitting) return;
    answerInput.focus({ preventScroll: true });
    if (!value) {
      replay(answerInput, "is-shaking");
      return;
    }
    handlers.onSubmitAnswer(value);
  });

  const blockInsertion = (event: Event) => {
    event.preventDefault();
    warnPaste();
  };
  answerInput.addEventListener("paste", blockInsertion);
  answerInput.addEventListener("drop", blockInsertion);
  answerInput.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  answerInput.addEventListener("beforeinput", (event) => {
    if (BLOCKED_INPUT_TYPES.has(event.inputType)) blockInsertion(event);
  });

  // ---------- Interface pública do desafio ----------

  function openChallenge() {
    if (isOpen) {
      // Novo alarme durante a vitória: volta ao visual de alarme tocando.
      if (screen === "victory") {
        const blocked = !audioBlocked.hidden;
        resetChallenge();
        if (blocked) showAudioBlocked(true);
        focusInside();
      }
      return;
    }
    isOpen = true;
    const active = document.activeElement;
    restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    app.inert = true;
    challenge.hidden = false;
    root.classList.add("is-ringing");
    if (!isTrapState(history.state)) history.pushState({ [HISTORY_KEY]: true }, "");
    applyStage();
    applyControls();
    focusInside();
    maybeStartPuzzle();
  }

  function closeChallenge() {
    if (!isOpen) return;
    isOpen = false;
    challenge.hidden = true;
    app.inert = false;
    root.classList.remove("is-ringing");
    resetChallenge();
    if (isTrapState(history.state)) history.back();
    const previous = restoreFocus;
    restoreFocus = null;
    // Microtask: o Motor pode destravar a lista logo depois de fechar.
    queueMicrotask(() => {
      if (isOpen) return;
      const target =
        previous && previous.isConnected && !previous.matches(":disabled") ? previous : alarmInput;
      target.focus({ preventScroll: true });
    });
  }

  function showLoading(message: string) {
    stopPuzzle();
    screen = "loading";
    submitting = false;
    const text = (message || "").trim() || DEFAULT_LOADING;
    loadingText.textContent = text;
    applyStage();
    applyControls();
    announce(text);
  }

  function setSteps(view: StepsView) {
    lastSteps = { ...view };
    renderSteps(view, false);
    if (view.stage === "questions") renderProgress(view.questionsDone, view.questionsRequired);
    applyStage();
  }

  function showPuzzle(view: PuzzleView) {
    const isNew = screen !== "puzzle" || view.id !== puzzleView?.id;
    screen = "puzzle";
    submitting = false;
    if (view.kind === "distorted-text") {
      inputMode = "captcha";
      answerInput.value = "";
    }
    puzzleView = view;
    applyStage();
    mountPuzzle(view);
    applyStage();
    applyControls();
    if (isNew) {
      replay(puzzlePanel, "is-entering");
      announce(view.instruction);
    }
    if (isOpen) puzzle?.focusFirst();
    maybeStartPuzzle();
  }

  function showQuestion(view: ChallengeView) {
    stopPuzzle();
    const isNewQuestion = screen !== "question" || view.question !== lastQuestion;
    screen = "question";
    inputMode = "answer";
    submitting = false;
    questionText.textContent = view.question;
    questionHint.textContent = view.hint;
    questionHint.hidden = !view.hint;
    renderProgress(view.correct, view.required);
    renderLives(view.attempt, view.maxAttempts);
    answerInput.value = "";
    applyStage();
    applyControls();
    if (isNewQuestion) {
      replay(questionPanel, "is-entering");
      announce(view.hint ? `${view.question} ${view.hint}` : view.question);
    }
    lastQuestion = view.question;
    if (isOpen) answerInput.focus({ preventScroll: true });
  }

  function showPhrase(view: PhraseView) {
    stopPuzzle();
    const isNew = screen !== "phrase" || view.phrase !== lastQuestion;
    screen = "phrase";
    inputMode = "phrase";
    submitting = false;
    questionText.textContent = view.phrase;
    questionHint.textContent = view.hint;
    questionHint.hidden = !view.hint;
    answerInput.value = "";
    applyStage();
    applyControls();
    if (isNew) {
      replay(questionPanel, "is-entering");
      announce(`Última etapa. Digite exatamente: ${view.phrase}`);
    }
    lastQuestion = view.phrase;
    if (isOpen) answerInput.focus({ preventScroll: true });
  }

  function setSubmitting(value: boolean) {
    if (screen === "puzzle") {
      if (value) {
        submitting = true;
        puzzle?.setBusy(true);
      } else {
        submitting = false;
        // Sem novo captcha do Motor: libera o mesmo.
        if (puzzleSent) unlockPuzzle();
        else puzzle?.setBusy(false);
      }
      applyControls();
      return;
    }
    submitting = value && (screen === "question" || screen === "phrase");
    applyControls();
    if (
      !submitting &&
      isOpen &&
      (screen === "question" || screen === "phrase") &&
      document.activeElement !== answerInput
    ) {
      answerInput.focus({ preventScroll: true });
    }
  }

  function showFeedback(kind: FeedbackKind, message: string) {
    const text = (message || "").trim();
    if (!text) {
      feedback.textContent = "";
      delete feedback.dataset.kind;
      feedback.classList.remove("is-fresh");
      return;
    }
    const safeKind: FeedbackKind = FEEDBACK_KINDS.has(kind) ? kind : "info";
    // Alternar um caractere invisível força leitores de tela a repetirem a mesma mensagem.
    feedback.textContent = feedback.textContent === text ? text + ZERO_WIDTH : text;
    feedback.dataset.kind = safeKind;
    replay(feedback, "is-fresh");
    if (safeKind === "correct") replay(card, "flash-correct", "shake");
    else if (safeKind === "incorrect") replay(card, "shake", "flash-correct");
  }

  function setIntensity(level: number) {
    const value = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
    challenge.style.setProperty("--intensity", value.toFixed(3));
    const bucket = String(Math.min(4, Math.floor(value * 5)));
    if (challenge.dataset.level !== bucket) challenge.dataset.level = bucket;
  }

  function showAudioBlocked(show: boolean) {
    const wasHidden = audioBlocked.hidden;
    audioBlocked.hidden = !show;
    // Captchas com tempo não correm escondidos atrás da camada: recomeçam quando ela sumir.
    if (show && wasHidden && puzzle?.timed && puzzleStarted && !puzzleSent) remountPuzzle();
    if (!show) maybeStartPuzzle();
  }

  function showVictory() {
    stopPuzzle();
    screen = "victory";
    submitting = false;
    const total = progress.childElementCount || 10;
    renderProgress(total, total);
    if (lastSteps) renderSteps(lastSteps, true);
    titleIcon.textContent = "☀️";
    titleText.textContent = "ACORDOU!";
    clearPasteWarning();
    applyStage();
    applyControls();
    announce("Alarme desligado. Bom dia!");
    if (isOpen) victoryTitle.focus({ preventScroll: true });
  }

  resetChallenge();
  renderClock(new Date());

  return {
    renderClock,
    renderAlarms,
    setAlarmsLocked,
    setSoundReady,
    openChallenge,
    closeChallenge,
    showLoading,
    setSteps,
    showPuzzle,
    showQuestion,
    showPhrase,
    setSubmitting,
    showFeedback,
    setIntensity,
    showAudioBlocked,
    showVictory,
  };
}
