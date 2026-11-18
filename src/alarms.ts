import type { AlarmView } from "./types.ts";
import type { KeyValueStorage } from "./storage.ts";

export type Alarm = {
  id: string;
  /** "HH:MM" */
  time: string;
  enabled: boolean;
  /** Epoch ms da próxima vez que o alarme toca (relevante só quando `enabled`). */
  nextTriggerAt: number;
};

export const ALARMS_STORAGE_KEY = "clock.alarms.v1";

const MINUTE_MS = 60_000;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** Aceita "7:05", "07:05" ou "07:05:00" e devolve "07:05"; null se inválido. */
export function normalizeTime(input: string): string | null {
  if (typeof input !== "string") return null;
  const match = TIME_PATTERN.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/** Hoje às HH:MM:00 se ainda estiver no futuro; senão amanhã (seguro com horário de verão). */
export function nextOccurrence(time: string, now: number): number {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
    date.setHours(hours, minutes, 0, 0);
  }
  return date.getTime();
}

export function formatRemaining(ms: number): string {
  if (ms < MINUTE_MS) return "menos de 1 min";
  const totalMinutes = Math.ceil(ms / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function alarmLabel(alarm: Alarm, now: number): string {
  if (!alarm.enabled) return "Desativado";
  const remaining = alarm.nextTriggerAt - now;
  if (remaining <= 0) return "Tocando agora";
  return `Toca em ${formatRemaining(remaining)}`;
}

export function isDue(alarm: Alarm, now: number): boolean {
  return alarm.enabled && now >= alarm.nextTriggerAt;
}

/** O aviso "toque para liberar o som" só faz sentido com algum alarme ativo. */
export function isSoundReady(alarms: readonly Alarm[], audioUnlocked: boolean): boolean {
  return audioUnlocked || !alarms.some((alarm) => alarm.enabled);
}

export function sortAlarms(alarms: readonly Alarm[]): Alarm[] {
  return [...alarms].sort((a, b) => a.time.localeCompare(b.time));
}

export function toAlarmViews(alarms: readonly Alarm[], now: number): AlarmView[] {
  return sortAlarms(alarms).map((alarm) => ({
    id: alarm.id,
    time: alarm.time,
    enabled: alarm.enabled,
    label: alarmLabel(alarm, now),
  }));
}

export function parseAlarms(raw: string | null, now: number): Alarm[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const byTime = new Map<string, Alarm>();
  for (const item of data) {
    const alarm = parseAlarm(item, now);
    if (alarm && !byTime.has(alarm.time)) byTime.set(alarm.time, alarm);
  }
  return [...byTime.values()];
}

function parseAlarm(value: unknown, now: number): Alarm | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const time = typeof record.time === "string" ? normalizeTime(record.time) : null;
  if (!time || typeof record.id !== "string" || !record.id) return null;
  const enabled = record.enabled === true;
  const stored = record.nextTriggerAt;
  const nextTriggerAt =
    typeof stored === "number" && Number.isFinite(stored) ? stored : nextOccurrence(time, now);
  return { id: record.id, time, enabled, nextTriggerAt };
}

export type AlarmStoreOptions = {
  storage?: KeyValueStorage | null;
  now?: () => number;
  createId?: () => string;
  key?: string;
};

export type AlarmStore = {
  list(): Alarm[];
  views(now?: number): AlarmView[];
  /** Adiciona (ou reativa o alarme com o mesmo horário). null se o horário for inválido. */
  add(time: string): Alarm | null;
  toggle(id: string): Alarm | null;
  remove(id: string): boolean;
  /** Alarmes ativos cujo horário já chegou (inclui os perdidos com a aba fechada). */
  due(now?: number): Alarm[];
  /** One-shot: depois de tocar, o alarme fica desativado. */
  markFired(ids: readonly string[]): void;
};

function defaultId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `alarm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createAlarmStore(options: AlarmStoreOptions = {}): AlarmStore {
  const storage = options.storage ?? null;
  const clock = options.now ?? Date.now;
  const createId = options.createId ?? defaultId;
  const key = options.key ?? ALARMS_STORAGE_KEY;

  let alarms = parseAlarms(read(), clock());

  function read(): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function save(): void {
    try {
      storage?.setItem(key, JSON.stringify(alarms));
    } catch {
      // Sem storage o app continua funcionando, só não persiste.
    }
  }

  const copy = (alarm: Alarm): Alarm => ({ ...alarm });

  return {
    list: () => sortAlarms(alarms).map(copy),

    views: (now = clock()) => toAlarmViews(alarms, now),

    add(time) {
      const normalized = normalizeTime(time);
      if (!normalized) return null;
      const nextTriggerAt = nextOccurrence(normalized, clock());
      const existing = alarms.find((alarm) => alarm.time === normalized);
      if (existing) {
        existing.enabled = true;
        existing.nextTriggerAt = nextTriggerAt;
        save();
        return copy(existing);
      }
      const alarm: Alarm = { id: createId(), time: normalized, enabled: true, nextTriggerAt };
      alarms = [...alarms, alarm];
      save();
      return copy(alarm);
    },

    toggle(id) {
      const alarm = alarms.find((item) => item.id === id);
      if (!alarm) return null;
      alarm.enabled = !alarm.enabled;
      if (alarm.enabled) alarm.nextTriggerAt = nextOccurrence(alarm.time, clock());
      save();
      return copy(alarm);
    },

    remove(id) {
      const before = alarms.length;
      alarms = alarms.filter((alarm) => alarm.id !== id);
      if (alarms.length === before) return false;
      save();
      return true;
    },

    due: (now = clock()) => alarms.filter((alarm) => isDue(alarm, now)).map(copy),

    markFired(ids) {
      let changed = false;
      for (const alarm of alarms) {
        if (alarm.enabled && ids.includes(alarm.id)) {
          alarm.enabled = false;
          changed = true;
        }
      }
      if (changed) save();
    },
  };
}
