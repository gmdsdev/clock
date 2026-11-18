// Workers não sofrem o throttling agressivo de timers de abas em segundo plano.
// Envia Date.now() logo após cada virada de segundo.
const ALIGN_OFFSET_MS = 5;

function schedule(): void {
  const delay = 1000 - (Date.now() % 1000) + ALIGN_OFFSET_MS;
  setTimeout(() => {
    postMessage(Date.now());
    schedule();
  }, delay);
}

schedule();
