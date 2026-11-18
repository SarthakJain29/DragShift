"use client";
import { useEffect, useMemo, useState } from "react";
import { humanSize } from "@/lib/files";
import type { JobResult } from "@/lib/jobs";

export interface Job {
  id: number;
  action: string;
  sources: string;
  status: "working" | "done" | "error";
  result?: JobResult;
  error?: string;
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const PROVIDER_LABEL = { gemini: "Gemini", groq: "Groq", mock: "Demo mode" } as const;

export default function ResultCard({ job, onDismiss, onDownloadAll }: { job: Job; onDismiss: () => void; onDownloadAll: (j: Job) => void }) {
  const first = job.result?.outs[0];
  const thumb = useMemo(
    () => (first && first.blob.type.startsWith("image/") ? URL.createObjectURL(first.blob) : null),
    [first],
  );
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb); }, [thumb]);
  const [copied, setCopied] = useState(false);
  const r = job.result;

  return (
    <article className={`card ${job.status}`} aria-live="polite">
      <div className="card-media">
        {job.status === "working" && <span className="spinner" aria-label="Working" />}
        {job.status === "error" && <span className="card-icon err">!</span>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {job.status === "done" && thumb && <img src={thumb} alt="" />}
        {job.status === "done" && !thumb && <span className="card-icon">{r?.ai ? "✦" : "✓"}</span>}
      </div>
      <div className="card-body">
        <header>
          <h3>
            {job.status === "working" ? `${job.action}…` : job.status === "error" ? "Couldn’t finish" : r?.title}
          </h3>
          {r?.good && <span className="badge good">{r.good}</span>}
          {r?.ai && (
            <span className={`badge ai ${r.ai.provider}`} title={r.ai.note}>
              {PROVIDER_LABEL[r.ai.provider]}{r.ai.fallback ? " · offline fallback" : ""}
            </span>
          )}
        </header>
        <p className="muted src">{job.sources}</p>
        {job.status === "error" && <p className="err-text">{job.error}</p>}
        {job.status === "done" && r && !r.ai && <p>{r.detail}</p>}
        {job.status === "done" && r?.ai && <pre className="ai-text">{r.ai.text}</pre>}
        {job.status === "done" && r?.ai?.note && <p className="muted small">{r.ai.note}</p>}
        <footer>
          {job.status === "done" && r?.outs.length === 1 && (
            <button className="btn primary" onClick={() => download(r.outs[0].name, r.outs[0].blob)}>
              {r.ai ? "Download renamed copy" : `Download · ${humanSize(r.outs[0].blob.size)}`}
            </button>
          )}
          {job.status === "done" && r && r.outs.length > 1 && (
            <button className="btn primary" onClick={() => onDownloadAll(job)}>Download {r.outs.length} files (.zip)</button>
          )}
          {job.status === "done" && r?.ai && (
            <button
              className="btn"
              onClick={() => { navigator.clipboard?.writeText(r.ai!.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {job.status !== "working" && <button className="btn ghost" onClick={onDismiss}>{job.status === "error" ? "Dismiss" : "Remove"}</button>}
        </footer>
      </div>
    </article>
  );
}
