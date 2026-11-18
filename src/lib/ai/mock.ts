import { humanSize, stemOf } from "../files";
import type { AiProvider, AiRequest } from "./types";

const STOP = new Set(
  "the a an and or of to in on for with is are was were be been it this that as at by from we you i they he she not but if then so than too very can will just into about over after before".split(" "),
);

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

export function keywords(text: string, n = 5): string[] {
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

export function slugify(s: string, maxWords = 6): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .slice(0, maxWords)
    .join("-");
}

/** Deterministic, offline stand-ins for the LLM tasks. */
export function mockAnswer(r: AiRequest): string {
  const text = r.text ?? "";
  switch (r.task) {
    case "summarize": {
      const ss = sentences(text);
      if (!ss.length) return "There isn't enough readable text in this file to summarize.";
      const picks = [ss[0], ss[Math.floor(ss.length / 2)], ss[ss.length - 1]].filter((s, i, a) => a.indexOf(s) === i);
      const kw = keywords(text);
      return `TL;DR: ${ss[0]}\n${picks.slice(1).map((s) => `- ${s}`).join("\n")}${kw.length ? `\n- Recurring topics: ${kw.join(", ")}` : ""}`;
    }
    case "rename": {
      const firstLine = text.split("\n").find((l) => l.trim().length > 3) ?? "";
      const slug = slugify(firstLine) || slugify(keywords(text, 4).join(" ")) || slugify(stemOf(r.fileName));
      return slug || "untitled";
    }
    case "alttext": {
      const base = stemOf(r.fileName).replace(/[-_]+/g, " ").replace(/\b(img|dsc|image|photo|screenshot)\b/gi, "").trim();
      const dims = r.imageWidth && r.imageHeight ? `${r.imageWidth}×${r.imageHeight}` : "";
      const orient = r.imageWidth && r.imageHeight ? (r.imageWidth > r.imageHeight ? "landscape" : r.imageWidth < r.imageHeight ? "portrait" : "square") : "";
      return `${[orient, dims].filter(Boolean).join(" ")} image${base ? ` titled “${base}”` : ""} (mock description — add an API key for a real one).`;
    }
    case "suggest": {
      const big = r.sizeBytes > 2 * 1024 * 1024;
      if (r.kind === "image") {
        return big
          ? `Compress it — at ${humanSize(r.sizeBytes)} it is heavy for sharing; compression usually saves 60–80% with no visible loss.`
          : "Convert to WEBP for the web, or to PDF if you need to send it as a document.";
      }
      if (r.kind === "pdf") return big ? "Split it into pages or convert to images — the file is large for emailing." : "Convert to TXT to reuse the text, or Split to send only the pages that matter.";
      return "Convert to PDF for a read-only copy you can share with anyone.";
    }
  }
}

export const mockProvider: AiProvider = {
  name: "mock",
  async complete() {
    throw new Error("mock provider is answered by mockAnswer()");
  },
};
