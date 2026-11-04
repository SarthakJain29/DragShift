import { describe, expect, it } from "vitest";
import { buildRings, convertTargets, splitKey } from "@/lib/actions";
import { humanSize, kindOf, percentSaved, siblingName, uniqueName } from "@/lib/files";
import { parseResize, resizeDims } from "@/lib/resize";
import { docxXmlToText, decodeText } from "@/lib/convert/text";
import { toWinAnsi, wrapLine } from "@/lib/convert/pdf";

describe("files", () => {
  it("classifies by extension then mime", () => {
    expect(kindOf({ name: "a.JPG" })).toBe("image");
    expect(kindOf({ name: "a.pdf" })).toBe("pdf");
    expect(kindOf({ name: "a.docx" })).toBe("docx");
    expect(kindOf({ name: "notes.md" })).toBe("text");
    expect(kindOf({ name: "blob", type: "image/png" })).toBe("image");
    expect(kindOf({ name: "a.exe" })).toBeNull();
  });
  it("formats sizes", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("builds sibling and unique names", () => {
    expect(siblingName("a.jpg", "Compressed")).toBe("a Compressed.jpg");
    expect(siblingName("a.jpg", "", "png")).toBe("a.png");
    expect(uniqueName("a.png", ["a.png", "a (1).png"])).toBe("a (2).png");
    expect(uniqueName("b.png", ["a.png"])).toBe("b.png");
  });
  it("computes percent saved", () => {
    expect(percentSaved(1000, 250)).toBe(75);
    expect(percentSaved(0, 5)).toBe(0);
    expect(percentSaved(100, 150)).toBe(-50);
  });
});

describe("resize", () => {
  it("handles every mode", () => {
    expect(resizeDims({ mode: "percent", value: 50 }, 1000, 600)).toEqual([500, 300]);
    expect(resizeDims({ mode: "longest", value: 500 }, 1000, 600)).toEqual([500, 300]);
    expect(resizeDims({ mode: "width", value: 200 }, 1000, 600)).toEqual([200, 120]);
    expect(resizeDims({ mode: "height", value: 60 }, 1000, 600)).toEqual([100, 60]);
  });
  it("never returns 0", () => expect(resizeDims({ mode: "percent", value: 1 }, 10, 10)).toEqual([1, 1]));
  it("parses specs", () => {
    expect(parseResize("percent:50")).toEqual({ mode: "percent", value: 50 });
    expect(parseResize("bogus:1")).toBeNull();
    expect(parseResize("width:-3")).toBeNull();
  });
});

describe("radial menu rings", () => {
  it("offers sensible actions for an image", () => {
    const rings = buildRings([{ name: "a.png" }]);
    expect(rings.map((r) => r.name)).toEqual(["Convert", "Tools", "AI"]);
    expect(rings[0].items.map((i) => i.label)).toEqual(["JPG", "WEBP", "PDF"]); // not PNG -> PNG
    expect(rings[1].items.map((i) => i.label)).toEqual(["Compress", "Resize"]);
  });
  it("offers Merge only for several PDFs", () => {
    expect(buildRings([{ name: "a.pdf" }])[1].items.map((i) => i.label)).not.toContain("Merge");
    expect(buildRings([{ name: "a.pdf" }, { name: "b.pdf" }])[1].items.map((i) => i.label)).toContain("Merge");
  });
  it("hints at combined PDF for many images", () => {
    const pdf = buildRings([{ name: "a.png" }, { name: "b.png" }])[0].items.find((i) => i.label === "PDF");
    expect(pdf?.hint).toBe("2 images → 1 PDF");
  });
  it("returns nothing for unsupported files and has no Tools ring for text", () => {
    expect(buildRings([{ name: "a.exe" }])).toEqual([]);
    expect(buildRings([{ name: "a.txt" }]).map((r) => r.name)).toEqual(["Convert", "AI"]);
    expect(convertTargets("docx", "docx")).toEqual(["PDF", "TXT"]);
  });
  it("splits action keys", () => expect(splitKey("convert:PNG")).toEqual(["convert", "PNG"]));
});

describe("text helpers", () => {
  it("extracts paragraphs from docx xml", () => {
    const xml = `<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; world</w:t></w:r></w:p><w:p><w:r><w:t>Line 2</w:t></w:r></w:p>`;
    expect(docxXmlToText(xml)).toBe("Hello & world\nLine 2");
  });
  it("decodes utf-8 and falls back to windows-1252", () => {
    expect(decodeText(new TextEncoder().encode("héllo").buffer as ArrayBuffer)).toBe("héllo");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer as ArrayBuffer)).toBe("café");
  });
  it("sanitizes for pdf fonts and wraps lines", () => {
    expect(toWinAnsi("“hi” — ok\t日")).toBe('"hi" - ok    ?');
    const m = (s: string) => s.length;
    expect(wrapLine("aaa bbb ccc", 7, m)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapLine("abcdefghij", 4, m).every((l) => l.length <= 4)).toBe(true);
    expect(wrapLine("", 5, m)).toEqual([""]);
  });
});
