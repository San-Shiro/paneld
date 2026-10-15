import React from "react";
import { PAPER_THEMES } from "../core/presets";
import type {
  BackgroundPatternId,
  CompositionGuideId,
  PaperThemeId,
} from "../core/types";

export interface BackgroundLayerProps {
  frameId: string;
  width: number;
  height: number;
  paperTheme: PaperThemeId;
  pattern: BackgroundPatternId;
  guides: CompositionGuideId[];
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = React.memo(
  ({ frameId, width, height, paperTheme, pattern, guides }) => {
    const theme = PAPER_THEMES[paperTheme] ?? PAPER_THEMES["paper-white"];
    const patId = `pat_${frameId}_${pattern}`;
    const cx = width / 2;
    const cy = height / 2;

    return (
      <g className="pointer-events-none select-none">
        <defs>
          {pattern === "dots" && (
            <pattern id={patId} width={24} height={24} patternUnits="userSpaceOnUse">
              <circle cx={12} cy={12} r={1.3} fill={theme.gridColor} />
            </pattern>
          )}
          {pattern === "grid" && (
            <pattern id={patId} width={30} height={30} patternUnits="userSpaceOnUse">
              <path
                d="M 30 0 L 0 0 0 30"
                fill="none"
                stroke={theme.gridColor}
                strokeWidth={1}
              />
            </pattern>
          )}
          {pattern === "isometric" && (
            <pattern id={patId} width={40} height={23.094} patternUnits="userSpaceOnUse">
              <path
                d="M 0 0 L 40 23.094 M 40 0 L 0 23.094 M 20 0 L 20 23.094"
                fill="none"
                stroke={theme.gridColor}
                strokeWidth={0.85}
                opacity={0.8}
              />
            </pattern>
          )}
        </defs>

        {/* Base Paper Fill */}
        <rect x={0} y={0} width={width} height={height} fill={theme.bg} />

        {/* Pattern Overlay */}
        {pattern !== "blank" && (
          <rect x={0} y={0} width={width} height={height} fill={`url(#${patId})`} />
        )}

        {/* Guide: Rule of Thirds */}
        {guides.includes("thirds") && (
          <g stroke={theme.guideColor} strokeWidth={1.1} opacity={0.35}>
            <line x1={width / 3} y1={0} x2={width / 3} y2={height} />
            <line x1={(width * 2) / 3} y1={0} x2={(width * 2) / 3} y2={height} />
            <line x1={0} y1={height / 3} x2={width} y2={height / 3} />
            <line x1={0} y1={(height * 2) / 3} x2={width} y2={(height * 2) / 3} />
            {/* Power intersection points */}
            {[width / 3, (width * 2) / 3].map((px) =>
              [height / 3, (height * 2) / 3].map((py) => (
                <circle
                  key={`${px}-${py}`}
                  cx={px}
                  cy={py}
                  r={3.5}
                  fill="none"
                  strokeWidth={1.4}
                />
              ))
            )}
          </g>
        )}

        {/* Guide: Center Crosshair & Diagonals */}
        {guides.includes("center") && (
          <g stroke={theme.guideColor} strokeWidth={1} opacity={0.3}>
            <line x1={cx} y1={0} x2={cx} y2={height} strokeDasharray="6 6" />
            <line x1={0} y1={cy} x2={width} y2={cy} strokeDasharray="6 6" />
            <line x1={0} y1={0} x2={width} y2={height} opacity={0.45} />
            <line x1={width} y1={0} x2={0} y2={height} opacity={0.45} />
            <circle cx={cx} cy={cy} r={10} fill="none" />
          </g>
        )}

        {/* Guide: SMPTE Action Safe (90%) & Title Safe (80%) */}
        {guides.includes("safe-zones") && (
          <g fill="none" stroke={theme.guideColor} opacity={0.38}>
            <rect
              x={width * 0.05}
              y={height * 0.05}
              width={width * 0.9}
              height={height * 0.9}
              strokeWidth={1}
              strokeDasharray="8 4"
            />
            <rect
              x={width * 0.1}
              y={height * 0.1}
              width={width * 0.8}
              height={height * 0.8}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          </g>
        )}

        {/* Guide: 1-Point Perspective */}
        {guides.includes("perspective-1p") && (
          <g stroke={theme.guideColor} strokeWidth={0.9} opacity={0.28}>
            {/* Horizon line */}
            <line x1={0} y1={cy} x2={width} y2={cy} strokeWidth={1.4} />
            <circle cx={cx} cy={cy} r={4} fill={theme.guideColor} />
            {/* Radiating perspective rays */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <React.Fragment key={`1p-${t}`}>
                <line x1={cx} y1={cy} x2={width * t} y2={0} />
                <line x1={cx} y1={cy} x2={width * t} y2={height} />
                <line x1={cx} y1={cy} x2={0} y2={height * t} />
                <line x1={cx} y1={cy} x2={width} y2={height * t} />
              </React.Fragment>
            ))}
          </g>
        )}

        {/* Guide: 2-Point Perspective */}
        {guides.includes("perspective-2p") && (
          <g stroke={theme.guideColor} strokeWidth={0.85} opacity={0.26}>
            {/* Horizon line */}
            <line x1={0} y1={cy} x2={width} y2={cy} strokeWidth={1.4} />
            <circle cx={width * 0.06} cy={cy} r={4} fill={theme.guideColor} />
            <circle cx={width * 0.94} cy={cy} r={4} fill={theme.guideColor} />
            {[-0.4, -0.1, 0.2, 0.5, 0.8, 1.1, 1.4].map((t) => (
              <React.Fragment key={`2p-${t}`}>
                <line x1={width * 0.06} y1={cy} x2={width} y2={height * t} />
                <line x1={width * 0.94} y1={cy} x2={0} y2={height * t} />
              </React.Fragment>
            ))}
          </g>
        )}
      </g>
    );
  }
);
