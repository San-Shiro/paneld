import React from "react";
import type { Point2D } from "../core/simplify";
import type { LiveStrokeStats } from "../core/debug";

export interface DrawingDebugOverlayProps {
  width: number;
  height: number;
  rawPoints: Point2D[];
  cursorPos: Point2D | null;
  stats: LiveStrokeStats | null;
  isDrawing: boolean;
}

export const DrawingDebugOverlay: React.FC<DrawingDebugOverlayProps> = ({
  width,
  height,
  rawPoints,
  cursorPos,
  stats,
  isDrawing,
}) => {
  const pointsStr = React.useMemo(() => {
    if (rawPoints.length < 2) return "";
    return rawPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }, [rawPoints]);

  return (
    <g className="pointer-events-none" style={{ pointerEvents: "none" }}>
      {/* Frame Active Perimeter Border */}
      <rect
        x={1}
        y={1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        fill="none"
        stroke={isDrawing ? "#10b981" : "#6366f1"}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        opacity={0.6}
      />

      {/* Raw Input Points Trail (Before RDP Simplification) */}
      {pointsStr && (
        <polyline
          points={pointsStr}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.8}
        />
      )}

      {/* Individual Raw Sample Dots */}
      {rawPoints.map((pt, i) => (
        <circle
          key={i}
          cx={pt.x}
          cy={pt.y}
          r={i === 0 ? 3.5 : 1.5}
          fill={i === 0 ? "#10b981" : "#f59e0b"}
          opacity={0.85}
        />
      ))}

      {/* Live Stroke Bounding Box */}
      {stats?.bbox && isDrawing && (
        <rect
          x={stats.bbox.minX}
          y={stats.bbox.minY}
          width={Math.max(2, stats.bbox.maxX - stats.bbox.minX)}
          height={Math.max(2, stats.bbox.maxY - stats.bbox.minY)}
          fill="rgba(16, 185, 129, 0.05)"
          stroke="#10b981"
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.8}
        />
      )}

      {/* Real-time Cursor / Touch Crosshair */}
      {cursorPos && (
        <g>
          <line
            x1={cursorPos.x - 12}
            y1={cursorPos.y}
            x2={cursorPos.x + 12}
            y2={cursorPos.y}
            stroke="#ec4899"
            strokeWidth={1}
          />
          <line
            x1={cursorPos.x}
            y1={cursorPos.y - 12}
            x2={cursorPos.x}
            y2={cursorPos.y + 12}
            stroke="#ec4899"
            strokeWidth={1}
          />
          <text
            x={cursorPos.x + 8}
            y={cursorPos.y - 8}
            fill="#ec4899"
            fontSize={10}
            fontFamily="monospace"
            fontWeight={600}
          >
            {`${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)}`}
          </text>
        </g>
      )}
    </g>
  );
};
