export type LevelConfig = {
  /** Nível inicial (0..1). */
  base: number;
  /** Teto da parte do tempo; o que sobra até 1 fica reservado para os erros. */
  timeMax: number;
  /** Tempo para a parte do tempo ir de `base` até `timeMax`. */
  rampMs: number;
  /** Quanto cada erro soma ao nível. */
  step: number;
};

export const DEFAULT_LEVEL_CONFIG: LevelConfig = { base: 0.35, timeMax: 0.7, rampMs: 180_000, step: 0.06 };

const timePart = (elapsedMs: number, config: LevelConfig) =>
  config.base + (config.timeMax - config.base) * Math.min(1, Math.max(0, elapsedMs) / config.rampMs);

export function computeLevel(
  elapsedMs: number,
  escalations: number,
  config: LevelConfig = DEFAULT_LEVEL_CONFIG,
): number {
  return Math.min(1, timePart(elapsedMs, config) + Math.max(0, escalations) * config.step);
}

/**
 * Trajetória a partir de agora: o nível sobe em linha reta (só pelo tempo) até `end`
 * em `secondsToEnd` e fica parado até o próximo erro.
 */
export function levelTrajectory(
  elapsedMs: number,
  escalations: number,
  config: LevelConfig = DEFAULT_LEVEL_CONFIG,
): { level: number; end: number; secondsToEnd: number } {
  const level = computeLevel(elapsedMs, escalations, config);
  const end = computeLevel(Number.POSITIVE_INFINITY, escalations, config);
  const slopePerSecond = (config.timeMax - config.base) / (config.rampMs / 1000);
  const secondsToEnd = end > level && slopePerSecond > 0 ? (end - level) / slopePerSecond : 0;
  return { level, end, secondsToEnd };
}

export type SoundStartOptions = {
  /** Epoch ms do início do toque (permite manter a intensidade após recarregar). */
  startedAt?: number;
  /** Erros já cometidos na sessão. */
  escalations?: number;
};

export type AlarmSound = {
  /** Cria/retoma o AudioContext. Chamar dentro de um gesto do usuário. */
  unlock(): Promise<boolean>;
  start(options?: SoundStartOptions): void;
  stop(): void;
  escalate(): void;
  isRunning(): boolean;
  isBlocked(): boolean;
  /** true quando o AudioContext existe e está "running": um alarme futuro vai tocar sem gesto. */
  isReady(): boolean;
  getLevel(): number;
  onLevel(listener: (level: number) => void): () => void;
  onBlockedChange(listener: (blocked: boolean) => void): () => void;
  onReadyChange(listener: (ready: boolean) => void): () => void;
};

// --- Síntese (pura, sem Web Audio) ---------------------------------------

/** Duração de um ciclo; 1,25 Hz × inteiro fecha ciclos exatos, então o loop não estala. */
export const CYCLE_SECONDS = 0.8;

const saw = (phase: number) => 2 * (phase - Math.floor(phase)) - 1;
const square = (phase: number) => (phase - Math.floor(phase) < 0.5 ? 1 : -1);

/** Bip-bip-bip-bip agressivo alternando 880/1320 Hz, seguido de pausa curta. */
export function synthesizeBeeps(sampleRate: number): Float32Array {
  const length = Math.round(CYCLE_SECONDS * sampleRate);
  const data = new Float32Array(length);
  const duration = 0.09;
  const edge = 0.003;
  const beeps = [
    { at: 0, freq: 880, wave: square },
    { at: 0.13, freq: 1320, wave: saw },
    { at: 0.26, freq: 880, wave: square },
    { at: 0.39, freq: 1320, wave: saw },
  ];
  for (const { at, freq, wave } of beeps) {
    const from = Math.round(at * sampleRate);
    const to = Math.min(length, Math.round((at + duration) * sampleRate));
    for (let i = from; i < to; i++) {
      const t = (i - from) / sampleRate;
      const envelope = Math.min(1, t / edge, (duration - t) / edge);
      data[i] = wave(freq * t) * 0.55 * envelope;
    }
  }
  return data;
}

/** Camada dissonante (segunda menor em dente de serra, picotada a 12,5 Hz). */
export function synthesizeHarsh(sampleRate: number): Float32Array {
  const length = Math.round(CYCLE_SECONDS * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const gate = (12.5 * t) % 1 < 0.6 ? 1 : 0;
    data[i] = (saw(1480 * t) + saw(1567.5 * t)) * 0.28 * gate;
  }
  return data;
}

/** "Buzzer" de erro, tocado uma vez a cada resposta errada. */
export function synthesizeBuzz(sampleRate: number): Float32Array {
  const duration = 0.35;
  const length = Math.round(duration * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / 0.005, (duration - t) / 0.04);
    data[i] = (saw(110 * t) + saw(116.5 * t) + square(233 * t) * 0.6) * 0.3 * envelope;
  }
  return data;
}

// --- Curvas de automação --------------------------------------------------

type Curve = ReadonlyArray<readonly [level: number, value: number]>;

