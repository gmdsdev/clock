const TICK_MS = 1000;
const WORKER_WATCHDOG_MS = 2500;

/** Chama `onTick(now)` a cada segundo (Web Worker, com fallback para setInterval). Retorna um `stop`. */
export function startTicker(onTick: (now: number) => void): () => void {
  let worker: Worker | null = null;
  let fallback: ReturnType<typeof setInterval> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let gotMessage = false;

  const tick = () => onTick(Date.now());

  const useFallback = () => {
    clearTimeout(watchdog);
    worker?.terminate();
    worker = null;
    if (fallback === undefined) fallback = setInterval(tick, TICK_MS);
  };

  try {
    worker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", () => {
      gotMessage = true;
      tick();
    });
    worker.addEventListener("error", useFallback);
    watchdog = setTimeout(() => {
      if (!gotMessage) useFallback();
    }, WORKER_WATCHDOG_MS);
  } catch {
    useFallback();
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clearTimeout(watchdog);
    clearInterval(fallback);
    fallback = undefined;
    worker?.terminate();
    worker = null;
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
