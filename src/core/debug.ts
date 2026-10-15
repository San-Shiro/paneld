export type PointerLifecycle =
  | "DOWN"
  | "MOVE"
  | "UP"
  | "CANCEL"
  | "LEAVE"
  | "CAPTURED"
  | "LOST_CAPTURE"
  | "BLUR";

export interface PointerLogEvent {
  seq: number;
  timestamp: number;
  timeStr: string;
  lifecycle: PointerLifecycle;
  pointerId?: number;
  pointerType?: "touch" | "pen" | "mouse" | string;
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
  frameX?: number;
  frameY?: number;
  inBounds?: boolean;
  pressure?: number;
  buttons?: number;
  coalescedCount?: number;
  capture?: "none" | "requested" | "held" | "lost" | "error";
  strokeId?: string;
  detail?: string;
}

export interface LiveStrokeStats {
  strokeId: string | null;
  tool: string;
  layer: string;
  rawPointCount: number;
  simplifiedPointCount: number;
  inFlightPointCount: number;
  pathLength: number;
  estimatedBytes: number;
  stabilizerActive: boolean;
  pressureMin: number;
  pressureMax: number;
  bbox?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export class PointerEventRingBuffer {
  private slots: (PointerLogEvent | undefined)[];
  private head = 0;
  private count = 0;
  private seqCounter = 0;

  constructor(public readonly capacity: number = 60) {
    this.slots = new Array(capacity);
  }

  push(
    lifecycle: PointerLifecycle,
    data: Omit<PointerLogEvent, "seq" | "timestamp" | "timeStr" | "lifecycle">
  ): PointerLogEvent {
    this.seqCounter++;
    const now = Date.now();
    const d = new Date(now);
    const timeStr = `${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;

    const evt: PointerLogEvent = {
      seq: this.seqCounter,
      timestamp: now,
      timeStr,
      lifecycle,
      ...data,
    };

    this.slots[this.head] = evt;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }

    return evt;
  }

  getAll(): PointerLogEvent[] {
    const list: PointerLogEvent[] = [];
    if (this.count === 0) return list;

    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.slots[idx];
      if (item) list.push(item);
    }
    return list;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  get totalEvents(): number {
    return this.seqCounter;
  }
}

/** Global shared ring buffer singleton for drawing diagnostics */
export const globalPointerRingBuffer = new PointerEventRingBuffer(60);
