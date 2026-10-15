// Core Types & Data Contracts
export type {
  AspectRatioId,
  AspectRatioPreset,
  BackgroundPatternId,
  BoardDocument,
  BoardSnapshot,
  BrushPreset,
  CollaboratorPresence,
  CompactStroke,
  CompositionGuideId,
  PaperThemeId,
  PaperThemePreset,
  SpatialNote,
  StoryboardFrameData,
  StoryboardToolId,
  StoryLink,
  StrokeLayer,
} from "./core/types";

// Presets (Aspect Ratios, Paper Themes, Patterns, Guides, Brushes)
export {
  ASPECT_RATIOS,
  BACKGROUND_PATTERNS,
  BRUSH_PRESETS,
  COMPOSITION_GUIDES,
  PAPER_THEMES,
  STORYBOARD_PALETTE,
} from "./core/presets";

// Forked Freehand & Storyboard Geometry Math
export {
  computeActionArrowSvg,
  computeFreehandPolygon,
  computeSketchyRectSvg,
  polygonToSmoothSvgPath,
  renderStrokeToSvgPath,
  type FreehandStrokeOptions,
} from "./core/freehand";

// Point Simplification, Quantization & Stabilizer
export {
  hitTestStroke,
  LazyBrushStabilizer,
  measureByteSize,
  packPoints,
  quantize,
  simplifyPoints,
  unpackPoints,
  type Point2D,
} from "./core/simplify";

// History & Lightweight Snapshot Versioning
export { createBoardSnapshot, FrameHistoryManager } from "./core/history";

// Pluggable Live Sync Engine
export {
  BroadcastChannelSyncAdapter,
  CustomCallbackSyncAdapter,
  type StoryboardSyncAdapter,
  type SyncMessage,
} from "./core/sync";

// React Components
export { BackgroundLayer, type BackgroundLayerProps } from "./components/BackgroundLayer";
export { StoryboardFrame, type StoryboardFrameProps } from "./components/StoryboardFrame";
export { InfiniteBoard, type InfiniteBoardProps } from "./components/InfiniteBoard";
export { StoryboardStudio, type StoryboardStudioProps } from "./components/StoryboardStudio";
export { DrawingDebugOverlay, type DrawingDebugOverlayProps } from "./components/DrawingDebugOverlay";
export { DrawingDebugHUD, type DrawingDebugHUDProps } from "./components/DrawingDebugHUD";

// Debug & Diagnostics Telemetry
export {
  PointerEventRingBuffer,
  globalPointerRingBuffer,
  type LiveStrokeStats,
  type PointerLifecycle,
  type PointerLogEvent,
} from "./core/debug";
