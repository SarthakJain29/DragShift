import { extOf, kindOf, type Kind } from "./files";

export interface MenuItem {
  label: string;
  key: string; // "convert:PNG" | "tool:Compress" | "ai:Summarize"
  glyph: string;
  hint: string;
}
export interface Ring {
  name: "Convert" | "Tools" | "AI";
  items: MenuItem[];
}

export const IMAGE_TARGETS = ["PNG", "JPG", "WEBP"] as const;

const FORMAT_HINTS: Record<string, string> = {
  JPG: "Small, universal", PNG: "Lossless · transparency", WEBP: "Smallest for web",
  PDF: "Document", TXT: "Plain text", DOCX: "Editable Word",
};
const TOOLS: Record<string, { glyph: string; hint: string }> = {
  Compress: { glyph: "⇲", hint: "Shrink file size" },
  Resize: { glyph: "⤢", hint: "Change dimensions" },
  Split: { glyph: "✂", hint: "One PDF per page" },
  Rotate: { glyph: "⟳", hint: "Turn pages 90°" },
  Merge: { glyph: "⧉", hint: "Join into one PDF" },
};
const AI_ITEMS: Record<string, { glyph: string; hint: string }> = {
  Summarize: { glyph: "✦", hint: "Key points in seconds" },
  Rename: { glyph: "✎", hint: "Smart file name" },
  "Alt text": { glyph: "◐", hint: "Describe the image" },
  Suggest: { glyph: "☄", hint: "What should I do with this?" },
};

export function formatName(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "JPG";
  return e.toUpperCase();
}

export function convertTargets(kind: Kind, ext: string): string[] {
  switch (kind) {
    case "image": return [...IMAGE_TARGETS.filter((t) => t !== formatName(ext)), "PDF"];
    case "pdf": return ["JPG", "PNG", "TXT"];
    case "docx": return ["PDF", "TXT"];
    case "text": return ["PDF"];
  }
}

function toolNames(kind: Kind, count: number): string[] {
  if (kind === "image") return ["Compress", "Resize"];
  if (kind === "pdf") return count > 1 ? ["Split", "Rotate", "Merge"] : ["Split", "Rotate"];
  return [];
}

function aiNames(kind: Kind): string[] {
  const base = kind === "image" ? ["Alt text"] : ["Summarize"];
  return [...base, "Rename", "Suggest"];
}

/** What the radial menu offers for a set of files. Pure, so it is easy to test. */
export function buildRings(files: { name: string; type?: string }[]): Ring[] {
  const first = files[0];
  const kind = first && kindOf(first);
  if (!kind) return [];
  const same = files.filter((f) => kindOf(f) === kind);
  const convert: MenuItem[] = convertTargets(kind, extOf(first.name)).map((t) => ({
    label: t,
    key: `convert:${t}`,
    glyph: t,
    hint: kind === "image" && t === "PDF" && same.length > 1 ? `${same.length} images → 1 PDF` : FORMAT_HINTS[t] ?? "",
  }));
  const rings: Ring[] = [{ name: "Convert", items: convert }];
  const tools = toolNames(kind, same.length);
  if (tools.length) rings.push({ name: "Tools", items: tools.map((t) => ({ label: t, key: `tool:${t}`, ...TOOLS[t] })) });
  rings.push({ name: "AI", items: aiNames(kind).map((t) => ({ label: t, key: `ai:${t}`, ...AI_ITEMS[t] })) });
  return rings;
}

export function splitKey(key: string): [string, string] {
  const i = key.indexOf(":");
  return [key.slice(0, i), key.slice(i + 1)];
}
