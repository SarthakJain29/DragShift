import type { AiProvider } from "./types";

export function geminiProvider(key: string, model = process.env.GEMINI_MODEL || "gemini-2.0-flash"): AiProvider {
  return {
    name: "gemini",
    async complete({ system, prompt, imageBase64 }) {
      const parts: object[] = [{ text: prompt }];
      if (imageBase64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) throw new Error("Gemini returned no text");
      return String(text).trim();
    },
  };
}
