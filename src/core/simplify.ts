import type { CompactStroke } from "./types";

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Quantize a coordinate to 0.5px precision to keep JSON numbers compact.
 */
export function quantize(val: number): number {
  return Math.round(val * 2) / 2;
}

/**
 * Unpack flat [x0, y0, x1, y1, ...] array into Point2D objects.
 */
export function unpackPoints(flat: number[]): Point2D[] {
  const out: Point2D[] = [];
  for (let i = 0; i < flat.length - 1; i += 2) {
    out.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return out;
}

/**
 * Pack Point2D array into quantized flat [x0, y0, x1, y1, ...] array.
 */
export function packPoints(points: Point2D[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(quantize(p.x), quantize(p.y));
  }
  return out;
}

/**
 * Perpendicular distance from point P to segment AB.
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const magSq = dx * dx + dy * dy;
  if (magSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / magSq));
  const projX = a.x + u * dx;
  const projY = a.y + u * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Ramer-Douglas-Peucker (RDP) curve simplification.
 * Drops collinear / micro-jitter points while preserving corners and curves.
 */
export function simplifyPoints(points: Point2D[], epsilon = 1.1): Point2D[] {
  if (points.length <= 3) return points;

  let maxDist = 0;
  let index = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, index + 1), epsilon);
    const right = simplifyPoints(points.slice(index), epsilon);
    return [...left.slice(0, left.length - 1), ...right];
  }

  return [first, last];
}

/**
 * Real-time "Lazy String" Brush Stabilizer (Procreate StreamLine / Lazy Nezumi physics).
 * Eliminates mouse & trackpad hand tremor by pulling the brush nib with a virtual string.
 */
export class LazyBrushStabilizer {
  private brush: Point2D = { x: 0, y: 0 };
  private radius: number;

  constructor(radius = 8) {
    this.radius = radius;
  }

  setRadius(radius: number) {
    this.radius = Math.max(0, radius);
  }

  reset(x: number, y: number): Point2D {
    this.brush = { x, y };
    return { ...this.brush };
  }

  update(pointerX: number, pointerY: number): Point2D {
    if (this.radius <= 0.5) {
      this.brush = { x: pointerX, y: pointerY };
      return { ...this.brush };
    }
    const dx = pointerX - this.brush.x;
    const dy = pointerY - this.brush.y;
    const dist = Math.hypot(dx, dy);

    if (dist > this.radius) {
      const angle = Math.atan2(dy, dx);
      this.brush = {
        x: pointerX - Math.cos(angle) * this.radius,
        y: pointerY - Math.sin(angle) * this.radius,
      };
    }
    return { ...this.brush };
  }
}

/**
 * Check if an eraser at (x, y) with `radius` hits a CompactStroke.
 */
export function hitTestStroke(stroke: CompactStroke, x: number, y: number, radius = 14): boolean {
  const pts = unpackPoints(stroke.pts);
  if (pts.length === 0) return false;
  const hitThreshold = radius + stroke.size * 0.5;

  if (stroke.tool === "rect" && pts.length >= 2) {
    const p0 = pts[0]!;
    const p1 = pts[pts.length - 1]!;
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p0.y, p1.y);
    const nearLeftRight =
      (Math.abs(x - minX) <= hitThreshold || Math.abs(x - maxX) <= hitThreshold) &&
      y >= minY - hitThreshold &&
      y <= maxY + hitThreshold;
    const nearTopBottom =
      (Math.abs(y - minY) <= hitThreshold || Math.abs(y - maxY) <= hitThreshold) &&
      x >= minX - hitThreshold &&
      x <= maxX + hitThreshold;
    return nearLeftRight || nearTopBottom;
  }

  if (pts.length === 1) {
    return Math.hypot(pts[0]!.x - x, pts[0]!.y - y) <= hitThreshold;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const d = perpendicularDistance({ x, y }, pts[i]!, pts[i + 1]!);
    if (d <= hitThreshold) return true;
  }
  return false;
}

/**
 * Estimate byte size of a JSON-serialized structure for telemetry/UI display.
 */
export function measureByteSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}
