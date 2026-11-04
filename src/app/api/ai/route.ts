import { NextResponse } from "next/server";
import { runAi } from "@/lib/ai";
import type { AiRequest, AiTask } from "@/lib/ai/types";

export const runtime = "nodejs";

const TASKS: AiTask[] = ["summarize", "rename", "alttext", "suggest"];
const KINDS = ["image", "pdf", "docx", "text"];
const MAX_TEXT = 12_000;
const MAX_IMAGE_B64 = 1_500_000;

// Tiny per-instance rate limit so a leaked demo URL can't burn a free quota.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

function validate(body: unknown): AiRequest | string {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const b = body as Record<string, unknown>;
  if (!TASKS.includes(b.task as AiTask)) return "Unknown task.";
  if (!KINDS.includes(b.kind as string)) return "Unknown file kind.";
  if (typeof b.fileName !== "string" || !b.fileName || b.fileName.length > 300) return "Bad file name.";
  const image = typeof b.imageBase64 === "string" ? b.imageBase64 : undefined;
  if (image && image.length > MAX_IMAGE_B64) return "Image too large.";
  return {
    task: b.task as AiTask,
    kind: b.kind as AiRequest["kind"],
    fileName: b.fileName,
    sizeBytes: Number(b.sizeBytes) || 0,
    text: typeof b.text === "string" ? b.text.slice(0, MAX_TEXT) : undefined,
    imageBase64: image,
    imageWidth: Number(b.imageWidth) || undefined,
    imageHeight: Number(b.imageHeight) || undefined,
  };
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return NextResponse.json({ error: "Slow down — too many AI requests this minute." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = validate(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  return NextResponse.json(await runAi(parsed));
}
