/** Geometry of the radial menu (px in a SIZE×SIZE box). Mirrors the native macOS app. */
export const SIZE = 400;
export const R_OUT = 158;
export const R_IN = 62;
export const R_HUB = 50;
const C = SIZE / 2;

/** Angle span (degrees, clockwise from 12 o'clock) of petal i of n; petal 0 is centred at 12 o'clock. */
export function petalSpan(n: number, i: number): [number, number] {
  const span = 360 / n;
  return [i * span - span / 2, i * span + span / 2];
}

/**
 * What is under (x, y) relative to the menu centre?
 * Returns petal index, -2 for the hub, -1 for nothing.
 */
export function hitTest(dx: number, dy: number, n: number): number {
  const r = Math.hypot(dx, dy);
  if (r <= R_HUB) return -2;
  if (r < R_IN || r > R_OUT + 14 || n <= 0) return -1;
  // clockwise degrees from 12 o'clock, 0..360
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const span = 360 / n;
  return Math.floor(((deg + span / 2) % 360) / span);
}

const pt = (r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

/** SVG path of a ring sector with a constant-width gap to its neighbours. */
export function petalPath(n: number, i: number, gap = 7, r0 = R_IN, r1 = R_OUT): string {
  const [a0, a1] = petalSpan(n, i);
  const d0 = ((gap / 2 / r0) * 180) / Math.PI;
  const d1 = ((gap / 2 / r1) * 180) / Math.PI;
  const [x0, y0] = pt(r1, a0 + d1);
  const [x1, y1] = pt(r1, a1 - d1);
  const [x2, y2] = pt(r0, a1 - d0);
  const [x3, y3] = pt(r0, a0 + d0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Centre point of petal i, for its label. */
export function petalCenter(n: number, i: number): [number, number] {
  const [a0, a1] = petalSpan(n, i);
  return pt((R_IN + R_OUT) / 2, (a0 + a1) / 2);
}

/** Clamp a menu centre so the whole menu stays inside the viewport. */
export function clampCenter(x: number, y: number, vw: number, vh: number): [number, number] {
  const h = SIZE / 2;
  return [Math.min(Math.max(x, h), Math.max(h, vw - h)), Math.min(Math.max(y, h), Math.max(h, vh - h))];
}
