import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollaboratorPresence,
  CompactStroke,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
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
  onInFlightMove,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 80, y: 70 });
  const [zoom, setZoom] = useState(0.75);
  const [spacePressed, setSpacePressed] = useState(false);

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

  // Track Spacebar for pan mode, or shortcut 'D' for debug HUD
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

  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

  // Build sequential cinematic flow arrows connecting frames
  const sequenceConnectors = React.useMemo(() => {
    if (!showSequenceArrows || frames.length < 2) return [];

    const connectors: { id: string; d: string; label: string }[] = [];
    for (let i = 0; i < frames.length - 1; i++) {
      const from = frames[i]!;
      const to = frames[i + 1]!;

      // Connect right edge of from-frame to left edge of to-frame
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;

      const dx = endX - startX;
      const ctrlDist = Math.max(60, Math.abs(dx) * 0.5);

      const d = `M ${startX} ${startY} C ${startX + ctrlDist} ${startY}, ${endX - ctrlDist} ${endY}, ${endX} ${endY}`;
      connectors.push({
        id: `conn_${from.id}_${to.id}`,
        d,
        label: `${from.shotNumber} ➔ ${to.shotNumber}`,
      });
    }
    return connectors;
  }, [frames, showSequenceArrows]);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
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
        <rect width="100%" height="100%" fill="url(#infinite_board_grid)" />
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
            </defs>
            {sequenceConnectors.map((c) => (
              <g key={c.id}>
                <path
                  d={c.d}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  markerEnd="url(#sequence_arrow)"
                  opacity={0.65}
                />
              </g>
            ))}
          </svg>
        )}

        {/* Frames Layer */}
        {frames.map((frame, index) => {
          const isActive = activeFrameId === frame.id;
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
                boxShadow: isActive
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
                onDoubleClick={() => focusFrame(frame)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  backgroundColor: isActive ? "#1e1b4b" : "#202026",
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
                      backgroundColor: isActive ? "#6366f1" : "#3f3f46",
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
                      width: 190,
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

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusFrame(frame);
                    }}
                    title="Zoom to fit shot"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "none",
                      color: "#e4e4e7",
                      borderRadius: 5,
                      padding: "3px 8px",
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
                      padding: "3px 8px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Duplicate
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
                        padding: "3px 8px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

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
            </div>
          );
        })}
      </div>

      {/* Floating Infinite Canvas Navigation & Debug Controls */}
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
          Hold [Space] + Drag • [D] Debug
        </span>
      </div>

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
