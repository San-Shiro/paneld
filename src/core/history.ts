import { measureByteSize } from "./simplify";
import type {
  BoardSnapshot,
  CompactStroke,
  SpatialNote,
  StoryboardFrameData,
} from "./types";

/**
 * Lightweight per-frame Undo/Redo stack using structural sharing of immutable strokes.
 */
export class FrameHistoryManager {
  private stacks = new Map<string, { past: CompactStroke[][]; future: CompactStroke[][] }>();
  private maxDepth: number;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  private getStack(frameId: string) {
    let stack = this.stacks.get(frameId);
    if (!stack) {
      stack = { past: [], future: [] };
      this.stacks.set(frameId, stack);
    }
    return stack;
  }

  recordState(frameId: string, previousStrokes: CompactStroke[]) {
    const stack = this.getStack(frameId);
    stack.past.push(previousStrokes);
    if (stack.past.length > this.maxDepth) {
      stack.past.shift();
    }
    stack.future = [];
  }

  canUndo(frameId: string): boolean {
    return (this.stacks.get(frameId)?.past.length ?? 0) > 0;
  }

  canRedo(frameId: string): boolean {
    return (this.stacks.get(frameId)?.future.length ?? 0) > 0;
  }

  undo(frameId: string, currentStrokes: CompactStroke[]): CompactStroke[] | null {
    const stack = this.getStack(frameId);
    const prev = stack.past.pop();
    if (!prev) return null;
    stack.future.push(currentStrokes);
    return prev;
  }

  redo(frameId: string, currentStrokes: CompactStroke[]): CompactStroke[] | null {
    const stack = this.getStack(frameId);
    const next = stack.future.pop();
    if (!next) return null;
    stack.past.push(currentStrokes);
    return next;
  }
}

/**
 * Create a lightweight, immutable snapshot of the entire storyboard document.
 */
export function createBoardSnapshot(
  label: string,
  frames: StoryboardFrameData[],
  notes: SpatialNote[],
  authorName = "Director"
): BoardSnapshot {
  const clonedFrames: StoryboardFrameData[] = frames.map((f) => ({
    ...f,
    guides: [...f.guides],
    strokes: [...f.strokes],
  }));
  const clonedNotes: SpatialNote[] = notes.map((n) => ({ ...n }));

  const byteSize = measureByteSize({ frames: clonedFrames, notes: clonedNotes });

  return {
    id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim() || `Snapshot ${new Date().toLocaleTimeString()}`,
    createdAt: Date.now(),
    authorName,
    byteSize,
    frames: clonedFrames,
    notes: clonedNotes,
  };
}
