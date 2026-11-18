/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave da OpenAI. Sem ela o app usa o modo mock (banco offline). */
  readonly VITE_OPENAPI_KEY: string;
  /** Modelo da Responses API. Padrão: "gpt-5.2". */
  readonly VITE_OPENAI_MODEL?: string;
  /** "true" para nunca chamar a API. */
  readonly VITE_MOCK_AI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
