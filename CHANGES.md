# CHANGES — what changed and why

Interview-friendly walkthrough. Short version: *the original project was a good native macOS idea that nobody could try. I kept it, and built a web version with the same signature interaction plus AI features, tests and CI.*

## Architecture in one minute

```
src/
  app/            Next.js App Router: page, layout, globals.css, /api/ai, /api/status
  components/     App (state + drag&drop), RadialMenu (SVG), ResultCard, ResizeDialog
  lib/
    files.ts      kind detection, sizes, unique names, UserError
    actions.ts    buildRings(files) → Convert / Tools / AI petals (pure)
    geometry.ts   petal paths + hitTest(dx, dy, n) (pure)
    resize.ts     resize math
    jobs.ts       runJob(actionKey, files) → result summary (orchestrator)
    convert/      image.ts (Canvas) · pdf.ts (pdf-lib + pdf.js) · text.ts (docx/text)
    ai/           types · prompts · mock · gemini · groq · index (provider chain) · client
macos/            the original Swift app, unchanged
tests/            Vitest: core logic + AI chain
```

Data flow: drop → `App` builds rings with `buildRings` → user picks a petal → `runJob` dispatches on a string key like `convert:PNG`, `tool:Compress`, `ai:Summarize` → converters return `Blob`s → `ResultCard` offers downloads. Keeping the action **key** a plain string (same idea as the Swift `MenuItem.key`) means the menu, the buttons and the job runner all share one vocabulary.

## Feature by feature

### 1. Restructure and stack change
- **What:** moved Swift package to `macos/`; added Next.js 15 + React 19 + strict TypeScript at the root.
- **Why:** the native app couldn't be demoed or tested off a Mac. Web = link, screenshots, CI. Next.js gives a server route for secret API keys and free Vercel hosting.
- **Say in interview:** "I kept the original rather than deleting it; the web app is a sibling that shares the interaction design."

### 2. Radial drop menu (the signature feature)
- **What:** while you drag a file anywhere over the page, a petal menu blooms under the cursor; release on a petal to run it. Hover the hub (with a progress ring) to cycle Convert → Tools → AI. Release elsewhere → same menu in click mode (Tab also cycles; Esc closes).
- **How:** `RadialMenu.tsx` is purely presentational SVG. `geometry.ts` generates petal paths with a constant gap and does hit-testing from the pointer angle/radius (`atan2` → petal index) — this runs in the window's `dragover` handler because elements don't receive normal hover events mid-drag.
- **Browser constraint:** during a drag the browser hides file *names* but exposes MIME types, so the pre-drop menu is built from MIME types; on drop, rings are rebuilt from real files.
- **Why testable:** geometry and ring-building are pure functions with unit tests.

### 3. Local-first conversions & tools
- **Images:** Canvas decode (`createImageBitmap` with EXIF orientation) → PNG/JPG/WEBP; JPG draws on white because it has no alpha; unsupported encoders (Safari WEBP) are detected because browsers silently return PNG.
- **Compress:** JPG/WEBP re-encoded at 0.72; PNG → WEBP (keeps alpha) with JPG fallback; result card shows "% smaller" or "already well compressed".
- **Resize:** percent / longest / width / height via `resizeDims`.
- **PDF:** pdf-lib for split/rotate/merge/images→PDF/text→PDF; pdf.js renders pages to PNG/JPG and extracts text. Encrypted PDFs give a clear message.
- **DOCX:** unzip with JSZip, parse `word/document.xml` paragraphs → text/PDF.
- **Text:** encoding sniffing (UTF-8 → UTF-16 BOM → Windows-1252), word-wrapped monospaced PDF layout (a unit-tested wrap function; fixed a trailing-space bug the tests caught).
- **Why:** privacy (no uploads) and zero server cost.

### 4. AI features with a provider abstraction and mock mode
- **What:** Summarize, Rename (downloads a renamed copy), Alt text (vision), Suggest.
- **How:** `AiProvider` interface (`complete()`); `gemini.ts` and `groq.ts` implement it with `fetch`; `runAi` tries configured providers in order and finally the deterministic `mockAnswer` (extractive summary, keyword slug names, heuristic suggestions). `/api/ai` validates input, caps sizes, and rate-limits.
- **Graceful failure:** any provider error falls through; the UI badge says "Groq", "Gemini", "Demo mode" or "offline fallback" and shows the reason. Verified live: Gemini 503 → Groq answered.
- **Security:** keys only in server env; `.env.example` has names only; client never sees keys; `/api/status` exposes only the provider name.
- **Interview point:** model names go stale (I hit 404s) → configurable via env and fallback chain.

### 5. Results, loading, empty and error states
- Spinner card while working, error cards with friendly messages (`UserError`), empty state with samples, unsupported-file toast, download single / ZIP all, remove/clear, image thumbnails.

### 6. Design system
- Hand-written CSS tokens (`:root`), aurora gradient background, glass panels, Bricolage Grotesque display type, springy bloom animations, `prefers-reduced-motion` respected, responsive down to 390px (checked: no horizontal scroll), focus-visible rings.

### 7. Quality
- 29 Vitest tests (files, resize, ring building, geometry, docx/text helpers, wrap, AI provider selection/fallback/mock). ESLint (next/core-web-vitals + TS), `tsc --noEmit`, GitHub Actions CI (lint, typecheck, test, build).
- Manually verified in headless Chromium with Playwright: compress, resize, PNG→PDF, PDF→TXT/PNG, split, DOCX→PDF/TXT, text→PDF, AI summarize/rename (live Groq), simulated drag menu, unsupported file, mobile layout.

## Things I'd say are *not* done
Native app unverified in this session; HEIC/TIFF/AVIF not in web; no web workers; no OCR; no real-OS drag test. See `developer.md` → Blockers & Known issues.
