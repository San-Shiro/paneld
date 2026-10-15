import type {
  CollaboratorPresence,
  CompactStroke,
  SpatialNote,
  StoryboardFrameData,
} from "./types";

export type SyncMessage =
  | { type: "STROKE_COMMITTED"; senderId: string; frameId: string; stroke: CompactStroke }
  | { type: "STROKE_ERASED"; senderId: string; frameId: string; strokeId: string }
  | { type: "FRAME_STROKES_REPLACED"; senderId: string; frameId: string; strokes: CompactStroke[] }
  | { type: "FRAME_META_UPDATED"; senderId: string; frame: Partial<StoryboardFrameData> & { id: string } }
  | { type: "FRAME_ADDED"; senderId: string; frame: StoryboardFrameData }
  | { type: "FRAME_DELETED"; senderId: string; frameId: string }
  | { type: "PRESENCE_UPDATE"; senderId: string; presence: CollaboratorPresence }
  | { type: "FULL_SYNC_REQUEST"; senderId: string }
  | {
      type: "FULL_SYNC_RESPONSE";
      senderId: string;
      frames: StoryboardFrameData[];
      notes: SpatialNote[];
    };

export interface StoryboardSyncAdapter {
  readonly clientId: string;
  send(message: SyncMessage): void;
  subscribe(handler: (message: SyncMessage) => void): () => void;
  destroy(): void;
}

/**
 * Built-in BroadcastChannel Live Sync Adapter.
 * Syncs strokes, frame mutations, in-flight drawings, and collaborator cursors
 * across browser tabs/windows in real time with zero server configuration.
 */
export class BroadcastChannelSyncAdapter implements StoryboardSyncAdapter {
  public readonly clientId: string;
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<(message: SyncMessage) => void>();

  constructor(roomName = "paneld-default-room", clientId?: string) {
    this.clientId = clientId ?? `peer_${Math.random().toString(36).slice(2, 8)}`;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.channel = new BroadcastChannel(roomName);
      this.channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        const msg = event.data;
        if (!msg || msg.senderId === this.clientId) return;
        for (const h of this.handlers) {
          h(msg);
        }
      };
    }
  }

  send(message: SyncMessage): void {
    this.channel?.postMessage(message);
  }

  subscribe(handler: (message: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    this.handlers.clear();
    this.channel?.close();
    this.channel = null;
  }
}

/**
 * Callback-based custom adapter for plugging directly into Yjs, WebRTC, or Supabase Realtime.
 */
export class CustomCallbackSyncAdapter implements StoryboardSyncAdapter {
  public readonly clientId: string;
  private onSendCallback: (message: SyncMessage) => void;
  private handlers = new Set<(message: SyncMessage) => void>();

  constructor(onSend: (message: SyncMessage) => void, clientId?: string) {
    this.clientId = clientId ?? `peer_${Math.random().toString(36).slice(2, 8)}`;
    this.onSendCallback = onSend;
  }

  send(message: SyncMessage): void {
    this.onSendCallback(message);
  }

  receiveFromRemote(message: SyncMessage): void {
    if (message.senderId === this.clientId) return;
    for (const h of this.handlers) {
      h(message);
    }
  }

  subscribe(handler: (message: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    this.handlers.clear();
  }
}
