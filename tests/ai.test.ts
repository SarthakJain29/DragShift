import { describe, expect, it } from "vitest";
import { activeProviderName, configuredProviders, postProcess, runAi } from "@/lib/ai";
import { keywords, mockAnswer, slugify } from "@/lib/ai/mock";
import type { AiProvider, AiRequest } from "@/lib/ai/types";

const doc: AiRequest = {
  task: "summarize", fileName: "q3.txt", kind: "text", sizeBytes: 100,
  text: "Quarterly revenue grew strongly across all regions this year. The marketing team launched three campaigns that drove revenue. Costs stayed flat while revenue climbed. Next quarter the team plans to expand into two new regions.",
};

describe("provider selection", () => {
  it("is mock with no keys", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(activeProviderName({})).toBe("mock");
  });
  it("prefers AI_PROVIDER, otherwise gemini then groq", () => {
    expect(configuredProviders({ GEMINI_API_KEY: "a", GROQ_API_KEY: "b" }).map((p) => p.name)).toEqual(["gemini", "groq"]);
    expect(configuredProviders({ GEMINI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER: "groq" }).map((p) => p.name)).toEqual(["groq", "gemini"]);
  });
  it("AI_PROVIDER=mock forces mock", () => {
    expect(configuredProviders({ GEMINI_API_KEY: "a", AI_PROVIDER: "mock" })).toEqual([]);
  });
});

describe("runAi", () => {
  it("uses mock when nothing is configured", async () => {
    const r = await runAi(doc, []);
    expect(r.provider).toBe("mock");
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^TL;DR:/);
  });
  it("uses the provider when it works", async () => {
    const ok: AiProvider = { name: "groq", complete: async () => "hi there" };
    expect(await runAi(doc, [ok])).toMatchObject({ text: "hi there", provider: "groq", fallback: false });
  });
  it("falls through failing providers, then to mock with a note", async () => {
    const bad: AiProvider = { name: "gemini", complete: async () => { throw new Error("Gemini 429"); } };
    const good: AiProvider = { name: "groq", complete: async () => "from groq" };
    expect((await runAi(doc, [bad, good])).provider).toBe("groq");
    const r = await runAi(doc, [bad]);
    expect(r).toMatchObject({ provider: "mock", fallback: true });
    expect(r.note).toContain("429");
  });
});

describe("mock + postProcess", () => {
  it("slugifies and ranks keywords", () => {
    expect(slugify("The Quarterly Revenue Report: Q3!")).toBe("quarterly-revenue-report-q3");
    expect(keywords(doc.text!, 2)[0]).toBe("revenue");
  });
  it("renames from the first line", () => {
    expect(mockAnswer({ ...doc, task: "rename", text: "Annual Budget Plan 2026\nbody" })).toBe("annual-budget-plan-2026");
  });
  it("cleans model rename output", () => {
    expect(postProcess("rename", "Annual Budget Plan.pdf\nextra")).toBe("annual-budget-plan");
  });
  it("handles empty docs gracefully", () => {
    expect(mockAnswer({ ...doc, text: "" })).toMatch(/isn't enough/);
  });
});
