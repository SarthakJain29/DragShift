export type ResizeMode = "percent" | "longest" | "width" | "height";
export interface ResizeSpec {
  mode: ResizeMode;
  value: number;
}

/** Compute output dimensions (never below 1px). */
export function resizeDims(spec: ResizeSpec, w: number, h: number): [number, number] {
  let k: number;
  switch (spec.mode) {
    case "percent": k = spec.value / 100; break;
    case "longest": k = spec.value / Math.max(w, h); break;
    case "width": k = spec.value / w; break;
    case "height": k = spec.value / h; break;
  }
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Parse "percent:50", "longest:1200"… */
export function parseResize(s: string): ResizeSpec | null {
  const [mode, v] = s.split(":");
  const value = Number(v);
  if (!["percent", "longest", "width", "height"].includes(mode) || !Number.isFinite(value) || value <= 0) return null;
  return { mode: mode as ResizeMode, value: Math.round(value) };
}
