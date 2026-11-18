const ALERT_TITLE = "⏰ ACORDA!";
const PULSE_MS = 1000;
const VIBRATION_PATTERN = [400, 120, 400, 120, 800];

/**
 * Título da aba piscando + vibração repetida (quando suportada) enquanto o alarme toca.
 * O título base é capturado na criação, antes de a UI trocá-lo ao abrir o desafio.
 */
export function createAttention(originalTitle = document.title): { start(): void; stop(): void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pulses = 0;

  const vibrate = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Sem suporte ou sem gesto prévio.
    }
  };

  const pulse = () => {
    pulses += 1;
    const alert = pulses % 2 === 1;
    document.title = alert ? ALERT_TITLE : originalTitle;
    if (alert) vibrate(VIBRATION_PATTERN);
  };

  return {
    start() {
      if (timer !== undefined) return;
      pulses = 0;
      pulse();
      timer = setInterval(pulse, PULSE_MS);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
      document.title = originalTitle;
      vibrate(0);
    },
  };
}
