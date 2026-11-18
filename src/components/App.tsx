"use client";
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRings, type MenuItem } from "@/lib/actions";
import { friendly, humanSize, kindOf, uniqueName } from "@/lib/files";
import { clampCenter, hitTest } from "@/lib/geometry";
import { runJob, type JobOptions } from "@/lib/jobs";
import type { ResizeSpec } from "@/lib/resize";
import { sampleImage, samplePdf, sampleText } from "@/lib/samples";
import RadialMenu from "./RadialMenu";
import ResizeDialog from "./ResizeDialog";
import ResultCard, { download, type Job } from "./ResultCard";

type Pseudo = { name: string; type: string };
interface MenuState {
  cx: number;
  cy: number;
  mode: "drag" | "click";
}
interface Settings {
  quality: number; // 50..100
  dpi: number;
}
const DEFAULTS: Settings = { quality: 90, dpi: 150 };
const DWELL_MS = 550;

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("dragshift:settings") ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [ghost, setGhost] = useState<Pseudo[]>([]);
  const [ringIndex, setRingIndex] = useState(0);
  const [hover, setHover] = useState(-1);
  const [dwell, setDwell] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [resizeFor, setResizeFor] = useState<{ item: MenuItem; files: File[] } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState<string>("…");
  const [notice, setNotice] = useState<string | null>(null);
  const jobId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hubArmed = useRef(true);

  useEffect(() => { setSettings(loadSettings()); }, []);
  useEffect(() => {
    try { localStorage.setItem("dragshift:settings", JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j) => setProvider(j.provider)).catch(() => setProvider("mock"));
  }, []);

  const liveFiles = menu?.mode === "drag" ? ghost : files;
  const rings = useMemo(() => buildRings(liveFiles), [liveFiles]);
  const trayRings = useMemo(() => buildRings(files), [files]);
  const unsupported = files.filter((f) => !kindOf(f));

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 4000);
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    const ok = incoming.filter((f) => kindOf(f));
    const bad = incoming.length - ok.length;
    if (bad) flash(`${bad} file${bad > 1 ? "s" : ""} skipped — unsupported type.`);
    if (ok.length) setFiles((cur) => {
      const names: string[] = cur.map((f) => f.name);
      return [...cur, ...ok.map((f) => {
        const name = uniqueName(f.name, names);
        names.push(name);
        return name === f.name ? f : new File([f], name, { type: f.type });
      })];
    });
  }, [flash]);

  const closeMenu = useCallback(() => {
    setMenu(null); setHover(-1); setRingIndex(0); setDwell(0); setGhost([]);
    if (hubTimer.current) clearTimeout(hubTimer.current);
  }, []);

  const options = useCallback((extra?: Partial<JobOptions>): JobOptions => ({ quality: settings.quality / 100, pdfDpi: settings.dpi, ...extra }), [settings]);

  const execute = useCallback(async (item: MenuItem, target: File[], resize?: ResizeSpec) => {
    const kind = kindOf(target[0]);
    const used = target.filter((f) => kindOf(f) === kind);
    const id = ++jobId.current;
    const sources = used.length === 1 ? `${used[0].name} · ${humanSize(used[0].size)}` : `${used.length} files · ${humanSize(used.reduce((n, f) => n + f.size, 0))}`;
    const label = item.key.startsWith("convert:") ? `Converting to ${item.label}` : item.key.startsWith("ai:") ? `Asking AI (${item.label})` : item.label;
    setJobs((j) => [{ id, action: label, sources, status: "working" }, ...j]);
    try {
      const result = await runJob(item.key, target, options({ resize }));
      setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: "done", result } : x)));
    } catch (e) {
      setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: "error", error: friendly(e) } : x)));
    }
  }, [options]);

  const choose = useCallback((item: MenuItem, target: File[]) => {
    closeMenu();
    if (item.key === "tool:Resize") setResizeFor({ item, files: target });
    else void execute(item, target);
  }, [closeMenu, execute]);

  // ---- global drag & drop: the radial menu opens under the cursor while you drag a file ----
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const ringsRef = useRef(rings);
  ringsRef.current = rings;
  const ringIndexRef = useRef(ringIndex);
  ringIndexRef.current = ringIndex;

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnterOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragging(true);
      const m = menuRef.current;
      if (!m || m.mode !== "drag") {
        const items = Array.from(e.dataTransfer?.items ?? []);
        setGhost(items.filter((i) => i.kind === "file").map((i) => ({ name: "", type: i.type })));
        const [cx, cy] = clampCenter(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
        setMenu({ cx, cy, mode: "drag" });
        setRingIndex(0);
        setHover(-1);
        hubArmed.current = false;
        return;
      }
      const dx = e.clientX - m.cx, dy = e.clientY - m.cy;
      setHover(hitTest(dx, dy, ringsRef.current[ringIndexRef.current]?.items.length ?? 0));
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) { setDragging(false); if (menuRef.current?.mode === "drag") closeMenu(); }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      const m = menuRef.current;
      if (!dropped.length) { closeMenu(); return; }
      let idx = -1;
      if (m?.mode === "drag") {
        const r = buildRings(dropped);
        const ri = Math.min(ringIndexRef.current, r.length - 1);
        idx = ri >= 0 ? hitTest(e.clientX - m.cx, e.clientY - m.cy, r[ri].items.length) : -1;
        if (idx >= 0) { const item = r[ri].items[idx]; addFiles(dropped); choose(item, dropped); return; }
      }
      closeMenu();
      addFiles(dropped);
      const ok = dropped.filter((f) => kindOf(f));
      if (ok.length) {
        const [cx, cy] = clampCenter(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
        setMenu({ cx, cy, mode: "click" });
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) { addFiles(pasted); flash(`Pasted ${pasted.length} file${pasted.length > 1 ? "s" : ""}.`); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!menuRef.current) return;
      if (e.key === "Escape") closeMenu();
      if (e.key === "Tab" && menuRef.current.mode === "click") { e.preventDefault(); setRingIndex((i) => (i + 1) % Math.max(1, ringsRef.current.length)); }
    };
    window.addEventListener("dragenter", onEnterOver);
    window.addEventListener("dragover", onEnterOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dragenter", onEnterOver);
      window.removeEventListener("dragover", onEnterOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [addFiles, choose, closeMenu, flash]);

  // dwell on the hub to flip rings (Convert → Tools → AI), like tapping the trigger key in the macOS app
  useEffect(() => {
    if (hubTimer.current) clearTimeout(hubTimer.current);
    setDwell(0);
    if (hover !== -2) { hubArmed.current = true; return; }
    if (!hubArmed.current || rings.length < 2) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / DWELL_MS);
      setDwell(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else { hubArmed.current = false; setRingIndex((i) => (i + 1) % rings.length); setHover(-1); setDwell(0); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover, rings.length]);

  // ---- click-mode menu pointer handling ----
  const onOverlayMove = (e: React.PointerEvent) => {
    if (!menu || menu.mode !== "click") return;
    setHover(hitTest(e.clientX - menu.cx, e.clientY - menu.cy, rings[ringIndex]?.items.length ?? 0));
  };
  const onOverlayClick = (e: React.MouseEvent) => {
    if (!menu || menu.mode !== "click") return;
    const n = rings[ringIndex]?.items.length ?? 0;
    const idx = hitTest(e.clientX - menu.cx, e.clientY - menu.cy, n);
    if (idx >= 0) choose(rings[ringIndex].items[idx], files);
    else if (idx === -2) setRingIndex((i) => (i + 1) % Math.max(1, rings.length));
    else closeMenu();
  };

  const openMenuAtCenter = () => {
    const [cx, cy] = clampCenter(window.innerWidth / 2, window.innerHeight / 2, window.innerWidth, window.innerHeight);
    setHover(-1); setRingIndex(0); setMenu({ cx, cy, mode: "click" });
  };

  const downloadAll = async (job: Job) => {
    const outs = job.result?.outs ?? [];
    const zip = new JSZip();
    const names: string[] = [];
    for (const o of outs) { const n = uniqueName(o.name, names); names.push(n); zip.file(n, o.blob); }
    download("dragshift-output.zip", await zip.generateAsync({ type: "blob" }));
  };

  const addSample = async (kind: "image" | "pdf" | "text") => {
    try {
      addFiles([kind === "image" ? await sampleImage() : kind === "pdf" ? await samplePdf() : sampleText()]);
    } catch (e) { flash(friendly(e)); }
  };

  const providerLabel = provider === "gemini" ? "Gemini" : provider === "groq" ? "Groq" : "Demo AI";

  return (
    <div className={`shell ${dragging ? "is-dragging" : ""}`}>
      <div className="aurora" aria-hidden />
      <header className="nav">
        <a className="logo" href="#top"><span className="logo-mark" aria-hidden /> DragShift</a>
        <nav>
          <a href="https://github.com/SarthakJain29/DragShift" target="_blank" rel="noreferrer">GitHub</a>
          <button className="btn ghost" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>Settings</button>
        </nav>
      </header>

      {showSettings && (
        <section className="panel settings" aria-label="Settings">
          <label>Image quality <b>{settings.quality}</b>
            <input type="range" min={50} max={100} value={settings.quality} onChange={(e) => setSettings({ ...settings, quality: Number(e.target.value) })} />
          </label>
          <label>PDF → image resolution
            <select value={settings.dpi} onChange={(e) => setSettings({ ...settings, dpi: Number(e.target.value) })}>
              {[100, 150, 200, 300].map((d) => <option key={d} value={d}>{d} dpi</option>)}
            </select>
          </label>
          <p className="muted small">
            AI provider: <b>{providerLabel}</b>{provider === "mock" && " — add GEMINI_API_KEY or GROQ_API_KEY for live results (see .env.example)."}
          </p>
        </section>
      )}

      <main id="top">
        <section className="hero">
          <p className="eyebrow">Private by design · everything runs in your browser</p>
          <h1>Drag a file.<br /><span className="grad">Pick a slice.</span> Done.</h1>
          <p className="lede">
            A radial drop menu for images, PDFs and docs. Convert, compress, resize, split and merge — then let AI summarize or name the file for you.
          </p>
        </section>

        <section
          className={`drop ${files.length ? "has-files" : ""}`}
          onClick={(e) => { if (!files.length && e.target === e.currentTarget) inputRef.current?.click(); }}
        >
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          {!files.length ? (
            <div className="empty">
              <div className="empty-orb" aria-hidden>
                <i /><i /><i /><i /><i /><i />
              </div>
              <h2>Drop a file anywhere on this page</h2>
              <p className="muted">The menu blooms under your cursor — release on a petal. Or paste an image (⌘/Ctrl+V).</p>
              <div className="row center">
                <button className="btn primary" onClick={() => inputRef.current?.click()}>Choose files</button>
                <span className="muted">or try a sample:</span>
                <button className="btn" onClick={() => addSample("image")}>Image</button>
                <button className="btn" onClick={() => addSample("pdf")}>PDF</button>
                <button className="btn" onClick={() => addSample("text")}>Text</button>
              </div>
            </div>
          ) : (
            <div className="tray">
              <div className="tray-head">
                <h2>{files.length} file{files.length > 1 ? "s" : ""} ready</h2>
                <div className="row">
                  <button className="btn primary" onClick={openMenuAtCenter} disabled={!trayRings.length}>Open radial menu</button>
                  <button className="btn" onClick={() => inputRef.current?.click()}>Add more</button>
                  <button className="btn ghost" onClick={() => setFiles([])}>Clear</button>
                </div>
              </div>
              <ul className="chips">
                {files.map((f, i) => (
                  <li key={f.name + i} className={kindOf(f) ? "" : "bad"}>
                    <span className="kind">{(kindOf(f) ?? "?").slice(0, 3)}</span>
                    <span className="nm" title={f.name}>{f.name}</span>
                    <span className="muted">{humanSize(f.size)}</span>
                    <button aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>×</button>
                  </li>
                ))}
              </ul>
              {!unsupported.length && trayRings.map((ring) => (
                <div key={ring.name} className="actions-group">
                  <h3>{ring.name}</h3>
                  <div className="actions">
                    {ring.items.map((it) => (
                      <button key={it.key} className="action" onClick={() => choose(it, files)}>
                        <b>{it.label}</b><span>{it.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {unsupported.length > 0 && <p className="err-text">Remove unsupported files to see actions: {unsupported.map((f) => f.name).join(", ")}</p>}
            </div>
          )}
        </section>

        <section className="results" aria-label="Results">
          <h2 className="section-title">Results {jobs.length > 0 && <button className="btn ghost" onClick={() => setJobs([])}>Clear all</button>}</h2>
          {jobs.length === 0 ? (
            <p className="muted empty-results">Nothing yet. Converted files, summaries and suggestions will appear here — and never leave your device (except AI text, which goes through the server route).</p>
          ) : (
            jobs.map((j) => <ResultCard key={j.id} job={j} onDismiss={() => setJobs((cur) => cur.filter((x) => x.id !== j.id))} onDownloadAll={downloadAll} />)
          )}
        </section>

        <section className="features" aria-label="Features">
          {[
            ["Radial drop menu", "Petals appear under your cursor mid-drag. Hover the hub to flip between Convert, Tools and AI."],
            ["Local-first", "Images, PDFs and Word files are processed with Canvas, pdf-lib and pdf.js — no uploads, no accounts."],
            ["AI that degrades gracefully", "Gemini or Groq for summaries, smart names and alt text. No key? A deterministic offline mode answers instead."],
            ["Native sibling", "The original macOS menu-bar app lives in /macos — same menu, system-wide, with Finder integration."],
          ].map(([t, d]) => <div key={t} className="feature"><h3>{t}</h3><p>{d}</p></div>)}
        </section>
      </main>

      <footer className="foot muted">Built by Sarthak Jain · MIT · Next.js + TypeScript</footer>

      {(dragging || menu) && (
        <div
          className={`overlay ${menu?.mode === "click" ? "interactive" : ""}`}
          onPointerMove={onOverlayMove}
          onClick={onOverlayClick}
        >
          {menu && (
            <RadialMenu
              cx={menu.cx}
              cy={menu.cy}
              rings={rings}
              ringIndex={Math.min(ringIndex, Math.max(0, rings.length - 1))}
              hover={hover}
              mode={menu.mode}
              dwell={dwell}
              hubLabel={rings.length ? (menu.mode === "drag" ? "Drop on a slice" : `${files.length} file${files.length > 1 ? "s" : ""}`) : "Drop here"}
              hubSub={rings.length > 1 ? "hover to flip ring" : rings.length ? "" : "to open the menu"}
            />
          )}
          {menu?.mode === "drag" && <p className="overlay-hint">Release on a slice · release elsewhere for the menu</p>}
        </div>
      )}

      {resizeFor && (
        <ResizeDialog
          count={resizeFor.files.length}
          onCancel={() => setResizeFor(null)}
          onConfirm={(spec) => { const r = resizeFor; setResizeFor(null); void execute(r.item, r.files, spec); }}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
