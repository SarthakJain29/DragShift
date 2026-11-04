import { UserError, extOf, siblingName } from "../files";
import { resizeDims, type ResizeSpec } from "../resize";
import type { OutFile } from "./types";

const MIME: Record<string, string> = { PNG: "image/png", JPG: "image/jpeg", WEBP: "image/webp" };

export interface Decoded {
  canvas: HTMLCanvasElement;
  hasAlpha: boolean;
}

export async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UserError(`Couldn't read ${file.name} as an image.`);
  }
}

function draw(bmp: ImageBitmap, w: number, h: number, onWhite: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new UserError("Canvas isn't available in this browser.");
  if (onWhite) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

export function encode(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  const mime = MIME[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new UserError("Couldn't encode the image."));
        // Browsers silently fall back to PNG for formats they can't write (Safari + WEBP)
        if (b.type !== mime) return reject(new UserError(`This browser can't write ${format} files.`));
        resolve(b);
      },
      mime,
      quality,
    );
  });
}

export async function convertImage(file: File, format: string, quality = 0.9): Promise<OutFile> {
  const bmp = await decode(file);
  const canvas = draw(bmp, bmp.width, bmp.height, format === "JPG");
  bmp.close();
  const blob = await encode(canvas, format, quality);
  return { name: siblingName(file.name, "", format.toLowerCase()), blob };
}

/** Pick a lossy-friendly output format that keeps the original type when possible. */
function sameFormat(file: File): string {
  const e = extOf(file.name);
  if (e === "png") return "PNG";
  if (e === "webp") return "WEBP";
  return "JPG";
}

export async function compressImage(file: File, quality = 0.72): Promise<OutFile> {
  const bmp = await decode(file);
  let format = sameFormat(file);
  // PNG is lossless: re-encode as WEBP (keeps alpha) when supported, otherwise JPG
  let blob: Blob;
  const canvas = draw(bmp, bmp.width, bmp.height, false);
  bmp.close();
  if (format === "PNG") {
    try {
      blob = await encode(canvas, "WEBP", quality);
      format = "WEBP";
    } catch {
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      blob = await encode(flat, "JPG", quality);
      format = "JPG";
    }
  } else if (format === "JPG") {
    const flat = draw(await decode(file), canvas.width, canvas.height, true);
    blob = await encode(flat, "JPG", quality);
  } else {
    blob = await encode(canvas, format, quality);
  }
  return { name: siblingName(file.name, "Compressed", format.toLowerCase()), blob };
}

export async function resizeImage(file: File, spec: ResizeSpec): Promise<OutFile> {
  const bmp = await decode(file);
  const [w, h] = resizeDims(spec, bmp.width, bmp.height);
  const format = sameFormat(file);
  const canvas = draw(bmp, w, h, format === "JPG");
  bmp.close();
  const blob = await encode(canvas, format, 0.92);
  return { name: siblingName(file.name, `${w}x${h}`, format.toLowerCase()), blob };
}

export async function imageDims(file: File): Promise<[number, number] | null> {
  try {
    const b = await createImageBitmap(file);
    const d: [number, number] = [b.width, b.height];
    b.close();
    return d;
  } catch {
    return null;
  }
}
