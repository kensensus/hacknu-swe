import { createClient, LiveObject } from '@liveblocks/client';
import { createRoomContext } from '@liveblocks/react';

const client = createClient({
  publicApiKey: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY!,
});

export type ChatMessage = {
  id: string;
  role: string;
  text: string;
  userName: string;
  timestamp: number;
};

type Presence = {
  userName: string;
  cursor: { x: number; y: number } | null;
};

// Only canvas snapshot is persisted — chat is ephemeral (broadcast only)
type Storage = {
  canvasSnapshot: LiveObject<{ json: string; sessionId: string }>;
};

type BroadcastEvents =
  | { type: 'canvas-diff'; diff: any }
  | { type: 'chat-message'; msg: ChatMessage };

export const {
  RoomProvider,
  useStorage,
  useMutation,
  useBroadcastEvent,
  useEventListener,
  useOthers,
  useMyPresence,
  useRoom,
} = createRoomContext<Presence, Storage, never, BroadcastEvents>(client);
