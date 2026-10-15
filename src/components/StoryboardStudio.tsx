import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBoardSnapshot, FrameHistoryManager } from "../core/history";
import {
  ASPECT_RATIOS,
  BACKGROUND_PATTERNS,
  BRUSH_PRESETS,
  COMPOSITION_GUIDES,
  PAPER_THEMES,
  STORYBOARD_PALETTE,
} from "../core/presets";
import { measureByteSize } from "../core/simplify";
import {
  BroadcastChannelSyncAdapter,
  type StoryboardSyncAdapter,
  type SyncMessage,
} from "../core/sync";
import type {
  AspectRatioId,
  BackgroundPatternId,
  BoardSnapshot,
  CollaboratorPresence,
  CompactStroke,
  CompositionGuideId,
  PaperThemeId,
  SpatialNote,
  StoryboardFrameData,
  StoryboardToolId,
} from "../core/types";
import { InfiniteBoard } from "./InfiniteBoard";

export interface StoryboardStudioProps {
  initialFrames?: StoryboardFrameData[];
  initialSnapshots?: BoardSnapshot[];
  syncAdapter?: StoryboardSyncAdapter;
  userName?: string;
  userColor?: string;
  onChange?: (frames: StoryboardFrameData[], snapshots: BoardSnapshot[]) => void;
}

const DEFAULT_INITIAL_FRAMES: StoryboardFrameData[] = [
  {
    id: "frame_1",
    shotNumber: "1A",
    title: "EXT. NEO TOKYO - WIDE",
    caption: "Wide establishing shot. Rain pelts the neon street.",
    aspectRatio: "16:9",
    width: 800,
    height: 450,
    paperTheme: "warm-cream",
    pattern: "blank",
    guides: ["thirds"],
    hideRoughLayer: false,
    x: 60,
    y: 80,
    updatedAt: Date.now(),
    strokes: [
      // Sample 1-point perspective street + character silhouette + camera arrow
      {
        id: "demo_tone_1",
        tool: "tone",
        layer: "tone",
        color: "#64748b",
        size: 32,
        opacity: 0.2,
        pts: [100, 360, 280, 350, 520, 355, 700, 365],
      },
      {
        id: "demo_ink_1",
        tool: "ink",
        layer: "ink",
        color: "#1c1917",
        size: 4.5,
        opacity: 1,
        pts: [0, 330, 390, 225, 800, 330],
      },
      {
        id: "demo_ink_char",
        tool: "ink",
        layer: "ink",
        color: "#1c1917",
        size: 5,
        opacity: 1,
        pts: [240, 420, 250, 300, 265, 270, 280, 300, 290, 420],
      },
      {
        id: "demo_arrow_1",
        tool: "arrow",
        layer: "notes",
        color: "#ef4444",
        size: 5,
        opacity: 0.95,
        pts: [160, 390, 240, 350, 335, 265],
      },
    ],
  },
  {
    id: "frame_2",
    shotNumber: "1B",
    title: "CU - KAI'S VISOR",
    caption: "Push in on Kai's rain-streaked helmet visor reflecting the tower.",
    aspectRatio: "2.39:1",
    width: 1076,
    height: 450,
    paperTheme: "paper-white",
    pattern: "dots",
    guides: ["safe-zones"],
    hideRoughLayer: false,
    x: 940,
    y: 80,
    updatedAt: Date.now(),
    strokes: [],
  },
];

