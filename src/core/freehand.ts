import { BRUSH_PRESETS } from "./presets";
import { unpackPoints, type Point2D } from "./simplify";
import type { CompactStroke } from "./types";

export interface FreehandStrokeOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  startTaper: number;
  endTaper: number;
}

/**
 * Deterministic SplitMix32 PRNG (Excalidraw / Rough.js style)
 * Ensures hand-sketched wobble never vibrates across re-renders.
 */
function createSeededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/**
 * Convert an array of 2D polygon outline points into a smooth Quadratic Bezier SVG path string.
 */
export function polygonToSmoothSvgPath(points: Point2D[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0]!;
    return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} Z`;
  }
  if (points.length === 2) {
    return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)} L ${points[1]!.x.toFixed(1)} ${points[1]!.y.toFixed(1)} Z`;
  }

  const first = points[0]!;
  const second = points[1]!;
  let d = `M ${((first.x + second.x) / 2).toFixed(1)} ${((first.y + second.y) / 2).toFixed(1)}`;

  for (let i = 1; i < points.length; i++) {
    const curr = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  return d + " Z";
}

/**
 * Forked & Storyboard-Tuned Freehand Ribbon Generator.
 * Converts a sequence of 2D points into a variable-width 2D polygon contour
 * with velocity-simulated pressure, streamline filtering, and sharp ink tapering.
 */
export function computeFreehandPolygon(
  rawPoints: Point2D[],
  options: FreehandStrokeOptions
): Point2D[] {
  const { size, thinning, streamline, startTaper, endTaper } = options;
  const rBase = Math.max(0.75, size / 2);

  if (rawPoints.length === 0) return [];
  if (rawPoints.length === 1) {
    const c = rawPoints[0]!;
    const circle: Point2D[] = [];
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      circle.push({ x: c.x + Math.cos(a) * rBase, y: c.y + Math.sin(a) * rBase });
    }
    return circle;
  }

  // 1. Streamline low-pass filter to remove mouse/trackpad steps
  const alpha = Math.max(0.15, Math.min(0.9, 1 - streamline * 0.78));
  const pts: Point2D[] = [rawPoints[0]!];
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = pts[pts.length - 1]!;
    const curr = rawPoints[i]!;
    const x = prev.x + (curr.x - prev.x) * alpha;
    const y = prev.y + (curr.y - prev.y) * alpha;
    if (Math.hypot(x - prev.x, y - prev.y) > 0.4 || i === rawPoints.length - 1) {
      pts.push({ x, y });
    }
  }

  if (pts.length < 2) {
    pts.push({ x: pts[0]!.x + 0.5, y: pts[0]!.y + 0.5 });
  }

  // 2. Compute cumulative arc length & local velocity pressure
  const dists: number[] = [0];
  const pressures: number[] = [0.5];
  let totalLength = 0;

  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    totalLength += segLen;
    dists.push(totalLength);

    // Simulated velocity pressure: faster motion -> thinner ink line
    const normSpeed = Math.min(1, segLen / 28);
    const targetPressure = 1 - normSpeed * 0.65;
    const prevP = pressures[i - 1]!;
    pressures.push(prevP + (targetPressure - prevP) * 0.35);
  }

  // 3. Build Left and Right ribbon edges along point normals
  const leftPts: Point2D[] = [];
  const rightPts: Point2D[] = [];

  for (let i = 0; i < pts.length; i++) {
    const curr = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;

    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tLen = Math.hypot(tx, ty) || 1;
    tx /= tLen;
    ty /= tLen;

    // Perpendicular unit normal
    const nx = -ty;
    const ny = tx;

    // Radius from velocity thinning
    const p = pressures[i]!;
    const thinFactor = thinning > 0 ? 1 - thinning * (1 - p) : 1;
    let radius = rBase * Math.max(0.22, thinFactor);

    // Apply start and end tapering
    const dFromStart = dists[i]!;
    const dFromEnd = totalLength - dFromStart;

    if (startTaper > 0 && dFromStart < startTaper) {
      radius *= Math.max(0.12, dFromStart / startTaper);
    }
    if (endTaper > 0 && dFromEnd < endTaper) {
      radius *= Math.max(0.08, dFromEnd / endTaper);
    }

    leftPts.push({ x: curr.x + nx * radius, y: curr.y + ny * radius });
    rightPts.push({ x: curr.x - nx * radius, y: curr.y - ny * radius });
  }

  // 4. Construct closed contour with rounded start cap
  const startCenter = pts[0]!;
  const startLeft = leftPts[0]!;
  const startRight = rightPts[0]!;
  const startCap: Point2D[] = [];
  const startAngle = Math.atan2(startRight.y - startCenter.y, startRight.x - startCenter.x);
  const startRadius = Math.hypot(startLeft.x - startCenter.x, startLeft.y - startCenter.y);

  for (let s = 1; s <= 4; s++) {
    const a = startAngle + (s / 5) * Math.PI;
    startCap.push({
      x: startCenter.x + Math.cos(a) * startRadius,
      y: startCenter.y + Math.sin(a) * startRadius,
    });
  }

  return [...leftPts, ...rightPts.reverse(), ...startCap];
}

