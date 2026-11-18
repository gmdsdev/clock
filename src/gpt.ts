import OpenAI from "openai";
const client = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAPI_KEY,
  dangerouslyAllowBrowser: true,
});

type GPTResponse = {
  status: "correct" | "incorrect" | "question";
  text: "";
};

const expectedReponse = `
type Reponse = {
  status: "correct" | "incorrect" | "question";
  text: "";
};
`;

export const generateQuestion = async (prompt: string) => {
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: "Gere a questão",
    prompt_cache_key: String(new Date().toUTCString()),
    instructions: `
    ${prompt}
    O retorno deve conter apenas o dado dentro do campo \`text\` e o status como "question".
    Utilize o seguinte padrão para resposta, porém, em formato JSON:
    ${expectedReponse}`,
  });

  return JSON.parse(response.output_text) as GPTResponse;
};

export const checkAnswer = async (question: string, input: string) => {
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: `
    Pergunta: ${question}
    Resposta: ${input}
    `,
    instructions: `
    No campo text, informe apenas: "Acertou" ou "Errou" baseado no instrução acima.
    Utilize o seguinte padrão para resposta, porém, em formato JSON:
    ${expectedReponse}`,
  });

  return JSON.parse(response.output_text) as GPTResponse;
};
