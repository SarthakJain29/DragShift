export type Kind = "image" | "pdf" | "docx" | "text";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "ico"]);
const TEXT_EXTS = new Set(["txt", "md", "csv", "log", "json", "xml", "html", "htm"]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function stemOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

/** Classify a file by extension (falling back to MIME type). */
export function kindOf(file: { name: string; type?: string }): Kind | null {
  const ext = extOf(file.name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (TEXT_EXTS.has(ext)) return "text";
  const t = file.type ?? "";
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("text/")) return "text";
  return null;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

/** "a.jpg" + "Compressed" -> "a Compressed.jpg" */
export function siblingName(src: string, label: string, ext?: string): string {
  const stem = stemOf(src);
  const e = ext ?? extOf(src);
  const base = label ? `${stem} ${label}` : stem;
  return e ? `${base}.${e}` : base;
}

/** Make `name` unique among `taken`: "a.png" -> "a (1).png" -> "a (2).png" */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const stem = stemOf(name);
  const ext = extOf(name);
  for (let i = 1; ; i++) {
    const cand = ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`;
    if (!set.has(cand)) return cand;
  }
}

/** Percent saved, e.g. 1000 -> 250 = 75. Negative if it grew. */
export function percentSaved(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round((1 - after / before) * 100);
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function friendly(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}