const MASTER_CURVE: Curve = [
  [0, 0],
  [1, 1],
];
// Como o tempo só leva o nível até ~0,7, o trecho final (andamento e dissonância) vem dos erros.
const RATE_CURVE: Curve = [
  [0, 0.9],
  [0.7, 1.15],
  [1, 1.5],
];
const HARSH_CURVE: Curve = [
  [0, 0],
  [0.5, 0],
  [0.7, 0.25],
  [1, 0.9],
];

export const CURVES = { master: MASTER_CURVE, rate: RATE_CURVE, harsh: HARSH_CURVE } as const;

export function curveValue(curve: Curve, level: number): number {
  if (level <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [l1, v1] = curve[i];
    if (level <= l1) {
      const [l0, v0] = curve[i - 1];
      return v0 + ((v1 - v0) * (level - l0)) / (l1 - l0);
    }
  }
  return curve[curve.length - 1][1];
}

// --- Motor Web Audio -------------------------------------------------------

const SMOOTHING_SECONDS = 0.08;
const LEVEL_EMIT_INTERVAL_MS = 250;
const RESUME_TIMEOUT_MS = 400;
const UNLOCK_TIMEOUT_MS = 1000;

type Graph = {
  master: GainNode;
  beeps: AudioBufferSourceNode;
  harsh: AudioBufferSourceNode;
  harshGain: GainNode;
};

type Buffers = { beeps: AudioBuffer; harsh: AudioBuffer; buzz: AudioBuffer };

function getAudioContextClass(): typeof AudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** iOS: categoria "playback" faz o Web Audio ignorar a chave de silencioso. */
function preferPlaybackSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch {
    // Não suportado.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  return buffer;
}

