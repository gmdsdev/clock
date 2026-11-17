import "./style.css";

/**
 * Ideias:
 *
 * escrever o horário em números romanos
 * 2FA via email
 * Pagamento via polar.sh
 */

window.onload = () => {
  const form = document.querySelector("form");
  const input = document.querySelector("input");

  let timer: number;

  const tick = () => {
    const currentTime = new Date();
    const currentClock = new Date();

    const [hour, minute] = input?.value.split(":") as String[];

    currentClock.setHours(Number(hour));
    currentClock.setMinutes(Number(minute));

    if (currentTime >= currentClock) {
      alert("Acorda");
      clearInterval(timer);
    }
  };

  form?.addEventListener("submit", (e) => {
    e.preventDefault();

    clearInterval(timer);

    tick();
    timer = setInterval(tick, 1000);
  });
};
