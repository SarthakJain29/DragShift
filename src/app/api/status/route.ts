import { NextResponse } from "next/server";
import { activeProviderName } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** Tells the UI which AI provider is live (never exposes keys). */
export async function GET() {
  return NextResponse.json({ provider: activeProviderName() });
}
