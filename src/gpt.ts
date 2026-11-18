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
    instructions: `
    ${prompt}
    O retorno deve conter apenas o dado dentro do campo \`text\` e o status como "question".
    Utilize o seguinte padrão para resposta, porém, em formato JSON:
    ${expectedReponse}`,
  });

  return JSON.parse(response.output_text) as GPTResponse;
};

export const checkAnswer = async (expected: string, input: string) => {
  const response = await client.responses.create({
    model: "gpt-5.2",
    input,
    instructions: `
    Data o seguinte valor: ${expected}, verifique se o input bate com o valor.
    No campo text, informe apenas: "Acertou" ou "Errou".
    Utilize o seguinte padrão para resposta, porém, em formato JSON:
    ${expectedReponse}`,
  });

  return JSON.parse(response.output_text) as GPTResponse;
};
