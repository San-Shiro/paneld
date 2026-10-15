import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderStrokeToSvgPath } from "../core/freehand";
import { BRUSH_PRESETS } from "../core/presets";
import {
  hitTestStroke,
  LazyBrushStabilizer,
  packPoints,
  simplifyPoints,
  type Point2D,
} from "../core/simplify";
import {
  globalPointerRingBuffer,
  type LiveStrokeStats,
} from "../core/debug";
import type {
  CollaboratorPresence,
  CompactStroke,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
import { BackgroundLayer } from "./BackgroundLayer";
import { DrawingDebugOverlay } from "./DrawingDebugOverlay";

export interface StoryboardFrameProps {
  frame: StoryboardFrameData;
  interactive: boolean;
  activeTool?: StoryboardToolId;
  strokeColor?: string;
  strokeSize?: number;
  stabilizerRadius?: number;
  onionSkinStrokes?: CompactStroke[];
  remoteCollaborators?: CollaboratorPresence[];
  debugMode?: boolean;
  intraZoom?: number;
  intraPan?: { x: number; y: number };
  onCommitStroke?: (frameId: string, stroke: CompactStroke) => void;
  onEraseStroke?: (frameId: string, strokeId: string) => void;
  onInFlightMove?: (
    frameId: string,
    x: number,
    y: number,
    inFlightStroke: CompactStroke | null
  ) => void;
  onDebugStatsChange?: (stats: LiveStrokeStats | null) => void;
  className?: string;
}

const StrokePath: React.FC<{ stroke: CompactStroke }> = React.memo(({ stroke }) => {
  const { d, isStroked } = useMemo(() => renderStrokeToSvgPath(stroke), [stroke]);
  if (!d) return null;

  if (isStroked) {
    return (
      <path
        d={d}
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.size}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={stroke.opacity}
      />
    );
  }

  return <path d={d} fill={stroke.color} opacity={stroke.opacity} />;
});

