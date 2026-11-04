import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { mockAnswer } from "./mock";
import { SYSTEM, buildPrompt } from "./prompts";
import type { AiProvider, AiRequest, AiResult, ProviderName } from "./types";

type Env = Record<string, string | undefined>;

/** Providers that are configured, in preference order. Mock is not listed: it is the final fallback. */
export function configuredProviders(env: Env = process.env): AiProvider[] {
  const all: AiProvider[] = [];
  if (env.GEMINI_API_KEY) all.push(geminiProvider(env.GEMINI_API_KEY));
  if (env.GROQ_API_KEY) all.push(groqProvider(env.GROQ_API_KEY));
  const pref = (env.AI_PROVIDER || "").toLowerCase();
  if (pref === "mock") return [];
  return all.sort((a, b) => Number(b.name === pref) - Number(a.name === pref));
}

export function activeProviderName(env: Env = process.env): ProviderName {
  return configuredProviders(env)[0]?.name ?? "mock";
}

/** Clean up model output for specific tasks. */
export function postProcess(task: AiRequest["task"], s: string): string {
  const t = s.trim();
  if (task === "rename") return t.split("\n")[0].toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return t;
}

/**
 * Run an AI task. Tries each configured provider in order; if none work (or none are configured)
 * the deterministic mock answers, so the app never breaks without keys.
 */
export async function runAi(req: AiRequest, providers: AiProvider[] = configuredProviders()): Promise<AiResult> {
  let lastError = "";
  for (const p of providers) {
    try {
      const out = await p.complete({
        system: SYSTEM,
        prompt: buildPrompt(req),
        imageBase64: req.task === "alttext" ? req.imageBase64 : undefined,
      });
      return { text: postProcess(req.task, out), provider: p.name, fallback: false };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "unknown error";
    }
  }
  return {
    text: postProcess(req.task, mockAnswer(req)),
    provider: "mock",
    fallback: providers.length > 0,
    note: providers.length > 0 ? `Live AI unavailable (${lastError}); showing offline result.` : undefined,
  };
}
