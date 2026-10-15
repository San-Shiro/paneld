import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AspectRatioId,
  CollaboratorPresence,
  CompactStroke,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
import { ASPECT_RATIOS } from "../core/presets";
import { StoryboardFrame } from "./StoryboardFrame";
import {
  globalPointerRingBuffer,
  type LiveStrokeStats,
  type PointerLogEvent,
} from "../core/debug";
import { DrawingDebugHUD } from "./DrawingDebugHUD";

export interface InfiniteBoardProps {
  frames: StoryboardFrameData[];
  activeFrameId: string | null;
  activeTool: StoryboardToolId;
  strokeColor: string;
  strokeSize: number;
  stabilizerRadius: number;
  onionSkinEnabled: boolean;
  showSequenceArrows: boolean;
  remoteCollaborators: CollaboratorPresence[];
  debugMode?: boolean;
  onToggleDebug?: () => void;
  onSelectFrame: (frameId: string) => void;
  onMoveFrame: (frameId: string, x: number, y: number) => void;
  onUpdateFrameMeta: (frameId: string, patch: Partial<StoryboardFrameData>) => void;
  onCommitStroke: (frameId: string, stroke: CompactStroke) => void;
  onEraseStroke: (frameId: string, strokeId: string) => void;
  onDuplicateFrame: (frameId: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onAddFrameAt?: (worldX: number, worldY: number, aspect?: AspectRatioId) => void;
  onInFlightMove?: (
    frameId: string,
    x: number,
    y: number,
    inFlightStroke: CompactStroke | null
  ) => void;
}

export const InfiniteBoard: React.FC<InfiniteBoardProps> = ({
  frames,
  activeFrameId,
  activeTool,
  strokeColor,
  strokeSize,
  stabilizerRadius,
  onionSkinEnabled,
  showSequenceArrows,
  remoteCollaborators,
  debugMode: parentDebugMode,
  onToggleDebug,
  onSelectFrame,
  onMoveFrame,
  onUpdateFrameMeta,
  onCommitStroke,
  onEraseStroke,
  onDuplicateFrame,
  onDeleteFrame,
  onAddFrameAt,
  onInFlightMove,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 80, y: 70 });
  const [zoom, setZoom] = useState(0.75);
  const [spacePressed, setSpacePressed] = useState(false);

  // Intra-shot Zoom (Shot Edit Mode)
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [shotZoomMap, setShotZoomMap] = useState<Record<string, number>>({});

