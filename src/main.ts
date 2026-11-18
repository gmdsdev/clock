import { checkAnswer, generateQuestion } from "./gpt";
import "./style.css";

const step = {
  prompt:
    "Escolha uma pessoa aleatória e famosa no Brasil e pergunte em que ano ela nasceu",
  question: "",
};

const questions = [
  "Escolha uma pessoa aleatória e famosa no Brasil e pergunte em que ano ela nasceu",
  "Escolha um produto da Apple de forma aleatória e pergunte o valor do produto na época de seu lançamento",
  "Escolha uma capital do Brasil e pergunte quantos habitantes a cidade possui",
];

window.onload = () => {
  const formClock = document.querySelector("#clock");
  const formQuestion = document.querySelector("#formQuestion");
  const input = document.querySelector("input");
  const questionModal = new bootstrap.Modal("#question", {});

  let timer: number;

  const getCurrentHourAndTime = () => {
    const currentClock = new Date();

    const [hour, minute] = input?.value.split(":") as String[];

    return {
      currentClock,
      hour: Number(hour),
      minute: Number(minute),
    };
  };

  const tick = async () => {
    const currentTime = new Date();

    const { hour, minute, currentClock } = getCurrentHourAndTime();

    currentClock.setHours(hour);
    currentClock.setMinutes(minute);

    if (currentTime >= currentClock) {
      clearInterval(timer);

      const data = await generateQuestion(step.prompt);
      step.question = data.text;

      (questionModal as any)?.show();

      const questionLabel: HTMLHeadElement | null =
        document.querySelector("#questionLabel");

      if (questionLabel) {
        questionLabel.innerHTML = step.question;
      }
    }
  };

  formClock?.addEventListener("submit", (e) => {
    e.preventDefault();

    clearInterval(timer);
    setClockList();

    timer = setInterval(tick, 1000);
  });

  formQuestion?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const answer: HTMLTextAreaElement | null =
      formQuestion.querySelector("textarea");

    if (!answer?.value) {
      return;
    }

    const { status } = await checkAnswer(step.question, answer.value);

    if (status === "incorrect") {
      alert("Incorreto");
    } else {
      alert("Correto");
    }
  });

  function setClockList() {
    const [hour, minute] = input?.value.split(":") as String[];
    const alartmClockList = document.querySelector(".alarm-clock-list");
    alartmClockList!.innerHTML += `<div>${hour}:${minute}</div>`;
    alartmClockList?.classList.remove("hide");
  }

  function setTime() {
    const clockHeader = document.querySelector(".js-clock");
    if (clockHeader) {
      const horaAtual = new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      clockHeader.innerHTML = horaAtual;
    }
  }

  setTime();
  setTimeout(() => {
    setTime();
  }, 1000);
};
