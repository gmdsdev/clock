import { checkAnswer, generateQuestion } from "./gpt";
import "./style.css";

const step = {
  prompt:
    "Escolha uma pessoa aleatória e famosa no Brasil e pergunte em que ano ela nasceu",
  question: "",
};

window.onload = () => {
  const formClock = document.querySelector("#clock");
  const formQuetion = document.querySelector("#question");
  const input = document.querySelector("input");

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

      const exp: HTMLHeadElement | null =
        document.querySelector("#question h2");

      if (exp) {
        exp.innerHTML = step.question;
      }
    }
  };

  formClock?.addEventListener("submit", (e) => {
    e.preventDefault();

    clearInterval(timer);

    timer = setInterval(tick, 1000);
  });

  formQuetion?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const answer: HTMLInputElement | null =
      document.querySelector("#question input");

    if (!answer?.value) {
      return;
    }

    const a = await checkAnswer(step.question, answer.value);

    console.log(a);
  });
};
