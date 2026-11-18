export type AiTask = "summarize" | "rename" | "alttext" | "suggest";

export interface AiRequest {
  task: AiTask;
  fileName: string;
  kind: "image" | "pdf" | "docx" | "text";
  sizeBytes: number;
  /** Extracted text (already truncated by the client). */
  text?: string;
  /** Small JPEG as base64 (no data: prefix) for vision tasks. */
  imageBase64?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface AiResult {
  text: string;
  provider: ProviderName;
  /** True when a real provider was wanted/available but failed, so mock answered. */
  fallback: boolean;
  note?: string;
}

export type ProviderName = "gemini" | "groq" | "mock";

export interface AiProvider {
  name: ProviderName;
  /** Complete a prompt; image is optional. */
  complete(args: { system: string; prompt: string; imageBase64?: string }): Promise<string>;
}
