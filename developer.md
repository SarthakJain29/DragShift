# developer.md

## 1. Audit (state of the repo before the revamp)

**What it was:** `ShiftDrop`, a native macOS (Swift 5.10 / AppKit) menu-bar rewrite of the Python app [DragShift](https://github.com/llamaboi55/DragShift). Hold a trigger key while dragging a file in Finder and a radial "glass" menu opens under the cursor; dropping on a petal converts / compresses / resizes / splits / merges the file next to the original.

**What worked (read from source, ~1.9k lines Swift):**
- `DragWatcher` – 15 ms polling of global mouse/modifier state (no Accessibility permission), pasteboard change-count check so window/text drags don't trigger the menu.
- `RadialMenu` – borderless panel, `NSVisualEffectView` masked to petal shapes, spring animations, Convert ⇄ Tools ring flip.
- `Converters` – ImageIO (images), PDFKit (PDF), Core Text/NSAttributedString (docx/text); atomic writes; never overwrites; `Files.unique`.
- Headless CLI (`--rings`, `--run`, `--snapshot`) – good for testing.

**What was missing / broken:**
| Area | Finding |
|---|---|
| Portability | macOS-only. Cannot be run, demoed, screenshotted or deployed from a link — poor for a portfolio. |
| Tests | None (no test target, no CI). Pure logic (resize math, ring building, naming) was untested. |
| Docs | README only covers building; no screenshots; "Not yet ported" list: crop, edit, annotate, redact, add-BG, metadata, PDF compress/protect/extract, PDF→DOCX, compress-to-size. |
| Features | No AI / smart features; no result history; no batch download. |
| Structure | Fine for a small app, but root of repo was a Swift package only. |
| Risks | Ad-hoc code signing only (no notarization); `readDocx` hops to main thread via `sync` (deadlock-prone if called from main while another sync is pending); WEBP/AVIF writing depends on macOS version. |

I could not build or run the Swift app here (the sandbox is Linux; no Swift toolchain), so the native code is **untouched apart from being moved to `macos/`**.

## 2. Research (similar products)

Notes from a quick web search (search tool results were thin; some points are from prior knowledge of the products):
- **Squoosh** (Google) – browser-side processing (WASM), works offline, live before/after and size readout. *Takeaway:* local-first is a privacy selling point; show size savings prominently. ([repo mirror](https://github.com/sm18lr88/squoosh))
- **CloudConvert** – huge format coverage, clean options step, auto-deletes uploads. *Takeaway:* a short drop → options → result path; be explicit about where processing happens.
- **iLovePDF** – task-oriented tools (merge/split/compress). *Takeaway:* name actions by the job; batch support matters. It is server-side, which is its privacy trade-off.
- **Raycast / Dropover / Yoink (macOS)** – fast, keyboard- or gesture-first, contextual actions. *Takeaway:* contextual actions that depend on file type; minimal chrome. (not verified online)
- **Design reference:** vibrant.design could not be fetched (search returned unrelated sites). I interpreted "vibrant" as: deep ink background, saturated coral/violet/cyan/lime gradients, oversized expressive display type (Bricolage Grotesque), glassy panels, springy motion.

## 3. Decisions

1. **Add a web app, keep the native app.** The native app is the original idea but un-demoable. A Next.js + TypeScript web app can be run, screenshotted and deployed free (Vercel). The Swift code moves to `macos/` unchanged. *Stack change justified by:* shareable demo, testable on Linux CI, and a server route is needed to keep AI keys secret.
2. **Next.js App Router** (not plain Vite) for the `/api/ai` route (keys stay server-side) and free Vercel hosting.
3. **Local-first processing** (Canvas, pdf-lib, pdf.js, JSZip). No server upload — reflects the native app's "your files never change" spirit.
4. **Scope of formats:** PNG/JPG/WEBP/PDF/TXT/DOCX-read. HEIC/AVIF/TIFF/BMP/ICO dropped for the web (no reliable browser encoders). Logged in roadmap.
5. **Menu before drop:** browsers hide file names during a drag, but expose MIME types, so the ghost menu is built from MIME types; the real menu is rebuilt from actual files on drop.
6. **AI features** (summarize, rename, alt text, suggest) picked because they are useful for exactly the files this app touches. Provider abstraction in `src/lib/ai`; chain Gemini → Groq → deterministic mock.
7. **Model names are env-overridable** (`GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL`). I hit 404s with the first model names I picked (they had been retired) — catalogs change quickly; defaults are now `gemini-flash-latest` and `openai/gpt-oss-20b`.
8. Hand-written CSS rather than Tailwind/UI kit, for a distinctive look and zero extra deps.
9. No database / auth: nothing to store. Settings use `localStorage` (wrapped in try/catch).

## 4. Blockers & workarounds

| What failed | What I tried | What you need to do |
|---|---|---|
| Swift app can't be built/run on Linux sandbox | — | Build on a Mac: `cd macos && ./scripts/build-app.sh`. Not re-verified in this session. |
| vibrant.design couldn't be opened via search | Searched twice; only unrelated "Vibrant" sites returned | Optionally review the UI against the site and adjust tokens in `src/app/globals.css`. |
| **Retest after key update:** one direct Gemini call (`gemini-flash-latest`) returned HTTP 200 and "ready"; the next calls (via the app route and a direct one with the app's request shape) returned **429 quota exceeded** (retryDelay ≈ 11h), so the app fell through to Groq as designed. Not retried further. | Wait for the quota to reset, then retry; the code path itself is the same shape the 200 call used. |
| Gemini returned `503 high demand` during my live test; initial default models returned 404 | Switched to `gemini-flash-latest` / `openai/gpt-oss-20b`; verified live Groq summary; fallback chain proved by Gemini 503 → Groq | Nothing; set `AI_PROVIDER` to force one. Alt-text on Groq needs `GROQ_VISION_MODEL` (none of the models listed for my key were vision-capable) — otherwise Gemini or mock answers. |
| Live **image** alt text not verified against a real vision model | Gemini was unavailable at test time | Try "Alt text" with a Gemini key on a quiet moment. |
| Real browser drag from the OS not testable headless | Simulated `dragenter/dragover` events with Playwright | Try dragging a real file in Chrome/Safari/Firefox; report quirks (see Known issues). |
| WEBP encode not supported in Safari canvas | Detect and show "This browser can't write WEBP files." | none |

## 5. Setup & running

Requirements: Node 20+ (tested on 22), npm.

```bash
npm install
cp .env.example .env.local     # optional
npm run dev                    # http://localhost:3000
npm test && npm run lint && npm run typecheck && npm run build
```

### Environment variables (all optional)
| Var | Purpose | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Gemini for AI actions | free key at https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | Groq for AI actions | free key at https://console.groq.com/keys |
| `AI_PROVIDER` | `gemini` \| `groq` \| `mock` – preferred/forced provider | — |
| `GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL` | override model ids | provider docs |

No keys → **mock mode** (deterministic, offline). Keys are read on the server only (`src/lib/ai/index.ts`); never committed; `.env*` is git-ignored except `.env.example`.

### Deploy (free)
Vercel Hobby: import the repo, framework = Next.js, root = `/`, add env vars in Project Settings (optional). The `macos/` folder is ignored by the build. Any Node host works with `npm run build && npm start`.

### Native macOS app
See `macos/README.md` (`cd macos && ./scripts/build-app.sh --install`, needs Xcode CLT).

## 6. Known issues
- Dragging between child elements can fire `dragleave` with `relatedTarget === null` in some Safari/Firefox versions, momentarily closing/reopening the menu at a new position.
- Large PDFs/images are processed on the main thread (UI can stall); web workers are on the roadmap.
- PDF → TXT of scanned PDFs yields "No selectable text" (no OCR).
- Text→PDF uses standard fonts: non-Latin characters become `?`.
- DOCX reading extracts text only (no images/tables/formatting).
- In-memory rate limit on `/api/ai` is per serverless instance (best effort).
- Gemini free tier may return 429/503; the app falls back automatically.

## 7. Progress
**Done:** audit; repo restructure (`macos/`); TypeScript core (actions, resize, converters); AI abstraction + mock + routes; radial menu UI; results/settings/resize dialog; samples; 29 unit tests; CI workflow; README/CHANGES/developer.md; live-tested in Chromium via Playwright.
**In progress:** –
**Next:** web workers; HEIC input; PWA; crop/annotate; real-browser cross-testing; screenshot GIF.
