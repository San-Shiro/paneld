export type AspectRatioId = "2.39:1" | "1.85:1" | "16:9" | "4:3" | "1:1" | "9:16";

export type PaperThemeId = "paper-white" | "warm-cream" | "studio-dark" | "blueprint";

export type BackgroundPatternId = "blank" | "dots" | "grid" | "isometric";

export type CompositionGuideId =
  | "thirds"
  | "center"
  | "safe-zones"
  | "perspective-1p"
  | "perspective-2p";

export type StoryboardToolId = "pencil" | "ink" | "tone" | "arrow" | "rect" | "eraser";

export type StrokeLayer = "pencil" | "tone" | "ink" | "notes";

export interface AspectRatioPreset {
  id: AspectRatioId;
  label: string;
  subtitle: string;
  width: number;
  height: number;
}

export interface PaperThemePreset {
  id: PaperThemeId;
  label: string;
  bg: string;
  gridColor: string;
  guideColor: string;
  defaultInkColor: string;
  toneColor: string;
}

export interface BrushPreset {
  id: StoryboardToolId;
  label: string;
  shortcut: string;
  layer: StrokeLayer;
  defaultSize: number;
  defaultColor: string;
  opacity: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  startTaper: number;
  endTaper: number;
  description: string;
}

/**
 * Ultra-compact vector stroke representation.
 * `pts` is a flat array of quantized coordinates: [x0, y0, x1, y1, ...]
 * (or [x0, y0, p0, x1, y1, p1, ...] when hardware pressure is recorded).
 */
export interface CompactStroke {
  id: string;
  tool: StoryboardToolId;
  layer: StrokeLayer;
  color: string;
  size: number;
  opacity: number;
  /** Flat coordinate array [x0, y0, x1, y1, ...] rounded to 0.5px precision */
  pts: number[];
  /** Deterministic PRNG seed for hand-drawn shape wobble */
  seed?: number;
}

export interface StoryboardFrameData {
  id: string;
  shotNumber: string;
  title: string;
  sceneHeading?: string;
  caption?: string;
  cameraNote?: string;
  aspectRatio: AspectRatioId;
  width: number;
  height: number;
  paperTheme: PaperThemeId;
  pattern: BackgroundPatternId;
  guides: CompositionGuideId[];
  hideRoughLayer?: boolean;
  /** Position on the Tier-2 Infinite Spatial Board */
  x: number;
  y: number;
  strokes: CompactStroke[];
  updatedAt: number;
}

export interface SpatialNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

export interface BoardSnapshot {
  id: string;
  label: string;
  createdAt: number;
  authorName?: string;
  byteSize: number;
  frames: StoryboardFrameData[];
  notes: SpatialNote[];
}

export interface BoardDocument {
  id: string;
  title: string;
  frames: StoryboardFrameData[];
  notes: SpatialNote[];
  snapshots: BoardSnapshot[];
}

export interface CollaboratorPresence {
  clientId: string;
  name: string;
  color: string;
  activeFrameId: string | null;
  worldX: number;
  worldY: number;
  frameX?: number;
  frameY?: number;
  inFlightStroke?: CompactStroke | null;
  lastSeen: number;
}
