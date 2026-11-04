import { splitKey } from "./actions";
import { compressImage, convertImage, imageDims, resizeImage } from "./convert/image";
import { imagesToPdf, mergePdfs, pdfToImages, pdfToTxt, rotatePdf, splitPdf, textToPdf, pdfText } from "./convert/pdf";
import { readDocx, readText } from "./convert/text";
import type { OutFile } from "./convert/types";
import { UserError, extOf, humanSize, kindOf, percentSaved, siblingName, type Kind } from "./files";
import type { ResizeSpec } from "./resize";
import { runAiForFile, type AiOutcome } from "./ai/client";

export interface JobOptions {
  resize?: ResizeSpec;
  quality?: number; // 0..1
  pdfDpi?: number;
}

export interface JobResult {
  title: string;
  detail: string;
  /** Short green verdict such as "62% smaller". */
  good?: string;
  outs: OutFile[];
  ai?: AiOutcome;
}

const total = (fs: { size: number }[]) => fs.reduce((n, f) => n + f.size, 0);

async function runAction(key: string, files: File[], o: JobOptions): Promise<OutFile[]> {
  const first = files[0];
  const kind = kindOf(first) as Kind;
  const same = files.filter((f) => kindOf(f) === kind);
  const [group, name] = splitKey(key);
  if (group === "convert") {
    if (kind === "image" && name === "PDF") return [await imagesToPdf(same)];
    const outs: OutFile[] = [];
    for (const f of same) {
      if (kind === "image") outs.push(await convertImage(f, name, o.quality));
      else if (kind === "pdf" && name === "TXT") outs.push(await pdfToTxt(f));
      else if (kind === "pdf") outs.push(...(await pdfToImages(f, name as "PNG" | "JPG", o.pdfDpi, o.quality)));
      else if (kind === "docx") {
        const text = await readDocx(f);
        outs.push(name === "PDF" ? await textToPdf(text, f.name, false) : { name: siblingName(f.name, "", "txt"), blob: new Blob([text], { type: "text/plain" }) });
      } else outs.push(await textToPdf(await readText(f), f.name, true));
    }
    return outs;
  }
  const outs: OutFile[] = [];
  switch (`${kind}:${name}`) {
    case "image:Compress":
      for (const f of same) outs.push(await compressImage(f));
      return outs;
    case "image:Resize":
      if (!o.resize) throw new UserError("No size chosen.");
      for (const f of same) outs.push(await resizeImage(f, o.resize));
      return outs;
    case "pdf:Split":
      for (const f of same) outs.push(...(await splitPdf(f)));
      return outs;
    case "pdf:Rotate":
      for (const f of same) outs.push(await rotatePdf(f));
      return outs;
    case "pdf:Merge":
      return [await mergePdfs(same)];
    default:
      throw new UserError(`${name} isn't available for this file.`);
  }
}

function summarize(key: string, files: File[], outs: OutFile[], dims?: { from?: [number, number] | null; to?: [number, number] | null }): JobResult {
  const [group, name] = splitKey(key);
  const before = total(files);
  const after = outs.reduce((n, o) => n + o.blob.size, 0);
  const src = files[0];
  const names = outs.length === 1 ? outs[0].name : `${outs[0].name} …`;
  if (group === "convert") {
    const title =
      files.length > 1 && outs.length === 1 ? `${files.length} files → 1 ${name}`
      : outs.length > 1 && files.length === 1 ? `${outs.length} pages → ${outs.length} ${name}s`
      : `${extOf(src.name).toUpperCase()} → ${name}`;
    return { title, detail: `${names} · ${humanSize(after)}`, outs };
  }
  switch (name) {
    case "Compress": {
      const pct = percentSaved(before, after);
      return {
        title: files.length > 1 ? `Compressed ${files.length} files` : "Compressed",
        detail: `${humanSize(before)} → ${humanSize(after)}`,
        good: pct >= 1 ? `${pct}% smaller` : "already well compressed",
        outs,
      };
    }
    case "Resize":
      return {
        title: "Resized",
        detail: dims?.from && dims?.to ? `${dims.from[0]}×${dims.from[1]} → ${dims.to[0]}×${dims.to[1]} · ${names}` : names,
        outs,
      };
    case "Split": return { title: `Split into ${outs.length} PDFs`, detail: names, outs };
    case "Merge": return { title: `Merged ${files.length} PDFs`, detail: `${humanSize(after)} · ${names}`, outs };
    case "Rotate": return { title: "Rotated 90°", detail: names, outs };
    default: return { title: name, detail: names, outs };
  }
}

/** Text we can hand to the AI for a given file (truncated). */
export async function extractText(file: File): Promise<string | undefined> {
  const kind = kindOf(file);
  try {
    if (kind === "text") return (await readText(file)).slice(0, 12_000);
    if (kind === "docx") return (await readDocx(file)).slice(0, 12_000);
    if (kind === "pdf") return (await pdfText(file)).slice(0, 12_000);
  } catch {
    return undefined;
  }
  return undefined;
}

export async function runJob(key: string, files: File[], opts: JobOptions = {}): Promise<JobResult> {
  const [group, name] = splitKey(key);
  const first = files[0];
  if (!first || !kindOf(first)) throw new UserError("Unsupported file type.");
  if (group === "ai") {
    const ai = await runAiForFile(name, first, extractText);
    const outs: OutFile[] = [];
    if (name === "Rename" && ai.text) {
      const ext = extOf(first.name);
      outs.push({ name: ext ? `${ai.text}.${ext}` : ai.text, blob: first });
    }
    return { title: ai.title, detail: ai.text, outs, ai };
  }
  const srcs = files.filter((f) => kindOf(f) === kindOf(first));
  const outs = await runAction(key, files, opts);
  if (!outs.length) throw new UserError("Nothing was produced.");
  const dims =
    name === "Resize" && srcs.length === 1
      ? { from: await imageDims(srcs[0]), to: await imageDims(new File([outs[0].blob], outs[0].name)) }
      : undefined;
  return summarize(key, srcs, outs, dims);
}