/**
 * Generates an SVG path for a one-stroke Storyboard Action / Camera Arrow.
 * Automatically tapers the shaft from thin tail to bold head and attaches a sharp directional arrowhead.
 */
export function computeActionArrowSvg(rawPoints: Point2D[], size: number): string {
  if (rawPoints.length < 2) return "";

  // Smooth the shaft curve
  const shaftPoly = computeFreehandPolygon(rawPoints, {
    size: size * 1.15,
    thinning: 0.4,
    smoothing: 0.7,
    streamline: 0.72,
    startTaper: size * 5,
    endTaper: 0,
  });

  const shaftPath = polygonToSmoothSvgPath(shaftPoly);

  // Compute arrowhead direction from the last few points
  const tip = rawPoints[rawPoints.length - 1]!;
  const lookbackIdx = Math.max(0, rawPoints.length - 5);
  const anchor = rawPoints[lookbackIdx]!;

  let dx = tip.x - anchor.x;
  let dy = tip.y - anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const headLength = Math.max(16, size * 4.2);
  const headWidth = Math.max(12, size * 3.0);

  const forwardTip = {
    x: tip.x + dx * (headLength * 0.45),
    y: tip.y + dy * (headLength * 0.45),
  };
  const baseCenter = {
    x: tip.x - dx * (headLength * 0.55),
    y: tip.y - dy * (headLength * 0.55),
  };

  const nx = -dy;
  const ny = dx;

  const wingLeft = {
    x: baseCenter.x + nx * headWidth,
    y: baseCenter.y + ny * headWidth,
  };
  const wingRight = {
    x: baseCenter.x - nx * headWidth,
    y: baseCenter.y - ny * headWidth,
  };

  const headPath = `M ${forwardTip.x.toFixed(1)} ${forwardTip.y.toFixed(1)} L ${wingLeft.x.toFixed(1)} ${wingLeft.y.toFixed(1)} L ${wingRight.x.toFixed(1)} ${wingRight.y.toFixed(1)} Z`;

  return `${shaftPath} ${headPath}`;
}

/**
 * Generates an Excalidraw / Rough.js style double-pass sketchy rectangle path
 * for inner camera zoom frames or prop boxes.
 */
export function computeSketchyRectSvg(
  p0: Point2D,
  p1: Point2D,
  seed = 1337
): string {
  const rand = createSeededRandom(seed);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);

  if (w < 2 && h < 2) return "";

  const jitter = (amp: number) => (rand() - 0.5) * amp;

  const corners: [Point2D, Point2D][] = [
    [{ x, y }, { x: x + w, y }],
    [{ x: x + w, y }, { x: x + w, y: y + h }],
    [{ x: x + w, y: y + h }, { x, y: y + h }],
    [{ x, y: y + h }, { x, y }],
  ];

  let d = "";
  // Double-pass hand-drawn edges
  for (let pass = 0; pass < 2; pass++) {
    const amp = pass === 0 ? 2.2 : 1.4;
    for (const [a, b] of corners) {
      const mx = (a.x + b.x) / 2 + jitter(amp * 1.5);
      const my = (a.y + b.y) / 2 + jitter(amp * 1.5);
      d += `M ${(a.x + jitter(amp)).toFixed(1)} ${(a.y + jitter(amp)).toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${(b.x + jitter(amp)).toFixed(1)} ${(b.y + jitter(amp)).toFixed(1)} `;
    }
  }
  return d.trim();
}

/**
 * Unified helper to convert any `CompactStroke` into its renderable SVG path data.
 */
export function renderStrokeToSvgPath(stroke: CompactStroke): {
  d: string;
  isStroked: boolean;
} {
  const points = unpackPoints(stroke.pts);
  if (points.length === 0) return { d: "", isStroked: false };

  if (stroke.tool === "rect") {
    const p0 = points[0]!;
    const p1 = points[points.length - 1]!;
    return {
      d: computeSketchyRectSvg(p0, p1, stroke.seed ?? 42),
      isStroked: true,
    };
  }

  if (stroke.tool === "arrow") {
    return {
      d: computeActionArrowSvg(points, stroke.size),
      isStroked: false,
    };
  }

  const preset = BRUSH_PRESETS[stroke.tool] ?? BRUSH_PRESETS.ink;
  const poly = computeFreehandPolygon(points, {
    size: stroke.size,
    thinning: preset.thinning,
    smoothing: preset.smoothing,
    streamline: preset.streamline,
    startTaper: preset.startTaper,
    endTaper: preset.endTaper,
  });

  return {
    d: polygonToSmoothSvgPath(poly),
    isStroked: false,
  };
}
