import "./style.css";
import { createAlarmStore, isSoundReady } from "./alarms.ts";
import { createAttention } from "./attention.ts";
import { createChallenge } from "./challenge.ts";
import { checkAnswer, generateQuestion } from "./gpt.ts";
import { checkPhrase, checkPuzzle, createPuzzle, PHRASE_HINT, pickPhrase } from "./puzzle.ts";
import type { Puzzle } from "./puzzle.ts";
import { createAlarmSound } from "./sound.ts";
import { getBrowserStorage } from "./storage.ts";
import { startTicker } from "./ticker.ts";
import { createUI } from "./ui.ts";

const storage = getBrowserStorage();
const alarms = createAlarmStore({ storage });
const sound = createAlarmSound();
const attention = createAttention();
let renderedAlarms = "";
let shownSoundReady: boolean | null = null;

const ui = createUI({
  onAddAlarm: (time) => changeAlarms(() => alarms.add(time)),
  onToggleAlarm: (id) => changeAlarms(() => alarms.toggle(id)),
  onDeleteAlarm: (id) => changeAlarms(() => alarms.remove(id)),
  onSubmitAnswer: (answer) => void challenge.submit(answer),
  onSubmitPuzzle: (puzzleId, answer) => challenge.submitPuzzle(puzzleId, answer),
});

const challenge = createChallenge({
  ui,
  sound,
  generateQuestion,
  checkAnswer,
  createPuzzle,
  // O captcha salvo sempre veio de createPuzzle (persistido como JSON).
  checkPuzzle: (puzzle, answer) => checkPuzzle(puzzle as Puzzle, answer),
  pickPhrase: () => pickPhrase(),
  checkPhrase,
  phraseHint: PHRASE_HINT,
  storage,
  onActiveChange: setRinging,
});

/** Uma falha pontual (UI, storage) não pode derrubar o relógio, os alarmes nem o som. */
function safely(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`[main] ${label} falhou`, error);
  }
}

function changeAlarms(change: () => unknown): void {
  if (challenge.isActive()) {
    safely("setAlarmsLocked", () => ui.setAlarmsLocked(true));
    return;
  }
  change();
  refreshAlarms(Date.now(), true);
  refreshSoundReady();
}

function refreshAlarms(now: number, force = false): void {
  const views = alarms.views(now);
  const signature = JSON.stringify(views);
  if (!force && signature === renderedAlarms) return;
  renderedAlarms = signature;
  ui.renderAlarms(views);
}

/** Com alarme ativo e áudio ainda não liberado, a tela principal pede um toque. */
function refreshSoundReady(): void {
  const ready = isSoundReady(alarms.list(), sound.isReady());
  if (ready === shownSoundReady) return;
  shownSoundReady = ready;
  safely("setSoundReady", () => ui.setSoundReady(ready));
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // Navegadores antigos só mostram o aviso com returnValue preenchido.
  event.returnValue = "O alarme ainda está tocando.";
}

function setRinging(active: boolean): void {
  if (active) {
    window.addEventListener("beforeunload", onBeforeUnload);
    attention.start();
  } else {
    window.removeEventListener("beforeunload", onBeforeUnload);
    attention.stop();
  }
}

function handleTick(now: number): void {
  safely("renderClock", () => ui.renderClock(new Date(now)));
  safely("disparo de alarmes", () => {
    const due = alarms.due(now);
    if (due.length === 0) return;
    const ids = due.map((alarm) => alarm.id);
    challenge.start(ids);
    alarms.markFired(ids);
    refreshSoundReady();
  });
  safely("lista de alarmes", () => refreshAlarms(now));
}

sound.onLevel((level) => ui.setIntensity(level));
sound.onBlockedChange((blocked) => ui.showAudioBlocked(blocked));
sound.onReadyChange(() => refreshSoundReady());

// Qualquer gesto libera o áudio para que o alarme toque depois sem interação.
const unlockAudio = () => void sound.unlock();
for (const type of ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const) {
  document.addEventListener(type, unlockAudio, { capture: true, passive: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") safely("setSoundReady", refreshSoundReady);
});

safely("lista de alarmes", () => refreshAlarms(Date.now(), true));
safely("retomada do desafio", () => void challenge.resume());
safely("setSoundReady", refreshSoundReady);
handleTick(Date.now());
startTicker(handleTick);
