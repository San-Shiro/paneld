import React, { useState } from "react";
import type { LiveStrokeStats, PointerLogEvent } from "../core/debug";

export interface DrawingDebugHUDProps {
  enabled: boolean;
  onToggle: () => void;
  onClearLogs: () => void;
  events: PointerLogEvent[];
  stats: LiveStrokeStats | null;
  lastEvent: PointerLogEvent | null;
  activeFrameId: string | null;
}

export const DrawingDebugHUD: React.FC<DrawingDebugHUDProps> = ({
  enabled,
  onToggle,
  onClearLogs,
  events,
  stats,
  lastEvent,
  activeFrameId,
}) => {
  const [minimized, setMinimized] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!enabled) return null;

  const handleCopyLogs = () => {
    const payload = JSON.stringify(events, null, 2);
    navigator.clipboard.writeText(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const getBadgeColor = (lifecycle: string) => {
    switch (lifecycle) {
      case "DOWN":
        return "#10b981"; // green
      case "MOVE":
        return "#3b82f6"; // blue
      case "UP":
        return "#a855f7"; // purple
      case "CANCEL":
      case "LOST_CAPTURE":
        return "#ef4444"; // red
      case "CAPTURED":
        return "#f59e0b"; // amber
      default:
        return "#71717a";
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 16,
        width: minimized ? 200 : 360,
        maxHeight: "82vh",
        backgroundColor: "rgba(18, 18, 22, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: 12,
        boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(12px)",
        color: "#f4f4f5",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* HUD Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          backgroundColor: "rgba(255, 255, 255, 0.05)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: stats?.strokeId ? "#10b981" : "#6366f1",
              boxShadow: stats?.strokeId ? "0 0 8px #10b981" : "none",
            }}
          />
          <span style={{ fontWeight: 700, color: "#fff", letterSpacing: "0.03em" }}>
            PANELD DEBUG HUD
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => setMinimized(!minimized)}
            style={{
              background: "transparent",
              border: "none",
              color: "#a1a1aa",
              cursor: "pointer",
              fontSize: 12,
              padding: "2px 4px",
            }}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? "▢" : "—"}
          </button>
          <button
            type="button"
            onClick={onToggle}
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              border: "none",
              color: "#fca5a5",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 6px",
            }}
            title="Close Debug HUD"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Real-time Telemetry Section */}
          <div
            style={{
              padding: "10px 12px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              backgroundColor: "rgba(0, 0, 0, 0.2)",
            }}
          >
            <div>
              <span style={{ color: "#71717a" }}>Pointer: </span>
              <span style={{ color: "#38bdf8", fontWeight: 600 }}>
                {lastEvent?.pointerType ?? "none"}
              </span>
              <span style={{ color: "#a1a1aa" }}>
                {" "}
                (id: {lastEvent?.pointerId ?? "-"})
              </span>
            </div>
            <div>
              <span style={{ color: "#71717a" }}>State: </span>
              <span
                style={{
                  color: getBadgeColor(lastEvent?.lifecycle ?? "IDLE"),
                  fontWeight: 700,
                }}
              >
                {lastEvent?.lifecycle ?? "IDLE"}
              </span>
            </div>
            <div>
              <span style={{ color: "#71717a" }}>Pressure: </span>
              <span style={{ color: "#facc15" }}>
                {lastEvent?.pressure !== undefined
                  ? lastEvent.pressure.toFixed(2)
                  : "-"}
              </span>
            </div>
            <div>
              <span style={{ color: "#71717a" }}>Coalesced: </span>
              <span style={{ color: "#f472b6" }}>
                {lastEvent?.coalescedCount ?? 1}
              </span>
            </div>
            <div>
              <span style={{ color: "#71717a" }}>Frame (X, Y): </span>
              <span style={{ color: "#4ade80" }}>
                {lastEvent?.frameX !== undefined
                  ? `${Math.round(lastEvent.frameX)}, ${Math.round(lastEvent.frameY ?? 0)}`
                  : "-"}
              </span>
            </div>
            <div>
              <span style={{ color: "#71717a" }}>Capture: </span>
              <span
                style={{
                  color:
                    lastEvent?.capture === "held"
                      ? "#10b981"
                      : lastEvent?.capture === "lost"
                        ? "#ef4444"
                        : "#a1a1aa",
                }}
              >
                {lastEvent?.capture ?? "none"}
              </span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: "#71717a" }}>Active Shot: </span>
              <span style={{ color: "#c084fc" }}>
                {activeFrameId ?? "none selected"}
              </span>
              <span style={{ color: "#71717a", marginLeft: 8 }}>In Bounds: </span>
              <span
                style={{
                  color: lastEvent?.inBounds !== false ? "#10b981" : "#ef4444",
                }}
              >
                {lastEvent?.inBounds !== false ? "YES" : "NO"}
              </span>
            </div>
          </div>

          {/* Live In-Flight Stroke Stats */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              backgroundColor: stats?.strokeId
                ? "rgba(16, 185, 129, 0.08)"
                : "transparent",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <span style={{ color: "#a1a1aa", fontWeight: 600 }}>Stroke Stats</span>
              <span style={{ color: stats?.strokeId ? "#10b981" : "#71717a" }}>
                {stats?.strokeId ? "DRAWING" : "IDLE"}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                fontSize: 10,
              }}
            >
              <div>Raw Points: {stats?.rawPointCount ?? 0}</div>
              <div>Simplified: {stats?.simplifiedPointCount ?? 0}</div>
              <div>
                Path Length:{" "}
                {stats?.pathLength ? `${Math.round(stats.pathLength)} px` : "0 px"}
              </div>
              <div>Est. Payload: {stats?.estimatedBytes ?? 0} B</div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 12px",
              backgroundColor: "rgba(255, 255, 255, 0.03)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <span style={{ color: "#71717a", fontSize: 10 }}>
              Recent Events ({events.length})
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={handleCopyLogs}
                style={{
                  background: copied ? "#10b981" : "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "#fff",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied!" : "Copy JSON"}
              </button>
              <button
                type="button"
                onClick={onClearLogs}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "none",
                  color: "#a1a1aa",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Ring Buffer Event Log Stream */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "6px 8px",
              maxHeight: 220,
              display: "flex",
              flexDirection: "column-reverse",
              gap: 3,
            }}
          >
            {events.length === 0 ? (
              <div
                style={{
                  color: "#52525b",
                  textAlign: "center",
                  padding: "16px 0",
                  fontStyle: "italic",
                }}
              >
                Draw on a shot to see live pointer telemetry...
              </div>
            ) : (
              events
                .slice()
                .reverse()
                .map((ev) => (
                  <div
                    key={ev.seq}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "2px 6px",
                      borderRadius: 4,
                      backgroundColor: "rgba(255, 255, 255, 0.02)",
                      fontSize: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#52525b" }}>{ev.timeStr}</span>
                      <span
                        style={{
                          color: getBadgeColor(ev.lifecycle),
                          fontWeight: 700,
                          minWidth: 46,
                        }}
                      >
                        {ev.lifecycle}
                      </span>
                      <span style={{ color: "#a1a1aa" }}>{ev.pointerType}</span>
                    </div>
                    <div style={{ color: "#71717a" }}>
                      {ev.frameX !== undefined
                        ? `(${Math.round(ev.frameX)}, ${Math.round(ev.frameY ?? 0)})`
                        : ev.detail ?? ""}
                    </div>
                  </div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
