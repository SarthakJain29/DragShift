import { textToPdf } from "./convert/pdf";

/** Generated on the fly so anyone can try the app without hunting for a file. */
export async function sampleImage(): Promise<File> {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 1000;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 1600, 1000);
  g.addColorStop(0, "#ff5c7a");
  g.addColorStop(0.5, "#7c5cff");
  g.addColorStop(1, "#36e2ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1600, 1000);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + (i % 5) * 0.03})`;
    ctx.beginPath();
    ctx.arc((i * 397) % 1600, (i * 211) % 1000, 40 + ((i * 53) % 160), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.font = "800 150px system-ui, sans-serif";
  ctx.fillText("sunset-mesh", 90, 560);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "sunset-mesh.png", { type: "image/png" });
}

const ARTICLE = `Quarterly update: shipping faster with fewer meetings

Revenue grew 18% this quarter, driven mostly by the new self-serve plan. The team shipped the redesigned onboarding flow in March and activation rose from 31% to 44% within three weeks.

Support volume dropped by a fifth after the help-center rewrite. Median first response time is now under two hours, and customer satisfaction held steady at 4.6 out of 5.

Engineering cut the weekly meeting load from nine hours to four by moving status updates into a written digest. Build times fell after the CI cache was reworked, so the average pull request now merges in under a day.

Next quarter the focus is reliability and international expansion. We plan to launch in two new regions, add a second payment provider, and finish the migration of legacy accounts to the new billing system.`;

export function sampleText(): File {
  return new File([ARTICLE], "quarterly-update.txt", { type: "text/plain" });
}

export async function samplePdf(): Promise<File> {
  const { blob } = await textToPdf(ARTICLE, "quarterly-update.txt", false);
  return new File([blob], "quarterly-update.pdf", { type: "application/pdf" });
}
