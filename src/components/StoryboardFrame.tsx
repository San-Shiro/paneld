import React, { useCallback, useMemo, useRef, useState } from "react";
import { renderStrokeToSvgPath } from "../core/freehand";
import { BRUSH_PRESETS } from "../core/presets";
import {
  hitTestStroke,
  LazyBrushStabilizer,
  packPoints,
  simplifyPoints,
  type Point2D,
} from "../core/simplify";
import type {
  CollaboratorPresence,
  CompactStroke,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
import { BackgroundLayer } from "./BackgroundLayer";

export interface StoryboardFrameProps {
  frame: StoryboardFrameData;
  interactive: boolean;
  activeTool?: StoryboardToolId;
  strokeColor?: string;
  strokeSize?: number;
  stabilizerRadius?: number;
  onionSkinStrokes?: CompactStroke[];
  remoteCollaborators?: CollaboratorPresence[];
  onCommitStroke?: (frameId: string, stroke: CompactStroke) => void;
  onEraseStroke?: (frameId: string, strokeId: string) => void;
  onInFlightMove?: (
    frameId: string,
    x: number,
    y: number,
    inFlightStroke: CompactStroke | null
  ) => void;
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
  onCommitStroke,
  onEraseStroke,
  onInFlightMove,
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isDrawingRef = useRef(false);
  const rawPointsRef = useRef<Point2D[]>([]);
  const stabilizerRef = useRef(new LazyBrushStabilizer(stabilizerRadius));
  const [inFlightStroke, setInFlightStroke] = useState<CompactStroke | null>(null);
  const [cursorPos, setCursorPos] = useState<Point2D | null>(null);

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

  const toFrameCoords = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const scaleX = frame.width / (rect.width || 1);
      const scaleY = frame.height / (rect.height || 1);
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [frame.width, frame.height]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const pt = toFrameCoords(e.clientX, e.clientY);
      isDrawingRef.current = true;

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

      const draft: CompactStroke = {
        id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        tool: activeTool,
        layer: preset.layer,
        color: effectiveColor,
        size: effectiveSize,
        opacity: preset.opacity,
        pts: [startPt.x, startPt.y],
        seed: Math.floor(Math.random() * 100000),
      };

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
      onEraseStroke,
      onInFlightMove,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const pt = toFrameCoords(e.clientX, e.clientY);
      setCursorPos(pt);

      if (!isDrawingRef.current) {
        onInFlightMove?.(frame.id, pt.x, pt.y, null);
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

      // Extract coalesced high-frequency events when supported by browser
      const nativeEvt = e.nativeEvent as PointerEvent;
      const coalesced =
        typeof nativeEvt.getCoalescedEvents === "function"
          ? nativeEvt.getCoalescedEvents()
          : [nativeEvt];

      for (const ce of coalesced) {
        const subPt = toFrameCoords(ce.clientX, ce.clientY);
        if (activeTool === "rect") {
          rawPointsRef.current = [rawPointsRef.current[0]!, subPt];
        } else {
          const stabilized = stabilizerRef.current.update(subPt.x, subPt.y);
          const last = rawPointsRef.current[rawPointsRef.current.length - 1];
          if (!last || Math.hypot(stabilized.x - last.x, stabilized.y - last.y) >= 1.2) {
            rawPointsRef.current.push(stabilized);
          }
        }
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
      toFrameCoords,
      onEraseStroke,
      onInFlightMove,
    ]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || !isDrawingRef.current) return;
      e.stopPropagation();
      isDrawingRef.current = false;

      if (activeTool !== "eraser" && inFlightStroke && rawPointsRef.current.length > 0) {
        // Compress & simplify points before committing to storage/sync
        const simplified =
          activeTool === "rect"
            ? rawPointsRef.current
            : simplifyPoints(rawPointsRef.current, 0.85);

        const finalStroke: CompactStroke = {
          ...inFlightStroke,
          pts: packPoints(simplified),
        };
        onCommitStroke?.(frame.id, finalStroke);
      }

      rawPointsRef.current = [];
      setInFlightStroke(null);
      onInFlightMove?.(frame.id, cursorPos?.x ?? 0, cursorPos?.y ?? 0, null);
    },
    [interactive, activeTool, inFlightStroke, frame.id, cursorPos, onCommitStroke, onInFlightMove]
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className={`block select-none touch-none ${className}`}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerCancel={interactive ? handlePointerUp : undefined}
      onPointerLeave={
        interactive
          ? (e) => {
              setCursorPos(null);
              handlePointerUp(e);
            }
          : undefined
      }
      style={{
        width: "100%",
        height: "100%",
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

      {/* Active Brush Ring Preview */}
      {interactive && cursorPos && (
        <circle
          cx={cursorPos.x}
          cy={cursorPos.y}
          r={Math.max(2, effectiveSize / 2)}
          fill="none"
          stroke={activeTool === "eraser" ? "#ef4444" : effectiveColor}
          strokeWidth={1.2}
          opacity={0.65}
          className="pointer-events-none"
        />
      )}
    </svg>
  );
};
