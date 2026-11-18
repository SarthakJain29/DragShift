import JSZip from "jszip";
import { UserError } from "../files";

/** Decode bytes trying UTF-8 (strict), then UTF-16 (with BOM), then Windows-1252. */
export function decodeText(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8).replace(/^﻿/, "");
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8).replace(/^﻿/, "");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(u8);
  }
}

export async function readText(file: File): Promise<string> {
  return decodeText(await file.arrayBuffer());
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Plain text from the XML of word/document.xml: one line per paragraph. */
export function docxXmlToText(xml: string): string {
  return xml
    .split(/<\/w:p>/)
    .map((p) =>
      unescapeXml(
        p
          .replace(/<w:tab\s*\/>/g, "\t")
          .replace(/<w:(br|cr)\s*\/?>/g, "\n")
          .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, "$1\u0001")
          .replace(/<[^>]+>/g, "")
          .replace(/\u0001/g, ""),
      ),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function readDocx(file: File): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const doc = zip.file("word/document.xml");
    if (!doc) throw new Error("no document.xml");
    return docxXmlToText(await doc.async("string"));
  } catch {
    throw new UserError(`Couldn't read ${file.name} as a Word document.`);
  }
}
