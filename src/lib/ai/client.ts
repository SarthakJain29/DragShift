import { UserError, kindOf } from "../files";
import type { AiRequest, AiResult, AiTask } from "./types";

export interface AiOutcome extends AiResult {
  title: string;
}

const TASK_BY_LABEL: Record<string, { task: AiTask; title: string }> = {
  Summarize: { task: "summarize", title: "Summary" },
  Rename: { task: "rename", title: "Suggested name" },
  "Alt text": { task: "alttext", title: "Alt text" },
  Suggest: { task: "suggest", title: "Suggestion" },
};

/** Downscale to ≤768px JPEG and return base64 (keeps the request tiny). */
export async function imageForAi(file: File): Promise<{ b64: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const dims = { w: bmp.width, h: bmp.height };
  bmp.close();
  const url = c.toDataURL("image/jpeg", 0.8);
  return { b64: url.split(",")[1], ...dims };
}

export async function runAiForFile(
  label: string,
  file: File,
  extractText: (f: File) => Promise<string | undefined>,
): Promise<AiOutcome> {
  const def = TASK_BY_LABEL[label];
  const kind = kindOf(file);
  if (!def || !kind) throw new UserError("Unknown AI action.");
  const body: AiRequest = { task: def.task, fileName: file.name, kind, sizeBytes: file.size };
  if (kind === "image") {
    try {
      const img = await imageForAi(file);
      body.imageBase64 = img.b64;
      body.imageWidth = img.w;
      body.imageHeight = img.h;
    } catch {
      throw new UserError(`Couldn't read ${file.name} as an image.`);
    }
  } else {
    body.text = await extractText(file);
  }
  let res: Response;
  try {
    res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new UserError("Couldn't reach the AI endpoint. Check your connection.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new UserError(json.error ?? `AI request failed (${res.status}).`);
  return { ...(json as AiResult), title: def.title };
}