export const StoryboardStudio: React.FC<StoryboardStudioProps> = ({
  initialFrames = DEFAULT_INITIAL_FRAMES,
  initialSnapshots = [],
  syncAdapter,
  userName = "Director",
  userColor = "#6366f1",
  onChange,
}) => {
  const [frames, setFrames] = useState<StoryboardFrameData[]>(initialFrames);
  const [notes, setNotes] = useState<SpatialNote[]>([]);
  const [snapshots, setSnapshots] = useState<BoardSnapshot[]>(initialSnapshots);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(
    initialFrames[0]?.id ?? null
  );

  // Brush & Tool State
  const [activeTool, setActiveTool] = useState<StoryboardToolId>("ink");
  const [strokeColor, setStrokeColor] = useState<string>("#111827");
  const [strokeSize, setStrokeSize] = useState<number>(4);
  const [stabilizerRadius, setStabilizerRadius] = useState<number>(6);
  const [onionSkinEnabled, setOnionSkinEnabled] = useState<boolean>(false);
  const [showSequenceArrows, setShowSequenceArrows] = useState<boolean>(true);
  const [snapshotLabel, setSnapshotLabel] = useState<string>("");

  const [debugMode, setDebugMode] = useState<boolean>(false);
  // Collaboration Presence
  const [collaborators, setCollaborators] = useState<Map<string, CollaboratorPresence>>(
    new Map()
  );

  const historyRef = useRef(new FrameHistoryManager(50));
  const adapterRef = useRef<StoryboardSyncAdapter | null>(null);
  const [, forceHistoryTick] = useState(0);

  const activeFrame = useMemo(
    () => frames.find((f) => f.id === activeFrameId) ?? frames[0] ?? null,
    [frames, activeFrameId]
  );

  // Total compressed storage telemetry
  const storageStats = useMemo(() => {
    const totalStrokes = frames.reduce((acc, f) => acc + f.strokes.length, 0);
    const totalBytes = measureByteSize(frames);
    return {
      totalStrokes,
      totalBytes,
      kb: (totalBytes / 1024).toFixed(2),
    };
  }, [frames]);

  // Switch default color & size when picking a specialized tool
  const selectTool = useCallback(
    (toolId: StoryboardToolId) => {
      setActiveTool(toolId);
      const preset = BRUSH_PRESETS[toolId];
      setStrokeSize(preset.defaultSize);
      if (toolId === "pencil") {
        setStrokeColor("#3b82f6");
      } else if (toolId === "tone") {
        const theme = activeFrame
          ? PAPER_THEMES[activeFrame.paperTheme]
          : PAPER_THEMES["paper-white"];
        setStrokeColor(theme.toneColor);
      } else if (toolId === "arrow") {
        setStrokeColor("#ef4444");
      } else if (toolId === "rect") {
        setStrokeColor("#f59e0b");
      } else if (toolId === "ink") {
        const theme = activeFrame
          ? PAPER_THEMES[activeFrame.paperTheme]
          : PAPER_THEMES["paper-white"];
        setStrokeColor(theme.defaultInkColor);
      }
    },
    [activeFrame]
  );

  // Initialize Live Sync Adapter
  useEffect(() => {
    const adapter =
      syncAdapter ?? new BroadcastChannelSyncAdapter("paneld-studio-sync");
    adapterRef.current = adapter;

    const unsub = adapter.subscribe((msg: SyncMessage) => {
      switch (msg.type) {
        case "STROKE_COMMITTED": {
          setFrames((prev) =>
            prev.map((f) =>
              f.id === msg.frameId
                ? { ...f, strokes: [...f.strokes, msg.stroke], updatedAt: Date.now() }
                : f
            )
          );
          break;
        }
        case "STROKE_ERASED": {
          setFrames((prev) =>
            prev.map((f) =>
              f.id === msg.frameId
                ? {
                    ...f,
                    strokes: f.strokes.filter((s) => s.id !== msg.strokeId),
                    updatedAt: Date.now(),
                  }
                : f
            )
          );
          break;
        }
        case "FRAME_STROKES_REPLACED": {
          setFrames((prev) =>
            prev.map((f) =>
              f.id === msg.frameId
                ? { ...f, strokes: msg.strokes, updatedAt: Date.now() }
                : f
            )
          );
          break;
        }
        case "FRAME_META_UPDATED": {
          setFrames((prev) =>
            prev.map((f) => (f.id === msg.frame.id ? { ...f, ...msg.frame } : f))
          );
          break;
        }
        case "FRAME_ADDED": {
          setFrames((prev) =>
            prev.some((f) => f.id === msg.frame.id) ? prev : [...prev, msg.frame]
          );
          break;
        }
        case "FRAME_DELETED": {
          setFrames((prev) => prev.filter((f) => f.id !== msg.frameId));
          break;
        }
        case "PRESENCE_UPDATE": {
          setCollaborators((prev) => {
            const next = new Map(prev);
            next.set(msg.senderId, msg.presence);
            return next;
          });
          break;
        }
      }
    });

    return () => {
      unsub();
      if (!syncAdapter) adapter.destroy();
    };
  }, [syncAdapter]);

  // Notify parent on changes
  useEffect(() => {
    onChange?.(frames, snapshots);
  }, [frames, snapshots, onChange]);

  const handleCommitStroke = useCallback((frameId: string, stroke: CompactStroke) => {
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id !== frameId) return f;
        historyRef.current.recordState(frameId, f.strokes);
        return { ...f, strokes: [...f.strokes, stroke], updatedAt: Date.now() };
      })
    );
    forceHistoryTick((t) => t + 1);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "STROKE_COMMITTED",
        senderId: adapter.clientId,
        frameId,
        stroke,
      });
    }
  }, []);

  const handleEraseStroke = useCallback((frameId: string, strokeId: string) => {
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id !== frameId) return f;
        historyRef.current.recordState(frameId, f.strokes);
        return {
          ...f,
          strokes: f.strokes.filter((s) => s.id !== strokeId),
          updatedAt: Date.now(),
        };
      })
    );
    forceHistoryTick((t) => t + 1);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "STROKE_ERASED",
        senderId: adapter.clientId,
        frameId,
        strokeId,
      });
    }
  }, []);

  const handleUndo = useCallback(() => {
    if (!activeFrame) return;
    const prevStrokes = historyRef.current.undo(activeFrame.id, activeFrame.strokes);
    if (!prevStrokes) return;
    setFrames((prev) =>
      prev.map((f) => (f.id === activeFrame.id ? { ...f, strokes: prevStrokes } : f))
    );
    forceHistoryTick((t) => t + 1);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "FRAME_STROKES_REPLACED",
        senderId: adapter.clientId,
        frameId: activeFrame.id,
        strokes: prevStrokes,
      });
    }
  }, [activeFrame]);

  const handleRedo = useCallback(() => {
    if (!activeFrame) return;
    const nextStrokes = historyRef.current.redo(activeFrame.id, activeFrame.strokes);
    if (!nextStrokes) return;
    setFrames((prev) =>
      prev.map((f) => (f.id === activeFrame.id ? { ...f, strokes: nextStrokes } : f))
    );
    forceHistoryTick((t) => t + 1);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "FRAME_STROKES_REPLACED",
        senderId: adapter.clientId,
        frameId: activeFrame.id,
        strokes: nextStrokes,
      });
    }
  }, [activeFrame]);

  // Keyboard shortcuts (1..6 tools, Ctrl+Z / Ctrl+Y)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      const keyMap: Record<string, StoryboardToolId> = {
        "1": "pencil",
        "2": "ink",
        "3": "tone",
        "4": "arrow",
        "5": "rect",
        "6": "eraser",
      };
      if (keyMap[e.key]) {
        selectTool(keyMap[e.key]!);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo, selectTool]);

  const handleUpdateFrameMeta = useCallback(
    (frameId: string, patch: Partial<StoryboardFrameData>) => {
      setFrames((prev) =>
        prev.map((f) => (f.id === frameId ? { ...f, ...patch, updatedAt: Date.now() } : f))
      );
      const adapter = adapterRef.current;
      if (adapter) {
        adapter.send({
          type: "FRAME_META_UPDATED",
          senderId: adapter.clientId,
          frame: { id: frameId, ...patch },
        });
      }
    },
    []
  );

  const handleChangeAspectRatio = (ratioId: AspectRatioId) => {
    if (!activeFrame) return;
    const preset = ASPECT_RATIOS[ratioId];
    const contentWidth = activeFrame.contentWidth ?? activeFrame.width;
    const contentHeight = activeFrame.contentHeight ?? activeFrame.height;
    handleUpdateFrameMeta(activeFrame.id, {
      aspectRatio: ratioId,
      width: preset.width,
      height: preset.height,
      contentWidth,
      contentHeight,
    });
  };

  const handleToggleFitMode = (mode: "contain" | "fill") => {
    if (!activeFrame) return;
    handleUpdateFrameMeta(activeFrame.id, { fitMode: mode });
  };

  const handleSerialiseShots = useCallback((mode: "alpha" | "numeric" = "alpha") => {
    setFrames((prev) => {
      const sorted = [...prev].sort(
        (a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
      );
      return sorted.map((f, i) => ({
        ...f,
        shotNumber:
          mode === "alpha" ? `${i + 1}A` : String(i + 1).padStart(2, "0"),
        sequenceOrder: (i + 1) * 1000,
        updatedAt: Date.now(),
      }));
    });
  }, []);

  const handleMoveShotSequence = useCallback(
    (frameId: string, direction: "up" | "down") => {
      setFrames((prev) => {
        const idx = prev.findIndex((f) => f.id === frameId);
        if (idx === -1) return prev;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;

        const copy = [...prev];
        const temp = copy[idx]!;
        copy[idx] = copy[targetIdx]!;
        copy[targetIdx] = temp;

        return copy.map((f, i) => ({
          ...f,
          sequenceOrder: (i + 1) * 1000,
          updatedAt: Date.now(),
        }));
      });
    },
    []
  );

  const handleAddFrameAt = useCallback(
    (worldX: number, worldY: number, aspectId: AspectRatioId = "16:9") => {
      const preset = ASPECT_RATIOS[aspectId] ?? ASPECT_RATIOS["16:9"];
      const newIndex = frames.length + 1;
      const newId = `frame_${Date.now().toString(36)}`;
      const newFrame: StoryboardFrameData = {
        id: newId,
        shotNumber: `${newIndex}A`,
        title: `SHOT ${newIndex}`,
        caption: "",
        aspectRatio: preset.id,
        width: preset.width,
        height: preset.height,
        contentWidth: preset.width,
        contentHeight: preset.height,
        fitMode: "contain",
        paperTheme: activeFrame?.paperTheme ?? "warm-cream",
        pattern: activeFrame?.pattern ?? "blank",
        guides: ["thirds"],
        hideRoughLayer: false,
        x: worldX,
        y: worldY,
        sequenceOrder: newIndex * 1000,
        strokes: [],
        updatedAt: Date.now(),
      };
      setFrames((prev) => [...prev, newFrame]);
      setActiveFrameId(newId);
    },
    [frames.length, activeFrame?.paperTheme, activeFrame?.pattern]
  );

  const handleToggleGuide = (guideId: CompositionGuideId) => {
    if (!activeFrame) return;
    const exists = activeFrame.guides.includes(guideId);
    const nextGuides = exists
      ? activeFrame.guides.filter((g) => g !== guideId)
      : [...activeFrame.guides, guideId];
    handleUpdateFrameMeta(activeFrame.id, { guides: nextGuides });
  };

  const handleAddShot = () => {
    const last = frames[frames.length - 1];
    const ratio = last ? ASPECT_RATIOS[last.aspectRatio] : ASPECT_RATIOS["16:9"];
    const newFrame: StoryboardFrameData = {
      id: `frame_${Date.now().toString(36)}`,
      shotNumber: `${frames.length + 1}A`,
      title: `SHOT ${frames.length + 1} - NEW BEAT`,
      caption: "",
      aspectRatio: ratio.id,
      width: ratio.width,
      height: ratio.height,
      paperTheme: last?.paperTheme ?? "warm-cream",
      pattern: last?.pattern ?? "blank",
      guides: last ? [...last.guides] : ["thirds"],
      hideRoughLayer: false,
      x: last ? last.x + last.width + 90 : 60,
      y: last ? last.y : 80,
      strokes: [],
      updatedAt: Date.now(),
    };
    setFrames((prev) => [...prev, newFrame]);
    setActiveFrameId(newFrame.id);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "FRAME_ADDED",
        senderId: adapter.clientId,
        frame: newFrame,
      });
    }
  };

  const handleDuplicateFrame = (frameId: string) => {
    const source = frames.find((f) => f.id === frameId);
    if (!source) return;
    const clone: StoryboardFrameData = {
      ...source,
      id: `frame_${Date.now().toString(36)}`,
      shotNumber: `${source.shotNumber}-ALT`,
      title: `${source.title} (Variant)`,
      x: source.x + 60,
      y: source.y + source.height + 110,
      strokes: [...source.strokes],
      guides: [...source.guides],
      updatedAt: Date.now(),
    };
    setFrames((prev) => [...prev, clone]);
    setActiveFrameId(clone.id);
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "FRAME_ADDED",
        senderId: adapter.clientId,
        frame: clone,
      });
    }
  };

  const handleDeleteFrame = (frameId: string) => {
    setFrames((prev) => {
      const filtered = prev.filter((f) => f.id !== frameId);
      if (activeFrameId === frameId) {
        setActiveFrameId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
    const adapter = adapterRef.current;
    if (adapter) {
      adapter.send({
        type: "FRAME_DELETED",
        senderId: adapter.clientId,
        frameId,
      });
    }
  };

  const handleAutoArrangeGrid = (columns = 2) => {
    setFrames((prev) => {
      let col = 0;
      let curX = 60;
      let curY = 80;
      let rowMaxH = 0;

      return prev.map((f) => {
        if (col >= columns) {
          col = 0;
          curX = 60;
          curY += rowMaxH + 130;
          rowMaxH = 0;
        }
        const updated = { ...f, x: curX, y: curY };
        curX += f.width + 90;
        rowMaxH = Math.max(rowMaxH, f.height);
        col++;
        return updated;
      });
    });
  };

  const handleCreateSnapshot = () => {
    const snap = createBoardSnapshot(
      snapshotLabel || `Pass #${snapshots.length + 1}`,
      frames,
      notes,
      userName
    );
    setSnapshots((prev) => [snap, ...prev]);
    setSnapshotLabel("");
  };

  const handleRestoreSnapshot = (snap: BoardSnapshot) => {
    setFrames(
      snap.frames.map((f) => ({
        ...f,
        strokes: [...f.strokes],
        guides: [...f.guides],
      }))
    );
  };

  const handleInFlightMove = useCallback(
    (frameId: string, x: number, y: number, inFlightStroke: CompactStroke | null) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      adapter.send({
        type: "PRESENCE_UPDATE",
        senderId: adapter.clientId,
        presence: {
          clientId: adapter.clientId,
          name: userName,
          color: userColor,
          activeFrameId: frameId,
          worldX: 0,
          worldY: 0,
          frameX: x,
          frameY: y,
          inFlightStroke,
          lastSeen: Date.now(),
        },
      });
    },
    [userName, userColor]
  );

  const remoteCollaboratorsList = useMemo(
    () => Array.from(collaborators.values()),
    [collaborators]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#09090b",
        color: "#f4f4f5",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Top Studio Sketching Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          backgroundColor: "#121216",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* WonderUnit 6-Tool Palette */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {(Object.keys(BRUSH_PRESETS) as StoryboardToolId[]).map((toolId) => {
            const b = BRUSH_PRESETS[toolId];
            const selected = activeTool === toolId;
            return (
              <button
                key={toolId}
                type="button"
                onClick={() => selectTool(toolId)}
                title={`${b.description} (Shortcut: ${b.shortcut})`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 11px",
                  borderRadius: 8,
                  border: selected
                    ? "1px solid #6366f1"
                    : "1px solid rgba(255,255,255,0.08)",
                  backgroundColor: selected ? "#312e81" : "#1c1c22",
                  color: selected ? "#ffffff" : "#d4d4d8",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span style={{ opacity: 0.5, fontSize: 10 }}>{b.shortcut}</span>
                <span>{b.label}</span>
              </button>
            );
          })}
        </div>

        {/* Color Values & Depth Swatches */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STORYBOARD_PALETTE.map((swatch) => (
            <button
              key={swatch.id}
              type="button"
              onClick={() => setStrokeColor(swatch.color)}
              title={swatch.label}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                backgroundColor: swatch.color,
                border:
                  strokeColor === swatch.color
                    ? "2px solid #6366f1"
                    : "1px solid rgba(255,255,255,0.25)",
                transform: strokeColor === swatch.color ? "scale(1.18)" : "scale(1)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        {/* Size & Lazy-Brush Stabilizer Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#a1a1aa" }}>Size: {strokeSize}px</span>
            <input
              type="range"
              min={1}
              max={42}
              step={0.5}
              value={strokeSize}
              onChange={(e) => setStrokeSize(Number(e.target.value))}
              style={{ width: 75 }}
            />
          </label>
          <label
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            title="Virtual string stabilizer to eliminate mouse/trackpad jitter"
          >
            <span style={{ color: "#a1a1aa" }}>Stabilizer: {stabilizerRadius}</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={stabilizerRadius}
              onChange={(e) => setStabilizerRadius(Number(e.target.value))}
              style={{ width: 65 }}
            />
          </label>
        </div>

        {/* Undo / Redo / Add Shot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={!activeFrame || !historyRef.current.canUndo(activeFrame.id)}
            style={{
              padding: "6px 10px",
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "#1c1c22",
              color:
                activeFrame && historyRef.current.canUndo(activeFrame.id)
                  ? "#fff"
                  : "#52525b",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!activeFrame || !historyRef.current.canRedo(activeFrame.id)}
            style={{
              padding: "6px 10px",
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "#1c1c22",
              color:
                activeFrame && historyRef.current.canRedo(activeFrame.id)
                  ? "#fff"
                  : "#52525b",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => setDebugMode((d) => !d)}
            style={{
              padding: "6px 11px",
              borderRadius: 7,
              border: debugMode ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
              background: debugMode ? "rgba(16,185,129,0.2)" : "#1c1c22",
              color: debugMode ? "#34d399" : "#a1a1aa",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
            title="Toggle Drawing Diagnostics & Telemetry HUD (Shortcut: D)"
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: debugMode ? "#10b981" : "#71717a",
              }}
            />
            Debug HUD
          </button>
          <button
            type="button"
            onClick={handleAddShot}
            style={{
              padding: "6px 12px",
              borderRadius: 7,
              border: "none",
              background: "#6366f1",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            + Add Shot Frame
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Filmstrip + Infinite Board + Right Frame Inspector */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left Sequence Filmstrip Panel */}
        <div
          style={{
            width: 220,
            backgroundColor: "#121216",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            flexDirection: "column",
            fontSize: 12,
            overflow: "hidden",
          }}
        >
          {/* Header with Serialise Button */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: "#fff",
                fontSize: 11,
                letterSpacing: "0.03em",
              }}
            >
              SHOTS ({frames.length})
            </span>
            <button
              type="button"
              onClick={() => handleSerialiseShots("alpha")}
              style={{
                padding: "2px 7px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.2)",
                border: "1px solid #6366f1",
                color: "#818cf8",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Re-number all shots sequentially (1A, 2A, 3A...)"
            >
              Serialise
            </button>
          </div>

          {/* Scrollable list of shots */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {frames.map((f, i) => {
              const active = f.id === activeFrameId;
              return (
                <div
                  key={f.id}
                  onClick={() => setActiveFrameId(f.id)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: active ? "#1e1b4b" : "rgba(255,255,255,0.03)",
                    border: active
                      ? "1px solid #6366f1"
                      : "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: active ? "#818cf8" : "#fff",
                        fontSize: 11,
                      }}
                    >
                      {f.shotNumber}
                    </span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveShotSequence(f.id, "up");
                        }}
                        disabled={i === 0}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: i === 0 ? "#52525b" : "#a1a1aa",
                          cursor: i === 0 ? "default" : "pointer",
                          padding: "0 2px",
                          fontSize: 10,
                        }}
                        title="Move Up in Narrative Sequence"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveShotSequence(f.id, "down");
                        }}
                        disabled={i === frames.length - 1}
                        style={{
                          background: "transparent",
                          border: "none",
                          color:
                            i === frames.length - 1 ? "#52525b" : "#a1a1aa",
                          cursor:
                            i === frames.length - 1 ? "default" : "pointer",
                          padding: "0 2px",
                          fontSize: 10,
                        }}
                        title="Move Down in Narrative Sequence"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#d4d4d8",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.title}
                  </div>
                  {f.nextFrameId && (
                    <div style={{ fontSize: 9, color: "#34d399" }}>
                      ➔ Linked to{" "}
                      {frames.find((x) => x.id === f.nextFrameId)?.shotNumber ??
                        "Shot"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          <InfiniteBoard
            frames={frames}
            activeFrameId={activeFrame?.id ?? null}
            activeTool={activeTool}
            strokeColor={strokeColor}
            strokeSize={strokeSize}
            stabilizerRadius={stabilizerRadius}
            onionSkinEnabled={onionSkinEnabled}
            showSequenceArrows={showSequenceArrows}
            remoteCollaborators={remoteCollaboratorsList}
            debugMode={debugMode}
            onToggleDebug={() => setDebugMode((d) => !d)}
            onSelectFrame={setActiveFrameId}
            onMoveFrame={(id, x, y) => handleUpdateFrameMeta(id, { x, y })}
            onUpdateFrameMeta={handleUpdateFrameMeta}
            onCommitStroke={handleCommitStroke}
            onEraseStroke={handleEraseStroke}
            onDuplicateFrame={handleDuplicateFrame}
            onDeleteFrame={handleDeleteFrame}
            onAddFrameAt={handleAddFrameAt}
            onInFlightMove={handleInFlightMove}
          />
        </div>

        {/* Right Inspector Panel: Canvas Sizes, Backgrounds, Guides & Versioning */}
        <div
          style={{
            width: 300,
            backgroundColor: "#121216",
            borderLeft: "1px solid rgba(255,255,255,0.08)",
            padding: 16,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            fontSize: 12,
          }}
        >
          {/* Active Shot Aspect Ratio / Canvas Size */}
          {activeFrame && (
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#a1a1aa",
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Canvas Aspect Ratio ({activeFrame.width}×{activeFrame.height})
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {(Object.keys(ASPECT_RATIOS) as AspectRatioId[]).map((ratioId) => {
                  const r = ASPECT_RATIOS[ratioId];
                  const active = activeFrame.aspectRatio === ratioId;
                  return (
                    <button
                      key={ratioId}
                      type="button"
                      onClick={() => handleChangeAspectRatio(ratioId)}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: active
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: active ? "#312e81" : "#1c1c22",
                        color: active ? "#fff" : "#d4d4d8",
                        textAlign: "left",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{r.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.65 }}>{r.subtitle}</div>
                    </button>
                  );
                })}
              </div>

              {/* Non-destructive Canvas Framing: Fit vs Fill */}
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  padding: "6px 10px",
                  borderRadius: 7,
                }}
              >
                <span style={{ color: "#a1a1aa", fontSize: 11 }}>Canvas Framing:</span>
                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    type="button"
                    onClick={() => handleToggleFitMode("contain")}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background:
                        activeFrame.fitMode !== "fill" ? "#312e81" : "#1c1c22",
                      border:
                        activeFrame.fitMode !== "fill"
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                      color: activeFrame.fitMode !== "fill" ? "#fff" : "#a1a1aa",
                      cursor: "pointer",
                    }}
                    title="Scale & fit entire artwork inside canvas without any clipping"
                  >
                    Fit (Contain)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleFitMode("fill")}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background:
                        activeFrame.fitMode === "fill" ? "#312e81" : "#1c1c22",
                      border:
                        activeFrame.fitMode === "fill"
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                      color: activeFrame.fitMode === "fill" ? "#fff" : "#a1a1aa",
                      cursor: "pointer",
                    }}
                    title="Fill canvas without letterboxing"
                  >
                    Fill (Crop)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Paper Theme & Surface Pattern */}
          {activeFrame && (
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#a1a1aa",
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Paper Tone & Grid Surface
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {(Object.keys(PAPER_THEMES) as PaperThemeId[]).map((themeId) => {
                  const t = PAPER_THEMES[themeId];
                  const active = activeFrame.paperTheme === themeId;
                  return (
                    <button
                      key={themeId}
                      type="button"
                      onClick={() =>
                        handleUpdateFrameMeta(activeFrame.id, { paperTheme: themeId })
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: active
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: active ? "#312e81" : "#1c1c22",
                        color: "#e4e4e7",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          backgroundColor: t.bg,
                          border: "1px solid rgba(255,255,255,0.3)",
                        }}
                      />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {BACKGROUND_PATTERNS.map((pat) => {
                  const active = activeFrame.pattern === pat.id;
                  return (
                    <button
                      key={pat.id}
                      type="button"
                      onClick={() =>
                        handleUpdateFrameMeta(activeFrame.id, {
                          pattern: pat.id as BackgroundPatternId,
                        })
                      }
                      style={{
                        padding: "5px 8px",
                        borderRadius: 6,
                        border: active
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: active ? "#312e81" : "#1c1c22",
                        color: "#e4e4e7",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {pat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cinematography & Perspective Guides */}
          {activeFrame && (
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#a1a1aa",
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Camera & Perspective Guides
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {COMPOSITION_GUIDES.map((g) => {
                  const enabled = activeFrame.guides.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => handleToggleGuide(g.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 9px",
                        borderRadius: 6,
                        border: enabled
                          ? "1px solid #6366f1"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: enabled ? "rgba(99,102,241,0.18)" : "#1c1c22",
                        color: "#e4e4e7",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <span>{g.label}</span>
                      <span style={{ color: enabled ? "#818cf8" : "#52525b" }}>
                        {enabled ? "ON" : "OFF"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Storyboarder Layer & Layout Helpers */}
          {activeFrame && (
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#a1a1aa",
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Layers & Spatial Board
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                >
                  <span>Hide Rough Blue Pencil</span>
                  <input
                    type="checkbox"
                    checked={Boolean(activeFrame.hideRoughLayer)}
                    onChange={(e) =>
                      handleUpdateFrameMeta(activeFrame.id, {
                        hideRoughLayer: e.target.checked,
                      })
                    }
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                >
                  <span>Onion Skin (Previous Shot)</span>
                  <input
                    type="checkbox"
                    checked={onionSkinEnabled}
                    onChange={(e) => setOnionSkinEnabled(e.target.checked)}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                >
                  <span>Sequence Flow Arrows</span>
                  <input
                    type="checkbox"
                    checked={showSequenceArrows}
                    onChange={(e) => setShowSequenceArrows(e.target.checked)}
                  />
                </label>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => handleAutoArrangeGrid(2)}
                    style={{
                      flex: 1,
                      padding: "6px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "#1c1c22",
                      color: "#e4e4e7",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Arrange 2-Col
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoArrangeGrid(99)}
                    style={{
                      flex: 1,
                      padding: "6px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "#1c1c22",
                      color: "#e4e4e7",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Filmstrip Row
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Storage Footprint & Version History */}
          <div
            style={{
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: "#a1a1aa",
                  textTransform: "uppercase",
                  fontSize: 11,
                }}
              >
                Versioning & Storage
              </span>
              <span
                style={{
                  background: "rgba(16,185,129,0.15)",
                  color: "#34d399",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {storageStats.kb} KB ({storageStats.totalStrokes} strokes)
              </span>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                placeholder="Version label (e.g. Director Pass)"
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                style={{
                  flex: 1,
                  background: "#1c1c22",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "5px 8px",
                  color: "#fff",
                  fontSize: 11,
                }}
              />
              <button
                type="button"
                onClick={handleCreateSnapshot}
                style={{
                  background: "#6366f1",
                  border: "none",
                  borderRadius: 6,
                  color: "#fff",
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {snapshots.length === 0 ? (
                <div style={{ color: "#71717a", fontSize: 11 }}>
                  No saved snapshots yet. Click Save to capture a lightweight version.
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "#1c1c22",
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#e4e4e7" }}>{snap.label}</div>
                      <div style={{ fontSize: 10, color: "#71717a" }}>
                        {(snap.byteSize / 1024).toFixed(1)} KB •{" "}
                        {new Date(snap.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreSnapshot(snap)}
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        border: "none",
                        color: "#fff",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
