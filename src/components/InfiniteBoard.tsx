import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollaboratorPresence,
  CompactStroke,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
import { StoryboardFrame } from "./StoryboardFrame";

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

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, origX: 0, origY: 0 });

  const draggingFrameRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Track Spacebar for pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        setSpacePressed(true);
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
  }, []);

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
      e.currentTarget.setPointerCapture(e.pointerId);
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

  const handleBoardPointerUp = () => {
    isPanningRef.current = false;
    draggingFrameRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handleBoardPointerDown}
      onPointerMove={handleBoardPointerMove}
      onPointerUp={handleBoardPointerUp}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#0c0c0f",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)",
        backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: spacePressed || isPanningRef.current ? "grabbing" : "default",
        userSelect: "none",
      }}
    >
      {/* World Space Transform Plane */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          pointerEvents: spacePressed ? "none" : "auto",
        }}
      >
        {/* Sequence Flow Arrows Between Shots */}
        {showSequenceArrows && frames.length > 1 && (
          <svg
            style={{
              position: "absolute",
              top: -5000,
              left: -5000,
              width: 20000,
              height: 20000,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <defs>
              <marker
                id="seq-arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" />
              </marker>
            </defs>
            {frames.slice(0, -1).map((curr, idx) => {
              const next = frames[idx + 1]!;
              const x1 = 5000 + curr.x + curr.width;
              const y1 = 5000 + curr.y + curr.height / 2;
              const x2 = 5000 + next.x;
              const y2 = 5000 + next.y + next.height / 2;
              const cx1 = x1 + Math.max(60, Math.abs(x2 - x1) * 0.35);
              const cx2 = x2 - Math.max(60, Math.abs(x2 - x1) * 0.35);
              return (
                <path
                  key={`seq_${curr.id}_${next.id}`}
                  d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  strokeDasharray="8 6"
                  opacity={0.55}
                  markerEnd="url(#seq-arrow)"
                />
              );
            })}
          </svg>
        )}

        {/* Storyboard Frame Cards */}
        {frames.map((frame, index) => {
          const isActive = frame.id === activeFrameId;
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
                    Clone
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
                  onCommitStroke={onCommitStroke}
                  onEraseStroke={onEraseStroke}
                  onInFlightMove={onInFlightMove}
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

      {/* Floating Infinite Canvas Navigation Controls */}
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
        <span style={{ color: "#71717a", marginLeft: 6, fontSize: 11 }}>
          Hold [Space] + Drag or Scroll to Pan • [Ctrl+Wheel] Zoom
        </span>
      </div>
    </div>
  );
};
