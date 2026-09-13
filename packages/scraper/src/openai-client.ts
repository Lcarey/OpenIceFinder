import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import OpenAI from "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

const REQUEST_TIMEOUT_MS = 120_000;

let cachedKey: string | undefined;

/** Reads the API key from the environment or, in Lambda, from Secrets Manager (cached per container). */
export async function resolveOpenAiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const direct = process.env.OPENAI_API_KEY?.trim();
  if (direct) {
    cachedKey = direct;
    return direct;
  }
  const secretArn = process.env.OPENAI_API_KEY_SECRET_ARN;
  if (!secretArn) throw new Error("OPENAI_API_KEY or OPENAI_API_KEY_SECRET_ARN must be set");
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = res.SecretString?.trim();
  if (!value || value === "placeholder") throw new Error("OpenAI API key secret is empty; run deploy.sh with OPENAI_API_KEY set");
  cachedKey = value;
  return value;
}

export function openAiClientProvider(): () => Promise<OpenAI> {
  let client: OpenAI | undefined;
  return async () => {
    if (client) return client;
    const apiKey = await resolveOpenAiKey();
    client = new OpenAI({ apiKey, maxRetries: 2, timeout: REQUEST_TIMEOUT_MS });
    return client;
  };
}