export function createAlarmSound(
  options: { config?: Partial<LevelConfig>; now?: () => number } = {},
): AlarmSound {
  const config: LevelConfig = { ...DEFAULT_LEVEL_CONFIG, ...options.config };
  const now = options.now ?? Date.now;

  let context: AudioContext | null = null;
  let output: AudioNode | null = null;
  let buffers: Buffers | null = null;
  let graph: Graph | null = null;

  let running = false;
  let blocked = false;
  let resuming = false;
  let startedAt = 0;
  let escalations = 0;
  let lastEmitted = -1;
  let lastReady = false;
  let levelTimer: ReturnType<typeof setInterval> | undefined;

  const levelListeners = new Set<(level: number) => void>();
  const blockedListeners = new Set<(blocked: boolean) => void>();
  const readyListeners = new Set<(ready: boolean) => void>();

  /** Um ouvinte com erro (ex.: UI) nunca pode impedir o som de tocar. */
  function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        console.error("[sound] ouvinte falhou", error);
      }
    }
  }

  const isReady = () => context !== null && context.state === "running";

  function emitReady(): void {
    const ready = isReady();
    if (ready === lastReady) return;
    lastReady = ready;
    notify(readyListeners, ready);
  }

  function getLevel(): number {
    return running ? computeLevel(now() - startedAt, escalations, config) : 0;
  }

  function emitLevel(force = false): void {
    const level = getLevel();
    if (!force && Math.abs(level - lastEmitted) < 0.005) return;
    lastEmitted = level;
    notify(levelListeners, level);
  }

  function setBlocked(value: boolean): void {
    if (blocked === value) return;
    blocked = value;
    notify(blockedListeners, value);
  }

  function ensureContext(): AudioContext | null {
    if (context && context.state !== "closed") return context;
    const Ctor = getAudioContextClass();
    if (!Ctor) return null;
    preferPlaybackSession();
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 3;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);
    ctx.addEventListener("statechange", () => handleStateChange(ctx));
    context = ctx;
    output = compressor;
    buffers = null;
    graph = null;
    emitReady();
    return ctx;
  }

  function getBuffers(ctx: AudioContext): Buffers {
    buffers ??= {
      beeps: toBuffer(ctx, synthesizeBeeps(ctx.sampleRate)),
      harsh: toBuffer(ctx, synthesizeHarsh(ctx.sampleRate)),
      buzz: toBuffer(ctx, synthesizeBuzz(ctx.sampleRate)),
    };
    return buffers;
  }

  function buildGraph(ctx: AudioContext, destination: AudioNode): Graph {
    const { beeps: beepBuffer, harsh: harshBuffer } = getBuffers(ctx);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(destination);

    const beeps = ctx.createBufferSource();
    beeps.buffer = beepBuffer;
    beeps.loop = true;
    beeps.connect(master);

    const harshGain = ctx.createGain();
    harshGain.gain.value = 0;
    harshGain.connect(master);

    const harsh = ctx.createBufferSource();
    harsh.buffer = harshBuffer;
    harsh.loop = true;
    harsh.connect(harshGain);

    beeps.start();
    harsh.start();
    return { master, beeps, harsh, harshGain };
  }

  function ensureGraph(ctx: AudioContext): void {
    if (!graph && output) graph = buildGraph(ctx, output);
  }

  type Trajectory = ReturnType<typeof levelTrajectory>;

  /** Agenda as rampas na linha do tempo do áudio: sobe sozinho sem depender de timers. */
  function automate(param: AudioParam, curve: Curve, path: Trajectory, t: number): void {
    const { level, end, secondsToEnd } = path;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    const from = t + SMOOTHING_SECONDS;
    param.linearRampToValueAtTime(curveValue(curve, level), from);
    if (secondsToEnd <= 0) return;
    const perSecond = (end - level) / secondsToEnd;
    for (const [pointLevel, value] of curve) {
      if (pointLevel > level && pointLevel < end) {
        param.linearRampToValueAtTime(value, from + (pointLevel - level) / perSecond);
      }
    }
    param.linearRampToValueAtTime(curveValue(curve, end), from + secondsToEnd);
  }

  function scheduleCurves(): void {
    if (!context || !graph || !running) return;
    const t = context.currentTime;
    const path = levelTrajectory(now() - startedAt, escalations, config);
    automate(graph.master.gain, MASTER_CURVE, path, t);
    automate(graph.beeps.playbackRate, RATE_CURVE, path, t);
    automate(graph.harsh.playbackRate, RATE_CURVE, path, t);
    automate(graph.harshGain.gain, HARSH_CURVE, path, t);
  }

  function playBuzz(): void {
    if (!context || !graph) return;
    const source = context.createBufferSource();
    source.buffer = getBuffers(context).buzz;
    source.connect(graph.master);
    source.start();
  }

  async function tryResume(): Promise<void> {
    const ctx = context;
    if (!ctx || resuming) return;
    resuming = true;
    try {
      // Sem gesto, o Chrome deixa a promise pendente para sempre: por isso o timeout.
      await withTimeout(ctx.resume(), RESUME_TIMEOUT_MS);
    } catch {
      // Safari rejeita quando não há gesto.
    } finally {
      resuming = false;
    }
    emitReady();
    if (!running || ctx !== context) return;
    const isRunning = ctx.state === "running";
    setBlocked(!isRunning);
    if (isRunning) scheduleCurves();
  }

  function handleStateChange(ctx: AudioContext): void {
    if (ctx !== context) return;
    if (ctx.state === "closed") {
      context = null;
      output = null;
      graph = null;
    }
    emitReady();
    if (!running) return;
    if (ctx.state === "running") {
      setBlocked(false);
      scheduleCurves();
    } else if (ctx.state === "closed") {
      setBlocked(true);
    } else {
      // "suspended" ou "interrupted" (iOS): tenta voltar sozinho.
      void tryResume();
    }
  }

  /** iOS antigo só libera o áudio depois de tocar algo dentro do gesto (1 amostra de silêncio, inaudível). */
  function primeSilence(ctx: AudioContext): void {
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start();
    } catch {
      // Ignora.
    }
  }

  return {
    async unlock() {
      // Tudo que libera o áudio acontece de forma síncrona, ainda dentro do gesto.
      const ctx = ensureContext();
      if (!ctx) return false;
      if (ctx.state !== "running") {
        primeSilence(ctx);
        try {
          await withTimeout(ctx.resume(), UNLOCK_TIMEOUT_MS);
        } catch {
          // Continua bloqueado.
        }
      }
      emitReady();
      const isRunning = ctx.state === "running";
      if (running && ctx === context) {
        ensureGraph(ctx);
        if (isRunning) scheduleCurves();
        setBlocked(!isRunning);
      }
      return isRunning;
    },

    start(startOptions = {}) {
      startedAt = startOptions.startedAt ?? now();
      escalations = startOptions.escalations ?? 0;
      if (!running) {
        running = true;
        levelTimer = setInterval(() => emitLevel(), LEVEL_EMIT_INTERVAL_MS);
      }
      emitLevel(true);
      const ctx = ensureContext();
      if (!ctx) return;
      ensureGraph(ctx);
      scheduleCurves();
      if (ctx.state === "running") setBlocked(false);
      else void tryResume();
    },

    stop() {
      if (!running) return;
      running = false;
      clearInterval(levelTimer);
      levelTimer = undefined;
      const current = graph;
      graph = null;
      if (current && context) {
        const t = context.currentTime;
        const gain = current.master.gain;
        gain.cancelScheduledValues(t);
        gain.setValueAtTime(gain.value, t);
        gain.linearRampToValueAtTime(0, t + 0.06);
        try {
          current.beeps.stop(t + 0.08);
          current.harsh.stop(t + 0.08);
        } catch {
          // Já parado.
        }
        setTimeout(() => current.master.disconnect(), 250);
      }
      setBlocked(false);
      emitLevel(true);
    },

    escalate() {
      if (!running) return;
      escalations += 1;
      emitLevel(true);
      scheduleCurves();
      playBuzz();
    },

    isRunning: () => running,
    isBlocked: () => blocked,
    isReady,
    getLevel,

    onLevel(listener) {
      levelListeners.add(listener);
      return () => levelListeners.delete(listener);
    },

    onBlockedChange(listener) {
      blockedListeners.add(listener);
      return () => blockedListeners.delete(listener);
    },

    onReadyChange(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
  };
}
