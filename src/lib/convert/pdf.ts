import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { UserError, extOf, siblingName } from "../files";
import { decode, encode } from "./image";
import type { OutFile } from "./types";

const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer());
const asBlob = (u: Uint8Array) => new Blob([u as BlobPart], { type: "application/pdf" });

async function open(file: File): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await bytes(file));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(msg)) throw new UserError(`${file.name} is password-protected. Remove the password first.`);
    throw new UserError(`Couldn't open ${file.name} as a PDF.`);
  }
}

export async function splitPdf(file: File): Promise<OutFile[]> {
  const src = await open(file);
  const out: OutFile[] = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    out.push({ name: siblingName(file.name, `page ${i + 1}`, "pdf"), blob: asBlob(await doc.save()) });
  }
  return out;
}

export async function rotatePdf(file: File): Promise<OutFile> {
  const doc = await open(file);
  for (const p of doc.getPages()) p.setRotation(degrees((p.getRotation().angle + 90) % 360));
  return { name: siblingName(file.name, "Rotated", "pdf"), blob: asBlob(await doc.save()) };
}

export async function mergePdfs(files: File[]): Promise<OutFile> {
  const merged = await PDFDocument.create();
  for (const f of files) {
    const src = await open(f);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return { name: siblingName(files[0].name, "Merged", "pdf"), blob: asBlob(await merged.save()) };
}

/** One page per image, at 150 dpi page size. JPEG/PNG are embedded as-is; others are re-encoded. */
export async function imagesToPdf(files: File[]): Promise<OutFile> {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const ext = extOf(f.name);
    let img;
    if (ext === "jpg" || ext === "jpeg") {
      // re-draw through canvas so EXIF rotation is applied
      img = await doc.embedJpg(await pngOrJpg(f, "JPG"));
    } else {
      img = await doc.embedPng(await pngOrJpg(f, "PNG"));
    }
    const w = (img.width * 72) / 150;
    const h = (img.height * 72) / 150;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return {
    name: siblingName(files[0].name, files.length > 1 ? "Combined" : "", "pdf"),
    blob: asBlob(await doc.save()),
  };
}

async function pngOrJpg(f: File, fmt: "PNG" | "JPG"): Promise<Uint8Array> {
  const bmp = await decode(f);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  if (fmt === "JPG") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Uint8Array(await (await encode(c, fmt, 0.92)).arrayBuffer());
}

/** Replace characters the standard PDF fonts can't draw. */
export function toWinAnsi(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\n\x20-\x7E -ÿ]/g, "?");
}

/** Greedy word wrap using a width-measuring callback. */
export function wrapLine(line: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (line === "") return [""];
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(/(?<=\s)/)) {
    if (cur && measure((cur + word).trimEnd()) > maxWidth) {
      out.push(cur.trimEnd());
      cur = "";
    }
    // hard-break a single word that is wider than the line
    let w = word;
    while (measure(w.trimEnd()) > maxWidth && w.length > 1) {
      let n = w.length - 1;
      while (n > 1 && measure(w.slice(0, n)) > maxWidth) n--;
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    cur += w;
  }
  out.push(cur.trimEnd());
  return out;
}

export async function textToPdf(text: string, srcName: string, mono = true): Promise<OutFile> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(mono ? StandardFonts.Courier : StandardFonts.Helvetica);
  const size = mono ? 9.5 : 11;
  const lead = size * 1.45;
  const margin = 54;
  const [W, H] = [612, 792];
  const measure = (s: string) => font.widthOfTextAtSize(s, size);
  const lines = toWinAnsi(text).split("\n").flatMap((l) => wrapLine(l, W - margin * 2, measure));
  let page = doc.addPage([W, H]);
  let y = H - margin;
  for (const l of lines) {
    if (y < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
    if (l) page.drawText(l, { x: margin, y: y - size, size, font });
    y -= lead;
  }
  return { name: siblingName(srcName, "", "pdf"), blob: asBlob(await doc.save()) };
}

// ---- pdf.js (rendering and text extraction) ----

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return lib;
}

async function openForRender(file: File) {
  const lib = await pdfjs();
  try {
    return await lib.getDocument({ data: await bytes(file) }).promise;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") {
      throw new UserError(`${file.name} is password-protected. Remove the password first.`);
    }
    throw new UserError(`Couldn't open ${file.name} as a PDF.`);
  }
}

export async function pdfToImages(file: File, format: "PNG" | "JPG", dpi = 150, quality = 0.9): Promise<OutFile[]> {
  const pdf = await openForRender(file);
  const out: OutFile[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    out.push({
      name: siblingName(file.name, pdf.numPages > 1 ? `page ${i}` : "", format.toLowerCase()),
      blob: await encode(c, format, quality),
    });
  }
  return out;
}

export async function pdfText(file: File): Promise<string> {
  const pdf = await openForRender(file);
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let line = "";
    for (const item of content.items) {
      if ("str" in item) {
        line += item.str;
        if (item.hasEOL) line += "\n";
        else if (item.str && !line.endsWith(" ")) line += " ";
      }
    }
    pages.push(line.trim());
  }
  return pages.join("\n\n");
}

export async function pdfToTxt(file: File): Promise<OutFile> {
  const text = await pdfText(file);
  if (!text.trim()) throw new UserError("No selectable text found — this PDF may be a scan.");
  return { name: siblingName(file.name, "", "txt"), blob: new Blob([text], { type: "text/plain" }) };
}
