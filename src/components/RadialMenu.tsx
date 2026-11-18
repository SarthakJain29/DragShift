"use client";
import type { Ring } from "@/lib/actions";
import { R_HUB, SIZE, petalCenter, petalPath } from "@/lib/geometry";

interface Props {
  cx: number;
  cy: number;
  rings: Ring[];
  ringIndex: number;
  hover: number; // petal index, -2 hub, -1 none
  hubLabel: string;
  hubSub?: string;
  mode: "drag" | "click";
  /** 0..1 progress of the hub dwell that flips rings */
  dwell?: number;
}

const RING_HUE: Record<string, string> = { Convert: "var(--coral)", Tools: "var(--violet)", AI: "var(--lime)" };

/** The signature UI: petals that open under the cursor. Pure presentation — hit-testing lives in App. */
export default function RadialMenu({ cx, cy, rings, ringIndex, hover, hubLabel, hubSub, mode, dwell = 0 }: Props) {
  const ring = rings[ringIndex];
  const items = ring?.items ?? [];
  const n = items.length;
  const hue = ring ? RING_HUE[ring.name] : "var(--muted)";
  const active = hover >= 0 ? items[hover] : undefined;

  return (
    <div
      className="radial"
      data-mode={mode}
      style={{ left: cx - SIZE / 2, top: cy - SIZE / 2, width: SIZE, height: SIZE, ["--hue" as string]: hue }}
      role="menu"
      aria-label={ring ? `${ring.name} actions` : "Drop files"}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden>
        <defs>
          <radialGradient id="petalGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--hue)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--hue)" stopOpacity="0.55" />
          </radialGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R_HUB + 3} className="hub-ring" />
        {dwell > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R_HUB + 3}
            className="hub-progress"
            pathLength={100}
            strokeDasharray={`${dwell * 100} 100`}
          />
        )}
        {items.map((it, i) => {
          const [x, y] = petalCenter(n, i);
          const on = hover === i;
          return (
            <g key={it.key} className={`petal ${on ? "on" : ""}`} style={{ animationDelay: `${i * 30}ms` }}>
              <path d={petalPath(n, i)} className="petal-shape" fill={on ? "url(#petalGlow)" : undefined} />
              <text x={x} y={y - 6} className="petal-glyph" textAnchor="middle">
                {it.glyph.length <= 2 ? it.glyph : ""}
              </text>
              <text x={x} y={y + (it.glyph.length <= 2 ? 16 : 5)} className="petal-label" textAnchor="middle">
                {it.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={`hub ${hover === -2 ? "on" : ""}`} style={{ width: R_HUB * 2, height: R_HUB * 2 }}>
        <strong>{active ? active.label : hubLabel}</strong>
        <span>{active ? active.hint : hubSub}</span>
      </div>
      {rings.length > 1 && (
        <div className="ring-dots" aria-hidden>
          {rings.map((r, i) => (
            <i key={r.name} className={i === ringIndex ? "cur" : ""} title={r.name} />
          ))}
          <b>{ring?.name}</b>
        </div>
      )}
    </div>
  );
}
