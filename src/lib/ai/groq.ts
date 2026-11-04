import type { AiProvider } from "./types";

export function groqProvider(key: string): AiProvider {
  const textModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  // Groq model catalogs change often; set GROQ_VISION_MODEL to enable image tasks on Groq.
  const visionModel = process.env.GROQ_VISION_MODEL;
  return {
    name: "groq",
    async complete({ system, prompt, imageBase64 }) {
      if (imageBase64 && !visionModel) throw new Error("Groq vision model not configured");
      const content = imageBase64
        ? [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ]
        : prompt;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: imageBase64 ? visionModel : textModel,
          temperature: 0.4,
          max_tokens: 1200,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}`);
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!text) throw new Error("Groq returned no text");
      return String(text).trim();
    },
  };
}
