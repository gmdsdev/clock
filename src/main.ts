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
  const input = form?.querySelector("input");


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
    setClockList();

    tick();
    timer = setInterval(tick, 1000);
  });

  function setClockList() {
    const [hour, minute] = input?.value.split(":") as String[];
    const alartmClockList = document.querySelector(".alarm-clock-list");
    alartmClockList!.innerHTML += `<div>${hour}:${minute}</div>`
    alartmClockList?.classList.remove("hide");
  }

  function setTime() {
    const clockHeader = document.querySelector(".js-clock");
    if (clockHeader) {
      const horaAtual = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      clockHeader.innerHTML = horaAtual;
    }
  }

  setTime();
  setTimeout(() => {
    setTime();
  }, 1000)
};
