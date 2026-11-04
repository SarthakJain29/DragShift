"use client";
import { useState } from "react";
import type { ResizeMode, ResizeSpec } from "@/lib/resize";

const MODES: [ResizeMode, string][] = [["percent", "Percent"], ["longest", "Longest side (px)"], ["width", "Width (px)"], ["height", "Height (px)"]];

export default function ResizeDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: (s: ResizeSpec) => void }) {
  const [mode, setMode] = useState<ResizeMode>("percent");
  const [value, setValue] = useState("50");
  const n = Number(value);
  const ok = Number.isFinite(n) && n > 0 && (mode !== "percent" || n <= 400);
  return (
    <div className="scrim" onClick={onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Resize"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (ok) onConfirm({ mode, value: Math.round(n) }); }}
      >
        <h2>Resize {count > 1 ? `${count} images` : "image"}</h2>
        <p className="muted">Saved as a copy — the original is never touched.</p>
        <div className="row">
          <select value={mode} onChange={(e) => setMode(e.target.value as ResizeMode)} aria-label="Mode">
            {MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
          <input autoFocus inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" aria-invalid={!ok} />
        </div>
        {!ok && <p className="err-text small">Enter a positive number{mode === "percent" ? " up to 400" : ""}.</p>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ok}>Resize</button>
        </div>
      </form>
    </div>
  );
}