  // Right-click Canvas Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  // Manual Join / Link Target Picker State
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);

  // Internal debug mode toggle fallback
  const [internalDebugMode, setInternalDebugMode] = useState(false);
  const isDebugActive = parentDebugMode !== undefined ? parentDebugMode : internalDebugMode;

  const handleToggleDebug = useCallback(() => {
    if (onToggleDebug) {
      onToggleDebug();
    } else {
      setInternalDebugMode((prev) => !prev);
    }
  }, [onToggleDebug]);

  // Debug telemetry state
  const [debugEvents, setDebugEvents] = useState<PointerLogEvent[]>([]);
  const [debugStats, setDebugStats] = useState<LiveStrokeStats | null>(null);
  const [lastDebugEvent, setLastDebugEvent] = useState<PointerLogEvent | null>(null);

  // Poll ring buffer periodically when debug mode is enabled
  useEffect(() => {
    if (!isDebugActive) return;
    const interval = setInterval(() => {
      const all = globalPointerRingBuffer.getAll();
      setDebugEvents(all);
      if (all.length > 0) {
        setLastDebugEvent(all[all.length - 1] ?? null);
      }
    }, 120);
    return () => clearInterval(interval);
  }, [isDebugActive]);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, origX: 0, origY: 0 });

  const draggingFrameRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Dismiss context menu and link picker on global clicks
  useEffect(() => {
    const handleDismiss = () => {
      setContextMenu(null);
      setLinkingFromId(null);
    };
    window.addEventListener("click", handleDismiss);
    return () => window.removeEventListener("click", handleDismiss);
  }, []);

  // Track Spacebar for pan mode, or shortcut 'D' for debug HUD, 'Escape' to exit Shot Edit Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.code === "Space") {
        setSpacePressed(true);
      } else if (e.key === "d" || e.key === "D") {
        handleToggleDebug();
      } else if (e.key === "Escape") {
        setContextMenu(null);
        setLinkingFromId(null);
        setEditingShotId(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleToggleDebug]);

  // Wheel zoom & two-finger trackpad pan
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const nextZoom = Math.min(2.8, Math.max(0.18, zoom * factor));

        // Zoom toward cursor position
        const worldX = (mouseX - pan.x) / zoom;
        const worldY = (mouseY - pan.y) / zoom;

        setZoom(nextZoom);
        setPan({
          x: mouseX - worldX * nextZoom,
          y: mouseY - worldY * nextZoom,
        });
      } else {
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    },
    [pan, zoom]
  );

  // Focus & fit a specific frame smoothly in the viewport
  const focusFrame = useCallback(
    (frame: StoryboardFrameData) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const targetZoom = Math.min(
        1.25,
        Math.min((rect.width * 0.72) / frame.width, (rect.height * 0.68) / frame.height)
      );
      const centerX = rect.width / 2 - (frame.x + frame.width / 2) * targetZoom;
      const centerY = rect.height / 2 - (frame.y + frame.height / 2) * targetZoom;
      setZoom(targetZoom);
      setPan({ x: centerX, y: centerY });
      onSelectFrame(frame.id);
    },
    [onSelectFrame]
  );

  // Right-click on infinite background to add a shot frame at exact world position
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const isBg =
        target === containerRef.current ||
        target.tagName.toLowerCase() === "rect" ||
        target.hasAttribute("data-board-bg");

      if (isBg) {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const worldX = Math.round((e.clientX - rect.left - pan.x) / zoom);
        const worldY = Math.round((e.clientY - rect.top - pan.y) / zoom);

        setContextMenu({
          clientX: e.clientX,
          clientY: e.clientY,
          worldX: worldX - 400,
          worldY: worldY - 225,
        });
      }
    },
    [pan, zoom]
  );

  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Dismiss context menus if clicking outside
    if (contextMenu) setContextMenu(null);
    if (linkingFromId) setLinkingFromId(null);

    // Middle click, Space+Click, or clicking directly on the infinite background
    if (e.button === 1 || spacePressed || e.target === e.currentTarget) {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        origX: pan.x,
        origY: pan.y,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.origX + dx,
        y: panStartRef.current.origY + dy,
      });
      return;
    }

    if (draggingFrameRef.current) {
      const { id, startClientX, startClientY, origX, origY } = draggingFrameRef.current;
      const dx = (e.clientX - startClientX) / zoom;
      const dy = (e.clientY - startClientY) / zoom;
      onMoveFrame(id, Math.round(origX + dx), Math.round(origY + dy));
    }
  };

  const handleBoardPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }
    draggingFrameRef.current = null;
  };

  // Build sequential & manual cinematic flow connectors connecting frames
  const sequenceConnectors = useMemo(() => {
    if (!showSequenceArrows || frames.length < 2) return [];

    const frameMap = new Map(frames.map((f) => [f.id, f]));
    const connectors: {
      id: string;
      d: string;
      label: string;
      fromId: string;
      toId: string;
      isManual: boolean;
    }[] = [];

    const explicitLinked = new Set<string>();

    // 1. Process explicit manual join links
    for (const from of frames) {
      if (from.nextFrameId && frameMap.has(from.nextFrameId)) {
        const to = frameMap.get(from.nextFrameId)!;
        explicitLinked.add(from.id);

        const startX = from.x + from.width;
        const startY = from.y + from.height / 2;
        const endX = to.x;
        const endY = to.y + to.height / 2;
        const dx = endX - startX;
        const ctrlDist = Math.max(60, Math.abs(dx) * 0.5);

        connectors.push({
          id: `conn_manual_${from.id}_${to.id}`,
          fromId: from.id,
          toId: to.id,
          isManual: true,
          d: `M ${startX} ${startY} C ${startX + ctrlDist} ${startY}, ${endX - ctrlDist} ${endY}, ${endX} ${endY}`,
          label: `${from.shotNumber} ➔ ${to.shotNumber}`,
        });
      }
    }

    // 2. Default sequential links for frames without explicit links
    for (let i = 0; i < frames.length - 1; i++) {
      const from = frames[i]!;
      const to = frames[i + 1]!;
      if (!explicitLinked.has(from.id)) {
        const startX = from.x + from.width;
        const startY = from.y + from.height / 2;
        const endX = to.x;
        const endY = to.y + to.height / 2;
        const dx = endX - startX;
        const ctrlDist = Math.max(60, Math.abs(dx) * 0.5);

        connectors.push({
          id: `conn_seq_${from.id}_${to.id}`,
          fromId: from.id,
          toId: to.id,
          isManual: false,
          d: `M ${startX} ${startY} C ${startX + ctrlDist} ${startY}, ${endX - ctrlDist} ${endY}, ${endX} ${endY}`,
          label: `${from.shotNumber} ➔ ${to.shotNumber}`,
        });
      }
    }

    return connectors;
  }, [frames, showSequenceArrows]);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      onPointerDown={handleBoardPointerDown}
      onPointerMove={handleBoardPointerMove}
      onPointerUp={handleBoardPointerUp}
      onPointerCancel={handleBoardPointerUp}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        backgroundColor: "#0d0d11",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: spacePressed ? "grab" : "default",
      }}
    >
      {/* Background Dot Matrix Grid */}
      <svg
        data-board-bg="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          opacity: 0.16,
        }}
      >
        <defs>
          <pattern
            id="infinite_board_grid"
            width={40 * zoom}
            height={40 * zoom}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${pan.x % (40 * zoom)}, ${pan.y % (40 * zoom)})`}
          >
            <circle cx={2} cy={2} r={1.2} fill="#ffffff" />
          </pattern>
        </defs>
        <rect
          data-board-bg="true"
          width="100%"
          height="100%"
          fill="url(#infinite_board_grid)"
        />
      </svg>

      {/* World Space Container (Pan & Zoomed) */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          willChange: "transform",
        }}
      >
        {/* SVG Cinematic Sequence Connectors Layer */}
        {sequenceConnectors.length > 0 && (
          <svg
            style={{
              position: "absolute",
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <defs>
              <marker
                id="sequence_arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#6366f1" />
              </marker>
              <marker
                id="sequence_arrow_manual"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
              </marker>
            </defs>
            {sequenceConnectors.map((c) => (
              <g key={c.id}>
                <path
                  d={c.d}
                  fill="none"
                  stroke={c.isManual ? "#10b981" : "#6366f1"}
                  strokeWidth={c.isManual ? 3 : 2}
                  strokeDasharray={c.isManual ? "none" : "6 4"}
                  markerEnd={
                    c.isManual
                      ? "url(#sequence_arrow_manual)"
                      : "url(#sequence_arrow)"
                  }
                  opacity={c.isManual ? 0.9 : 0.65}
                />
              </g>
            ))}
          </svg>
        )}

        {/* Frames Layer */}
        {frames.map((frame, index) => {
          const isActive = activeFrameId === frame.id;
          const isShotEditMode = editingShotId === frame.id;
          const intraZoom = shotZoomMap[frame.id] ?? 1;
          const prevFrame = index > 0 ? frames[index - 1] : undefined;

          return (
            <div
              key={frame.id}
              onClick={() => {
                if (!isActive) onSelectFrame(frame.id);
              }}
              style={{
                position: "absolute",
                left: frame.x,
                top: frame.y,
                width: frame.width,
                borderRadius: 12,
                backgroundColor: "#18181c",
                boxShadow: isShotEditMode
                  ? "0 0 0 3px #10b981, 0 30px 60px -10px rgba(0,0,0,0.85)"
                  : isActive
                    ? "0 0 0 3px #6366f1, 0 25px 50px -12px rgba(0,0,0,0.75)"
                    : "0 0 0 1px rgba(255,255,255,0.12), 0 15px 30px -10px rgba(0,0,0,0.6)",
                transition: "box-shadow 0.15s ease",
              }}
            >
              {/* Drag Handle & Shot Metadata Bar */}
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  onSelectFrame(frame.id);
                  draggingFrameRef.current = {
                    id: frame.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: frame.x,
                    origY: frame.y,
                  };
                }}
                onDoubleClick={() => {
                  // Double click header toggles Shot Edit Mode (Canvas-only zoom)
                  setEditingShotId(isShotEditMode ? null : frame.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  backgroundColor: isShotEditMode
                    ? "#064e3b"
                    : isActive
                      ? "#1e1b4b"
                      : "#202026",
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  cursor: "grab",
                  color: "#f4f4f5",
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      backgroundColor: isShotEditMode
                        ? "#10b981"
                        : isActive
                          ? "#6366f1"
                          : "#3f3f46",
                      color: "#fff",
                      padding: "2px 7px",
                      borderRadius: 5,
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: "0.04em",
                    }}
                  >
                    SHOT {frame.shotNumber}
                  </span>
                  <input
                    value={frame.title}
                    onChange={(e) =>
                      onUpdateFrameMeta(frame.id, { title: e.target.value })
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#f4f4f5",
                      fontWeight: 600,
                      fontSize: 13,
                      outline: "none",
                      width: 170,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "#a1a1aa",
                      background: "rgba(255,255,255,0.06)",
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {frame.aspectRatio}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {/* Shot Focus / Intra-Shot Zoom Toggle Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingShotId(isShotEditMode ? null : frame.id);
                    }}
                    title="Toggle Canvas Zoom Mode for this shot (Double-click header)"
                    style={{
                      background: isShotEditMode
                        ? "rgba(16, 185, 129, 0.3)"
                        : "rgba(255,255,255,0.08)",
                      border: isShotEditMode ? "1px solid #10b981" : "none",
                      color: isShotEditMode ? "#6ee7b7" : "#e4e4e7",
                      borderRadius: 5,
                      padding: "3px 7px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {isShotEditMode ? "Exit Zoom" : "Canvas Zoom"}
                  </button>

                  {/* Manual Join / Sequence Linking Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkingFromId(linkingFromId === frame.id ? null : frame.id);
                    }}
                    title="Join to another shot in sequence"
                    style={{
                      background: frame.nextFrameId
                        ? "rgba(16, 185, 129, 0.2)"
                        : "rgba(255,255,255,0.08)",
                      border: frame.nextFrameId ? "1px solid #10b981" : "none",
                      color: frame.nextFrameId ? "#34d399" : "#e4e4e7",
                      borderRadius: 5,
                      padding: "3px 7px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {frame.nextFrameId ? `➔ Linked` : `➔ Join`}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusFrame(frame);
                    }}
                    title="Center & fit shot on screen"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "none",
                      color: "#e4e4e7",
                      borderRadius: 5,
                      padding: "3px 7px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Focus
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateFrame(frame.id);
                    }}
                    title="Duplicate Shot (Variant)"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "none",
                      color: "#e4e4e7",
                      borderRadius: 5,
                      padding: "3px 7px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Copy
                  </button>

                  {frames.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFrame(frame.id);
                      }}
                      title="Delete Shot"
                      style={{
                        background: "rgba(239,68,68,0.16)",
                        border: "none",
                        color: "#fca5a5",
                        borderRadius: 5,
                        padding: "3px 7px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Intra-Shot Zoom Toolbar Banner (Visible only in Canvas Zoom Mode) */}
              {isShotEditMode && (
                <div
                  style={{
                    backgroundColor: "rgba(6, 78, 59, 0.95)",
                    borderBottom: "1px solid rgba(16, 185, 129, 0.3)",
                    padding: "4px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "#a7f3d0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 700 }}>🔍 Canvas Zoom:</span>
                    {[1, 1.5, 2, 3].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShotZoomMap((m) => ({ ...m, [frame.id]: level }));
                        }}
                        style={{
                          background:
                            intraZoom === level
                              ? "#10b981"
                              : "rgba(255, 255, 255, 0.1)",
                          color: intraZoom === level ? "#064e3b" : "#fff",
                          border: "none",
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontSize: 10,
                        }}
                      >
                        {level * 100}%
                      </button>
                    ))}
                  </div>
                  <span style={{ color: "#6ee7b7", fontSize: 10 }}>
                    Press Esc to exit
                  </span>
                </div>
              )}

              {/* Tier 1 Storyboard Drawing Surface */}
              <div
                style={{
                  width: frame.width,
                  height: frame.height,
                  position: "relative",
                  overflow: "hidden",
                  touchAction: "none",
                }}
              >
                <StoryboardFrame
                  frame={frame}
                  interactive={isActive && !spacePressed}
                  activeTool={activeTool}
                  strokeColor={strokeColor}
                  strokeSize={strokeSize}
                  stabilizerRadius={stabilizerRadius}
                  onionSkinStrokes={
                    isActive && onionSkinEnabled ? prevFrame?.strokes : undefined
                  }
                  remoteCollaborators={remoteCollaborators}
                  debugMode={isActive && isDebugActive}
                  intraZoom={intraZoom}
                  onCommitStroke={onCommitStroke}
                  onEraseStroke={onEraseStroke}
                  onInFlightMove={onInFlightMove}
                  onDebugStatsChange={(stats) => {
                    setDebugStats(stats);
                    const all = globalPointerRingBuffer.getAll();
                    setDebugEvents(all);
                    if (all.length > 0) {
                      setLastDebugEvent(all[all.length - 1] ?? null);
                    }
                  }}
                />

                {!isActive && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 8,
                      right: 8,
                      background: "rgba(0,0,0,0.65)",
                      color: "#d4d4d8",
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      pointerEvents: "none",
                    }}
                  >
                    Click to sketch ({frame.strokes.length} strokes)
                  </div>
                )}
              </div>

              {/* Shot Action / Dialogue Caption Footer */}
              <div
                style={{
                  padding: "8px 12px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  placeholder="Shot action / dialogue beat / camera lens note..."
                  value={frame.caption ?? ""}
                  onChange={(e) =>
                    onUpdateFrameMeta(frame.id, { caption: e.target.value })
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6,
                    padding: "5px 9px",
                    color: "#e4e4e7",
                    fontSize: 12,
                    outline: "none",
                  }}
                />
              </div>

              {/* Manual Join / Sequence Linking Target Picker Popover */}
              {linkingFromId === frame.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: 42,
                    right: 12,
                    backgroundColor: "#18181c",
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: 8,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.8)",
                    padding: 8,
                    zIndex: 50,
                    width: 220,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#a1a1aa",
                      marginBottom: 6,
                    }}
                  >
                    Join {frame.shotNumber} to Next Shot:
                  </div>
                  <div
                    style={{
                      maxHeight: 160,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {frame.nextFrameId && (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateFrameMeta(frame.id, { nextFrameId: undefined });
                          setLinkingFromId(null);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: "rgba(239,68,68,0.15)",
                          border: "none",
                          color: "#fca5a5",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        ✕ Unlink (Remove Connection)
                      </button>
                    )}
                    {frames
                      .filter((f) => f.id !== frame.id)
                      .map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => {
                            onUpdateFrameMeta(frame.id, { nextFrameId: target.id });
                            setLinkingFromId(null);
                          }}
                          style={{
                            textAlign: "left",
                            padding: "5px 8px",
                            borderRadius: 4,
                            background:
                              frame.nextFrameId === target.id
                                ? "#312e81"
                                : "rgba(255,255,255,0.05)",
                            border:
                              frame.nextFrameId === target.id
                                ? "1px solid #6366f1"
                                : "none",
                            color: "#fff",
                            fontSize: 11,
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>
                            Shot {target.shotNumber}: {target.title}
                          </span>
                          <span style={{ color: "#818cf8" }}>➔</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Canvas Navigation & Debug Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          backgroundColor: "rgba(24,24,28,0.92)",
          border: "1px solid rgba(255,255,255,0.12)",
          padding: "6px 10px",
          borderRadius: 10,
          color: "#e4e4e7",
          fontSize: 12,
          backdropFilter: "blur(8px)",
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.2, +(z - 0.15).toFixed(2)))}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            color: "#fff",
            borderRadius: 5,
            width: 24,
            height: 24,
            cursor: "pointer",
          }}
        >
          -
        </button>
        <span style={{ minWidth: 46, textAlign: "center", fontWeight: 600 }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            color: "#fff",
            borderRadius: 5,
            width: 24,
            height: 24,
            cursor: "pointer",
          }}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(0.75);
            setPan({ x: 80, y: 70 });
          }}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            color: "#d4d4d8",
            borderRadius: 5,
            padding: "4px 8px",
            marginLeft: 4,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Reset View
        </button>

        {/* Debug HUD Toggle Button */}
        <button
          type="button"
          onClick={handleToggleDebug}
          style={{
            background: isDebugActive
              ? "rgba(16, 185, 129, 0.25)"
              : "rgba(255, 255, 255, 0.08)",
            border: isDebugActive
              ? "1px solid #10b981"
              : "1px solid rgba(255,255,255,0.12)",
            color: isDebugActive ? "#34d399" : "#a1a1aa",
            borderRadius: 5,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Toggle Drawing Telemetry & Debug HUD (Key: D)"
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: isDebugActive ? "#10b981" : "#71717a",
            }}
          />
          Debug HUD
        </button>

        <span style={{ color: "#71717a", marginLeft: 6, fontSize: 11 }}>
          Right-Click to Add Shot • Space+Drag • Double-Click Shot to Zoom
        </span>
      </div>

      {/* Right-Click Canvas Context Menu */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: contextMenu.clientX,
            top: contextMenu.clientY,
            backgroundColor: "rgba(24, 24, 28, 0.96)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
            backdropFilter: "blur(12px)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            width: 190,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#a1a1aa",
              padding: "2px 6px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              marginBottom: 4,
            }}
          >
            + Add Shot Here
          </div>
          {Object.values(ASPECT_RATIOS).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onAddFrameAt?.(
                  contextMenu.worldX,
                  contextMenu.worldY,
                  preset.id
                );
                setContextMenu(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                border: "none",
                color: "#f4f4f5",
                fontSize: 11,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{preset.label}</span>
              <span style={{ color: "#71717a", fontSize: 10 }}>{preset.id}</span>
            </button>
          ))}
        </div>
      )}

      {/* Floating Real-Time Diagnostics HUD Panel */}
      <DrawingDebugHUD
        enabled={isDebugActive}
        onToggle={handleToggleDebug}
        onClearLogs={() => {
          globalPointerRingBuffer.clear();
          setDebugEvents([]);
          setLastDebugEvent(null);
        }}
        events={debugEvents}
        stats={debugStats}
        lastEvent={lastDebugEvent}
        activeFrameId={activeFrameId}
      />
    </div>
  );
};
