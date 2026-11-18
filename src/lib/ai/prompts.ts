import type { AiRequest } from "./types";

export const SYSTEM =
  "You are the assistant inside DragShift, a file-conversion tool. Be concise, concrete and never invent facts that are not in the input. Reply in plain text without markdown headings.";

export function buildPrompt(r: AiRequest): string {
  const meta = `File: ${r.fileName} (${r.kind}, ${r.sizeBytes} bytes)`;
  switch (r.task) {
    case "summarize":
      return `${meta}\n\nSummarize this document as a one-sentence TL;DR followed by 3-5 short bullet points starting with "- ".\n\n---\n${r.text ?? ""}`;
    case "rename":
      return `${meta}\n\nSuggest ONE clear, descriptive file name for this file (lowercase words separated by hyphens, no extension, max 6 words). Reply with the name only.\n\n---\n${(r.text ?? "").slice(0, 3000)}`;
    case "alttext":
      return `${meta}\n\nWrite alt text for this image: one sentence, under 125 characters, describing what is visible. Reply with the sentence only.`;
    case "suggest":
      return `${meta}\nAvailable actions: ${r.kind === "image" ? "convert to PNG/JPG/WEBP/PDF, compress, resize" : r.kind === "pdf" ? "convert to JPG/PNG/TXT, split, rotate, merge" : "convert to PDF/TXT"}.\n\nIn two sentences, recommend the single best action for the typical reason someone drops this file in a converter, and why.\n\n---\n${(r.text ?? "").slice(0, 1500)}`;
  }
}