export const StoryboardFrame: React.FC<StoryboardFrameProps> = ({
  frame,
  interactive,
  activeTool = "ink",
  strokeColor,
  strokeSize,
  stabilizerRadius = 6,
  onionSkinStrokes,
  remoteCollaborators = [],
  debugMode = false,
  intraZoom = 1,
  intraPan,
  onCommitStroke,
  onEraseStroke,
  onInFlightMove,
  onDebugStatsChange,
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Canonical artwork dimensions (preserves strokes without clipping when aspect ratio changes)
  const contentW = frame.contentWidth ?? frame.width;
  const contentH = frame.contentHeight ?? frame.height;
  const fitMode = frame.fitMode ?? "contain";

  // Calculate non-destructive aperture containment transform
  const apertureTransform = useMemo(() => {
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    if (frame.width !== contentW || frame.height !== contentH) {
      scale =
        fitMode === "contain"
          ? Math.min(frame.width / contentW, frame.height / contentH)
          : Math.max(frame.width / contentW, frame.height / contentH);

      offsetX = (frame.width - contentW * scale) / 2;
      offsetY = (frame.height - contentH * scale) / 2;
    }

    const zoomFactor = intraZoom && intraZoom > 0 ? intraZoom : 1;
    const finalScale = scale * zoomFactor;
    const finalOffsetX = offsetX + (intraPan?.x || 0);
    const finalOffsetY = offsetY + (intraPan?.y || 0);

    return { scale: finalScale, offsetX: finalOffsetX, offsetY: finalOffsetY };
  }, [frame.width, frame.height, contentW, contentH, fitMode, intraZoom, intraPan]);

  // Robust pointer tracking refs
  const activePointerIdRef = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const captureHeldRef = useRef(false);
  const finishingRef = useRef(false);

  const rawPointsRef = useRef<Point2D[]>([]);
  const stabilizerRef = useRef(new LazyBrushStabilizer(stabilizerRadius));
  const [inFlightStroke, setInFlightStroke] = useState<CompactStroke | null>(null);
  const [cursorPos, setCursorPos] = useState<Point2D | null>(null);

  // Live debug stroke telemetry
  const strokeStatsRef = useRef<LiveStrokeStats | null>(null);

  const preset = BRUSH_PRESETS[activeTool] ?? BRUSH_PRESETS.ink;
  const effectiveColor = strokeColor || preset.defaultColor;
  const effectiveSize = strokeSize ?? preset.defaultSize;

  // Partition strokes into the 4 WonderUnit Storyboarder layers
  const layeredStrokes = useMemo(() => {
    const pencil: CompactStroke[] = [];
    const tone: CompactStroke[] = [];
    const ink: CompactStroke[] = [];
    const notes: CompactStroke[] = [];

    for (const s of frame.strokes) {
      if (s.layer === "pencil") pencil.push(s);
      else if (s.layer === "tone") tone.push(s);
      else if (s.layer === "notes") notes.push(s);
      else ink.push(s);
    }

    return { pencil, tone, ink, notes };
  }, [frame.strokes]);

  /**
   * Convert screen (clientX, clientY) to SVG frame coordinates using CTM,
   * then invert through the aperture containment transform so all strokes
   * land in the canonical content coordinate space without cropping or distortion.
   */
  const toFrameCoords = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };

      let apX = 0;
      let apY = 0;

      try {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
          if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
            apX = pt.x;
            apY = pt.y;
          }
        }
      } catch {
        // Fallback to bounding rect if CTM inversion encounters singular matrix
        const rect = svg.getBoundingClientRect();
        const scaleX = frame.width / (rect.width || 1);
        const scaleY = frame.height / (rect.height || 1);
        apX = (clientX - rect.left) * scaleX;
        apY = (clientY - rect.top) * scaleY;
      }

      // Invert aperture transform to land precisely into canonical content space
      const { scale, offsetX, offsetY } = apertureTransform;
      return {
        x: (apX - offsetX) / (scale || 1),
        y: (apY - offsetY) / (scale || 1),
      };
    },
    [frame.width, frame.height, apertureTransform]
  );

  const checkInBounds = useCallback(
    (pt: Point2D) => {
      return pt.x >= 0 && pt.x <= frame.width && pt.y >= 0 && pt.y <= frame.height;
    },
    [frame.width, frame.height]
  );

  // Safe pointer capture release helper
  const releaseCaptureSafely = useCallback((el: SVGSVGElement | null, pointerId: number) => {
    if (!el) return;
    try {
      if (typeof el.hasPointerCapture === "function" && el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignorable browser capture release edge-cases
    }
    captureHeldRef.current = false;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;

      // For mouse input, allow primary button only; for touch/pen allow primary touch
      if (e.pointerType === "mouse" && e.button !== 0) return;

      // If another pointer is already drawing, do not preempt or corrupt active stroke
      if (activePointerIdRef.current !== null && activePointerIdRef.current !== e.pointerId) {
        return;
      }

      e.stopPropagation();

      const pt = toFrameCoords(e.clientX, e.clientY);
      const inBounds = checkInBounds(pt);

      // Acquire pointer capture on the SVG element
      activePointerIdRef.current = e.pointerId;
      isDrawingRef.current = true;
      finishingRef.current = false;

      let captureStatus: "requested" | "held" | "error" = "requested";
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        captureHeldRef.current = e.currentTarget.hasPointerCapture(e.pointerId);
        captureStatus = captureHeldRef.current ? "held" : "requested";
      } catch {
        captureHeldRef.current = false;
        captureStatus = "error";
      }

      // Log DOWN event to RingBuffer
      globalPointerRingBuffer.push("DOWN", {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        clientX: e.clientX,
        clientY: e.clientY,
        frameX: pt.x,
        frameY: pt.y,
        inBounds,
        pressure: e.pressure,
        buttons: e.buttons,
        capture: captureStatus,
        detail: `tool: ${activeTool}`,
      });

      if (activeTool === "eraser") {
        for (let i = frame.strokes.length - 1; i >= 0; i--) {
          const s = frame.strokes[i]!;
          if (hitTestStroke(s, pt.x, pt.y, effectiveSize)) {
            onEraseStroke?.(frame.id, s.id);
            break;
          }
        }
        return;
      }

      stabilizerRef.current.setRadius(
        activeTool === "rect" ? 0 : stabilizerRadius
      );
      const startPt = stabilizerRef.current.reset(pt.x, pt.y);
      rawPointsRef.current = [startPt];

      const strokeId = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const draft: CompactStroke = {
        id: strokeId,
        tool: activeTool,
        layer: preset.layer,
        color: effectiveColor,
        size: effectiveSize,
        opacity: preset.opacity,
        pts: [startPt.x, startPt.y],
        seed: Math.floor(Math.random() * 100000),
      };

      // Initialize live stats for debug HUD
      const initialStats: LiveStrokeStats = {
        strokeId,
        tool: activeTool,
        layer: preset.layer,
        rawPointCount: 1,
        simplifiedPointCount: 1,
        inFlightPointCount: 1,
        pathLength: 0,
        estimatedBytes: 32,
        stabilizerActive: stabilizerRadius > 0,
        pressureMin: e.pressure || 0.5,
        pressureMax: e.pressure || 0.5,
        bbox: { minX: startPt.x, minY: startPt.y, maxX: startPt.x, maxY: startPt.y },
      };
      strokeStatsRef.current = initialStats;
      onDebugStatsChange?.(initialStats);

      setInFlightStroke(draft);
      onInFlightMove?.(frame.id, pt.x, pt.y, draft);
    },
    [
      interactive,
      activeTool,
      effectiveColor,
      effectiveSize,
      stabilizerRadius,
      preset,
      frame.id,
      frame.strokes,
      toFrameCoords,
      checkInBounds,
      onEraseStroke,
      onInFlightMove,
      onDebugStatsChange,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;

      const pt = toFrameCoords(e.clientX, e.clientY);
      setCursorPos(pt);

      // If hovering without drawing
      if (!isDrawingRef.current) {
        onInFlightMove?.(frame.id, pt.x, pt.y, null);
        return;
      }

      // If this pointer is not the active drawing pointer, ignore it
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }

      e.stopPropagation();

      if (activeTool === "eraser") {
        for (let i = frame.strokes.length - 1; i >= 0; i--) {
          const s = frame.strokes[i]!;
          if (hitTestStroke(s, pt.x, pt.y, effectiveSize)) {
            onEraseStroke?.(frame.id, s.id);
            break;
          }
        }
        return;
      }

      // Extract high-frequency coalesced events from browser pointer hardware
      const nativeEvt = e.nativeEvent as PointerEvent;
      const coalesced =
        typeof nativeEvt.getCoalescedEvents === "function"
          ? nativeEvt.getCoalescedEvents()
          : [nativeEvt];

      const coalescedCount = coalesced.length;
      let minX = strokeStatsRef.current?.bbox?.minX ?? pt.x;
      let minY = strokeStatsRef.current?.bbox?.minY ?? pt.y;
      let maxX = strokeStatsRef.current?.bbox?.maxX ?? pt.x;
      let maxY = strokeStatsRef.current?.bbox?.maxY ?? pt.y;
      let addedLength = 0;

      for (const ce of coalesced) {
        const subPt = toFrameCoords(ce.clientX, ce.clientY);
        if (activeTool === "rect") {
          rawPointsRef.current = [rawPointsRef.current[0]!, subPt];
        } else {
          const stabilized = stabilizerRef.current.update(subPt.x, subPt.y);
          const last = rawPointsRef.current[rawPointsRef.current.length - 1];
          if (!last || Math.hypot(stabilized.x - last.x, stabilized.y - last.y) >= 1.0) {
            if (last) addedLength += Math.hypot(stabilized.x - last.x, stabilized.y - last.y);
            rawPointsRef.current.push(stabilized);

            minX = Math.min(minX, stabilized.x);
            minY = Math.min(minY, stabilized.y);
            maxX = Math.max(maxX, stabilized.x);
            maxY = Math.max(maxY, stabilized.y);
          }
        }
      }

      // Record MOVE sample to RingBuffer
      const inBounds = checkInBounds(pt);
      globalPointerRingBuffer.push("MOVE", {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        clientX: e.clientX,
        clientY: e.clientY,
        frameX: pt.x,
        frameY: pt.y,
        inBounds,
        pressure: e.pressure,
        buttons: e.buttons,
        coalescedCount,
        capture: captureHeldRef.current ? "held" : "none",
        strokeId: inFlightStroke?.id,
      });

      // Update in-flight stroke and live stats
      const rawCount = rawPointsRef.current.length;
      if (strokeStatsRef.current) {
        strokeStatsRef.current.rawPointCount = rawCount;
        strokeStatsRef.current.inFlightPointCount = rawCount;
        strokeStatsRef.current.pathLength += addedLength;
        strokeStatsRef.current.estimatedBytes = rawCount * 8 + 32;
        strokeStatsRef.current.bbox = { minX, minY, maxX, maxY };
        onDebugStatsChange?.({ ...strokeStatsRef.current });
      }

      setInFlightStroke((prev) => {
        if (!prev) return null;
        const updated: CompactStroke = {
          ...prev,
          pts: packPoints(rawPointsRef.current),
        };
        onInFlightMove?.(frame.id, pt.x, pt.y, updated);
        return updated;
      });
    },
    [
      interactive,
      activeTool,
      effectiveSize,
      frame.id,
      frame.strokes,
      inFlightStroke?.id,
      toFrameCoords,
      checkInBounds,
      onEraseStroke,
      onInFlightMove,
      onDebugStatsChange,
    ]
  );

  const completeStroke = useCallback(
    (reason: "UP" | "CANCEL" | "LOST_CAPTURE") => {
      if (!isDrawingRef.current || finishingRef.current) return;
      finishingRef.current = true;

      const pointerId = activePointerIdRef.current;
      isDrawingRef.current = false;

      // Log termination event
      globalPointerRingBuffer.push(reason, {
        pointerId: pointerId ?? undefined,
        capture: "none",
        strokeId: inFlightStroke?.id,
        detail: `points: ${rawPointsRef.current.length}`,
      });

      if (
        reason === "UP" &&
        activeTool !== "eraser" &&
        inFlightStroke &&
        rawPointsRef.current.length > 0
      ) {
        // Compress & simplify points before committing
        const simplified =
          activeTool === "rect"
            ? rawPointsRef.current
            : simplifyPoints(rawPointsRef.current, 0.85);

        const finalStroke: CompactStroke = {
          ...inFlightStroke,
          pts: packPoints(simplified),
        };

        if (strokeStatsRef.current) {
          strokeStatsRef.current.simplifiedPointCount = simplified.length;
          strokeStatsRef.current.estimatedBytes = simplified.length * 8 + 32;
          onDebugStatsChange?.({ ...strokeStatsRef.current });
        }

        onCommitStroke?.(frame.id, finalStroke);
      }

      // Release capture safely
      if (pointerId !== null) {
        releaseCaptureSafely(svgRef.current, pointerId);
      }

      activePointerIdRef.current = null;
      rawPointsRef.current = [];
      setInFlightStroke(null);
      strokeStatsRef.current = null;
      onDebugStatsChange?.(null);
      onInFlightMove?.(frame.id, cursorPos?.x ?? 0, cursorPos?.y ?? 0, null);
      finishingRef.current = false;
    },
    [
      activeTool,
      inFlightStroke,
      frame.id,
      cursorPos,
      releaseCaptureSafely,
      onCommitStroke,
      onInFlightMove,
      onDebugStatsChange,
    ]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      e.stopPropagation();
      completeStroke("UP");
    },
    [completeStroke]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      e.stopPropagation();
      // On mobile gesture collision or system cancel, commit what was drawn or terminate cleanly
      completeStroke("CANCEL");
    },
    [completeStroke]
  );

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (activePointerIdRef.current !== null && e.pointerId === activePointerIdRef.current) {
        completeStroke("LOST_CAPTURE");
      }
    },
    [completeStroke]
  );

  // Global window blur listener to prevent stuck drawing state if user switches apps/tabs
  useEffect(() => {
    const handleBlur = () => {
      if (isDrawingRef.current) {
        globalPointerRingBuffer.push("BLUR", { detail: "window blur / tab switch" });
        completeStroke("CANCEL");
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [completeStroke]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className={`block select-none touch-none ${className}`}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerCancel={interactive ? handlePointerCancel : undefined}
      onLostPointerCapture={interactive ? handleLostPointerCapture : undefined}
      onPointerLeave={
        interactive
          ? (e) => {
              // Crucial fix: DO NOT terminate the stroke on pointerleave!
              // Active pointer capture allows continuous drawing outside SVG boundaries.
              if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) {
                setCursorPos(null);
              }
            }
          : undefined
      }
      style={{
        width: "100%",
        height: "100%",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: interactive
          ? activeTool === "eraser"
            ? "cell"
            : "crosshair"
          : "pointer",
      }}
    >
      {/* Layer 0: Paper Theme, Surface Pattern & Cinematography Guides */}
      <BackgroundLayer
        frameId={frame.id}
        width={frame.width}
        height={frame.height}
        paperTheme={frame.paperTheme}
        pattern={frame.pattern}
        guides={frame.guides}
      />

      {/* Aperture Clip Boundary to prevent edge bleeding on canvas resize */}
      <defs>
        <clipPath id={`aperture_clip_${frame.id}`}>
          <rect width={frame.width} height={frame.height} />
        </clipPath>
      </defs>

      {/* Non-destructive scaled artwork viewport */}
      <g clipPath={`url(#aperture_clip_${frame.id})`}>
        <g
          transform={`translate(${apertureTransform.offsetX}, ${apertureTransform.offsetY}) scale(${apertureTransform.scale})`}
        >
          {/* Optional Onion Skin (Previous Panel Ghosting at 14% opacity) */}
          {onionSkinStrokes && onionSkinStrokes.length > 0 && (
            <g opacity={0.14} className="pointer-events-none">
              {onionSkinStrokes.map((s) => (
                <StrokePath key={`onion_${s.id}`} stroke={s} />
              ))}
            </g>
          )}

          {/* Layer 1: Rough Under-Sketch Pencil (Can be hidden with 1 click) */}
          {!frame.hideRoughLayer && (
            <g data-layer="pencil">
              {layeredStrokes.pencil.map((s) => (
                <StrokePath key={s.id} stroke={s} />
              ))}
              {inFlightStroke?.layer === "pencil" && <StrokePath stroke={inFlightStroke} />}
            </g>
          )}

          {/* Layer 2: Shading / Tone Marker (ALWAYS renders behind Ink!) */}
          <g data-layer="tone">
            {layeredStrokes.tone.map((s) => (
              <StrokePath key={s.id} stroke={s} />
            ))}
            {inFlightStroke?.layer === "tone" && <StrokePath stroke={inFlightStroke} />}
          </g>

          {/* Layer 3: Crisp Ink Outlines */}
          <g data-layer="ink">
            {layeredStrokes.ink.map((s) => (
              <StrokePath key={s.id} stroke={s} />
            ))}
            {inFlightStroke?.layer === "ink" && <StrokePath stroke={inFlightStroke} />}
          </g>

          {/* Layer 4: Director Notes, Camera Frames & Action Arrows */}
          <g data-layer="notes">
            {layeredStrokes.notes.map((s) => (
              <StrokePath key={s.id} stroke={s} />
            ))}
            {inFlightStroke?.layer === "notes" && <StrokePath stroke={inFlightStroke} />}
          </g>

          {/* Live Remote Collaborator In-Flight Strokes & Cursors */}
          {remoteCollaborators
            .filter((c) => c.activeFrameId === frame.id)
            .map((peer) => (
              <g key={peer.clientId} className="pointer-events-none">
                {peer.inFlightStroke && <StrokePath stroke={peer.inFlightStroke} />}
                {peer.frameX !== undefined && peer.frameY !== undefined && (
                  <g transform={`translate(${peer.frameX}, ${peer.frameY})`}>
                    <circle r={5} fill={peer.color} stroke="#ffffff" strokeWidth={1.5} />
                    <rect
                      x={8}
                      y={-10}
                      width={peer.name.length * 6.5 + 10}
                      height={18}
                      rx={4}
                      fill={peer.color}
                    />
                    <text
                      x={13}
                      y={2}
                      fill="#ffffff"
                      fontSize={10}
                      fontWeight={600}
                      fontFamily="system-ui, sans-serif"
                    >
                      {peer.name}
                    </text>
                  </g>
                )}
              </g>
            ))}

          {/* Active Brush Ring Preview in Canonical Space */}
          {interactive && cursorPos && (
            <circle
              cx={cursorPos.x}
              cy={cursorPos.y}
              r={Math.max(2, effectiveSize / 2)}
              fill="none"
              stroke={activeTool === "eraser" ? "#ef4444" : effectiveColor}
              strokeWidth={1.2 / apertureTransform.scale}
              opacity={0.65}
              className="pointer-events-none"
            />
          )}
        </g>
      </g>

      {/* High-Visibility Debug Overlay */}
      {debugMode && (
        <DrawingDebugOverlay
          width={frame.width}
          height={frame.height}
          rawPoints={rawPointsRef.current}
          cursorPos={cursorPos}
          stats={strokeStatsRef.current}
          isDrawing={isDrawingRef.current}
        />
      )}
    </svg>
  );
};
