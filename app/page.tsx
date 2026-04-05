'use client';

import dynamic from 'next/dynamic';
import 'tldraw/tldraw.css';
import { useEffect, useRef, useState } from 'react';
import { createShapeId, toRichText, AssetRecordType } from '@tldraw/tlschema';
import { LiveObject } from '@liveblocks/client';
import {
  RoomProvider,
  useStorage,
  useBroadcastEvent,
  useEventListener,
  useOthers,
  useMyPresence,
  useRoom,
  type ChatMessage,
} from './liveblocks.config';

// ─── Helpers ────────────────────────────────────────────────────────────────

const BLOCK_NODES = new Set(['paragraph', 'listItem', 'orderedList', 'bulletList', 'doc']);
function richTextToPlain(node: any, listIndex?: number): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!node.content) return '';
  if (node.type === 'orderedList') {
    const start = node.attrs?.start ?? 1;
    return node.content.map((item: any, i: number) => richTextToPlain(item, start + i)).join('\n');
  }
  if (node.type === 'bulletList') {
    return node.content.map((item: any) => richTextToPlain(item, -1)).join('\n');
  }
  if (node.type === 'listItem') {
    const prefix = listIndex === -1 ? '• ' : `${listIndex}. `;
    return prefix + node.content.map((n: any) => richTextToPlain(n)).join('');
  }
  if (BLOCK_NODES.has(node.type)) {
    return node.content.map((n: any) => richTextToPlain(n)).join('');
  }
  return node.content.map((n: any) => richTextToPlain(n)).join('');
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const IMAGE_KEYWORDS = ['generate an image', 'generate image', 'create image', 'make image', 'visualize', 'create a picture'];
const VIDEO_KEYWORDS = ['generate a video', 'generate video', 'create video', 'make video', 'animate'];

// Random name for this session — generated once on the client only
const NAMES = ['Alex', 'Blake', 'Casey', 'Dana', 'Eli', 'Fern', 'Gray', 'Hana'];
function getSessionName() {
  if (typeof window === 'undefined') return 'Guest';
  const key = '__session_name__';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10));
  }
  return sessionStorage.getItem(key)!;
}

type PendingAction =
  | { type: 'sticky'; text: string; x: number; y: number; color: string }
  | { type: 'text'; text: string; x: number; y: number }
  | { type: 'delete'; id: string; label: string }
  | { type: 'rewrite'; id: string; oldText: string; newText: string };

// ─── Canvas inner component (needs editor ref + liveblocks hooks) ────────────

const Tldraw = dynamic(
  () => import('tldraw').then((mod) => ({ default: mod.Tldraw })),
  { ssr: false }
);

function CanvasApp() {
  const editorRef = useRef<any>(null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sessionName, setSessionName] = useState('Guest');
  useEffect(() => { setSessionName(getSessionName()); }, []);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const thinkingRef = useRef(false); // stable ref so timer closure sees current value

  // Chat is local state + ephemeral broadcast (no persistence)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const addMessage = (msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
    broadcast({ type: 'chat-message', msg });
  };

  // Canvas snapshot in Liveblocks storage (for new joiners)
  const canvasSnapshotJson = useStorage((root) => root.canvasSnapshot?.json);
  const room = useRoom();
  const serverSessionIdRef = useRef<string | null>(null);

  const saveSnapshot = (json: string) => {
    if (!serverSessionIdRef.current) return;
    room.getStorage().then(({ root }) => {
      root.get('canvasSnapshot').set('json', json);
      root.get('canvasSnapshot').set('sessionId', serverSessionIdRef.current!);
    }).catch(e => console.error('Failed to save snapshot:', e));
  };

  const broadcast = useBroadcastEvent();
  const [, updatePresence] = useMyPresence();
  const others = useOthers();
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Receive broadcast events: canvas diffs + chat messages from others
  useEventListener(({ event }: any) => {
    if (event.type === 'canvas-diff' && editorRef.current) {
      try {
        editorRef.current.store.mergeRemoteChanges(() => {
          editorRef.current.store.applyDiff(event.diff);
        });
      } catch (e) {
        console.error('Failed to apply remote diff:', e);
      }
    } else if (event.type === 'chat-message') {
      setMessages(prev => [...prev, event.msg]);
    }
  });

  // On mount: fetch server session ID, then decide whether to load or clear snapshot
  useEffect(() => {
    fetch('/api/session-id')
      .then(r => r.json())
      .then(({ sessionId }) => {
        serverSessionIdRef.current = sessionId;
        room.getStorage().then(({ root }) => {
          const snapshot = root.get('canvasSnapshot');
          const storedSessionId = snapshot.get('sessionId');
          if (storedSessionId !== sessionId) {
            // Server restarted — clear stale canvas
            snapshot.set('json', '');
            snapshot.set('sessionId', sessionId);
          } else {
            // Same session — load existing canvas for this new joiner
            const json = snapshot.get('json');
            if (json && editorRef.current) {
              try {
                editorRef.current.loadSnapshot(JSON.parse(json));
              } catch (e) {
                console.error('Failed to load canvas snapshot:', e);
              }
            }
          }
        });
      });
  }, []);

  const handleMount = (editor: any) => {
    editorRef.current = editor;
    updatePresence({ userName: sessionName, cursor: null });

    // Broadcast diffs for real-time sync + periodically save full snapshot
    editor.store.listen(
      (entry: any) => {
        const diff = entry.changes;
        if (Object.keys(diff.added).length || Object.keys(diff.updated).length || Object.keys(diff.removed).length) {
          broadcast({ type: 'canvas-diff', diff });
          // Save full snapshot so new joiners get current state
          try {
            const snapshot = editor.getSnapshot();
            saveSnapshot(JSON.stringify(snapshot));
          } catch (e) {
            console.error('Failed to serialize snapshot:', e);
          }
        }
      },
      { source: 'user' }
    );
  };


  // Proactive timer — resets whenever TAI finishes a response
  const proactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetProactiveTimer = () => {
    if (proactiveTimerRef.current) clearTimeout(proactiveTimerRef.current);
    proactiveTimerRef.current = setTimeout(async () => {
      if (thinkingRef.current || !editorRef.current) return;
      const shapes = editorRef.current.getCurrentPageShapes();
      if (shapes.length === 0) return;
      // 50% chance to skip — keeps TAI from firing every single interval
      if (Math.random() < 0.5) { resetProactiveTimer(); return; }
      thinkingRef.current = true;
      setThinking(true);
      try {
        const action = await callAI('(proactive check-in)', messagesRef.current, true);
        if (action.reply) {
          addMessage({ id: uuid(), role: 'tai', text: action.reply, userName: 'TAI', timestamp: Date.now() });
        }
        if (action.action === 'suggest_sticky') {
          setPendingAction({ type: 'sticky', text: action.text || '', x: action.x || Math.random() * 700 + 300, y: action.y || Math.random() * 400 + 200, color: action.color || 'yellow' });
        } else if (action.action === 'suggest_text') {
          setPendingAction({ type: 'text', text: action.text || '', x: action.x || Math.random() * 700 + 300, y: action.y || Math.random() * 400 + 200 });
        }
      } catch (e) {
        console.error('Proactive TAI error:', e);
      }
      thinkingRef.current = false;
      setThinking(false);
      resetProactiveTimer(); // reschedule after each proactive response
    }, 5 * 60 * 1000);
  };

  useEffect(() => {
    resetProactiveTimer();
    return () => { if (proactiveTimerRef.current) clearTimeout(proactiveTimerRef.current); };
  }, []);

  // Keep thinkingRef in sync
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, pendingAction]);

  const applyPending = () => {
    if (!pendingAction || !editorRef.current) return;
    const editor = editorRef.current;

    if (pendingAction.type === 'rewrite') {
      editor.updateShape({
        id: pendingAction.id,
        type: 'text',
        props: { richText: toRichText(pendingAction.newText), autoSize: true },
      });
      addMessage({ id: uuid(), role: 'tai-system', text: '✓ Updated on canvas.', userName: 'TAI', timestamp: Date.now() });
    } else if (pendingAction.type === 'delete') {
      editor.deleteShape(pendingAction.id);
      addMessage({ id: uuid(), role: 'tai-system', text: '✓ Deleted from canvas.', userName: 'TAI', timestamp: Date.now() });
    } else if (pendingAction.type === 'sticky') {
      const { text, x, y, color } = pendingAction;
      const avatarId = createShapeId();
      editor.createShape({ id: avatarId, type: 'text', x: x - 40, y: y - 70, props: { richText: toRichText('🧠 TAI'), scale: 1 } });
      editor.createShape({ id: createShapeId(), type: 'note', x, y, props: { richText: toRichText(text), color: color || 'yellow' } });
      setTimeout(() => editor.deleteShape(avatarId), 1400);
      addMessage({ id: uuid(), role: 'tai-system', text: '✓ Added to canvas.', userName: 'TAI', timestamp: Date.now() });
    } else if (pendingAction.type === 'text') {
      const { text, x, y } = pendingAction;
      const avatarId = createShapeId();
      editor.createShape({ id: avatarId, type: 'text', x: x - 40, y: y - 40, props: { richText: toRichText('🧠 TAI'), scale: 1 } });
      editor.createShape({ id: createShapeId(), type: 'text', x, y, props: { richText: toRichText(text), scale: 1, autoSize: true } });
      setTimeout(() => editor.deleteShape(avatarId), 1400);
      addMessage({ id: uuid(), role: 'tai-system', text: '✓ Added to canvas.', userName: 'TAI', timestamp: Date.now() });
    }

    setPendingAction(null);
  };

  const rejectPending = () => {
    setPendingAction(null);
    addMessage({ id: uuid(), role: 'tai-system', text: '↩ Discarded.', userName: 'TAI', timestamp: Date.now() });
  };

  const callAI = async (message: string, history: ChatMessage[], isProactive = false) => {
    const editor = editorRef.current;
    const shapes = editor.getCurrentPageShapes();
    const hasDrawings = shapes.some((s: any) => s.type === 'draw');

    const selectedIds = new Set(editor.getSelectedShapeIds());
    const canvasSummary = shapes.length > 0
      ? `Canvas has ${shapes.length} items:\n` +
        shapes.map((s: any) => {
          const text = richTextToPlain(s.props?.richText) || s.props?.text || '';
          const label = s.type === 'image' ? `[IMAGE w:${Math.round(s.props?.w ?? 0)} h:${Math.round(s.props?.h ?? 0)}]`
            : s.type === 'video' ? `[VIDEO w:${Math.round(s.props?.w ?? 0)} h:${Math.round(s.props?.h ?? 0)}]`
            : s.type === 'draw' ? '[DRAWING]'
            : `[${s.type}] "${text}"`;
          const selected = selectedIds.has(s.id) ? ' *** SELECTED ***' : '';
          return `- [id:${s.id}] ${label} at (${Math.round(s.x)},${Math.round(s.y)})${selected}`;
        }).join('\n')
      : 'Empty canvas';

    let screenshotBase64: string | null = null;
    if (hasDrawings) {
      try {
        const { blob } = await editor.toImage(shapes, { format: 'png', scale: 1 });
        screenshotBase64 = await blobToBase64(blob);
      } catch (e) { console.error('Screenshot failed:', e); }
    }

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatHistory: history.map(m => ({ role: m.role, text: m.text })),
        canvasSummary,
        message,
        hasDrawings,
        screenshotBase64,
        isProactive,
      }),
    });
    return res.json();
  };

  const sendMessage = async () => {
    if (!input.trim() || !editorRef.current) return;

    const replyPrefix = replyingTo
      ? `[Replying to ${replyingTo.role === 'tai' ? 'TAI' : replyingTo.userName}: "${replyingTo.text.slice(0, 60)}"] `
      : '';

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      text: replyPrefix + input,
      userName: sessionName,
      timestamp: Date.now(),
    };

    addMessage(userMsg);
    const userInput = replyPrefix + input;
    setInput('');
    setReplyingTo(null);

    const isMentioned = /@tai/i.test(userInput) || /\bbot\b/i.test(userInput);
    const isReplyToTAI = replyingTo?.role === 'tai' || replyingTo?.role === 'spark';
    const wantsImage = IMAGE_KEYWORDS.some(kw => userInput.toLowerCase().includes(kw));
    const wantsVideo = VIDEO_KEYWORDS.some(kw => userInput.toLowerCase().includes(kw));
    const shouldRespond = isMentioned || isReplyToTAI || Math.random() < 0.25;
    if (!shouldRespond || thinkingRef.current) return;

    setThinking(true);

    // Helper: get selected image URL from canvas (if any image shape is selected)
    const getSelectedImageUrl = (): string | null => {
      const editor = editorRef.current;
      const selected = editor.getSelectedShapes();
      const imgShape = selected.find((s: any) => s.type === 'image');
      if (!imgShape) return null;
      const asset = editor.getAsset((imgShape as any).props.assetId);
      return (asset as any)?.props?.src ?? null;
    };

    // Helper: place an image URL onto the canvas
    const placeImage = (imageUrl: string) => {
      const editor = editorRef.current;
      const assetId = AssetRecordType.createId();
      editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', props: { src: imageUrl, w: 800, h: 600, mimeType: 'image/png', isAnimated: false, name: 'generated' }, meta: {} }]);
      editor.createShape({ id: createShapeId(), type: 'image', x: Math.random() * 400 + 100, y: Math.random() * 200 + 100, props: { assetId, w: 400, h: 300, altText: userInput } });
    };

    if (wantsVideo) {
      const selectedImageUrl = getSelectedImageUrl();
      addMessage({ id: uuid(), role: 'tai', text: selectedImageUrl ? 'Animating selected image into a video...' : 'Generating video...', userName: 'TAI', timestamp: Date.now() });
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userInput, imageUrl: selectedImageUrl }),
      });
      const data = await res.json();
      if (data.videoUrl) {
        addMessage({ id: uuid(), role: 'tai', text: 'Video generated and placed on the canvas!', userName: 'TAI', timestamp: Date.now() });
        const editor = editorRef.current;
        const assetId = AssetRecordType.createId();
        editor.createAssets([{
          id: assetId,
          type: 'video',
          typeName: 'asset',
          props: { src: data.videoUrl, w: 640, h: 360, mimeType: 'video/mp4', isAnimated: true, name: 'generated-video' },
          meta: {},
        }]);
        editor.createShape({
          id: createShapeId(),
          type: 'video',
          x: Math.random() * 400 + 100,
          y: Math.random() * 200 + 100,
          props: { assetId, w: 640, h: 360, altText: userInput, playing: true, autoplay: true },
        });
      } else {
        addMessage({ id: uuid(), role: 'tai', text: data.error || 'Video generation failed.', userName: 'TAI', timestamp: Date.now() });
      }
      setThinking(false);
      return;
    }

    if (wantsImage) {
      const selectedImageUrl = getSelectedImageUrl();
      addMessage({ id: uuid(), role: 'tai', text: selectedImageUrl ? 'Editing selected image...' : 'Generating image...', userName: 'TAI', timestamp: Date.now() });
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userInput, imageUrl: selectedImageUrl }),
      });
      const data = await res.json();
      if (data.imageUrl) {
        addMessage({ id: uuid(), role: 'tai', text: selectedImageUrl ? 'Done! Edited image placed on canvas.' : 'Done! Image placed on canvas.', userName: 'TAI', timestamp: Date.now() });
        placeImage(data.imageUrl);
      } else {
        addMessage({ id: uuid(), role: 'tai', text: data.error || 'Image generation failed.', userName: 'TAI', timestamp: Date.now() });
      }
      setThinking(false);
      return;
    }

    // Pass recent messages as history
    const history = [...(messages as ChatMessage[]), userMsg];
    const action = await callAI(userInput, history, !isMentioned);

    addMessage({ id: uuid(), role: 'tai', text: action.reply || 'Got it!', userName: 'TAI', timestamp: Date.now() });

    if (action.action === 'suggest_sticky') {
      setPendingAction({ type: 'sticky', text: action.text || '', x: action.x || Math.random() * 700 + 300, y: action.y || Math.random() * 400 + 200, color: action.color || 'yellow' });
    } else if (action.action === 'suggest_text') {
      setPendingAction({ type: 'text', text: action.text || '', x: action.x || Math.random() * 700 + 300, y: action.y || Math.random() * 400 + 200 });
    } else if (action.action === 'suggest_delete' && action.deleteId) {
      const shapes = editorRef.current.getCurrentPageShapes();
      const target = shapes.find((s: any) => s.id === action.deleteId);
      const label = target ? richTextToPlain(target.props?.richText) || target.type : action.deleteId;
      setPendingAction({ type: 'delete', id: action.deleteId, label });
    } else if (action.action === 'suggest_rewrite' && action.deleteId) {
      const shapes = editorRef.current.getCurrentPageShapes();
      const target = shapes.find((s: any) => s.id === action.deleteId);
      const oldText = target ? richTextToPlain(target.props?.richText) || '' : '';
      setPendingAction({ type: 'rewrite', id: action.deleteId, oldText, newText: action.text || '' });
    }

    setThinking(false);
    resetProactiveTimer(); // reset timer after every TAI response
  };

  return (
    <div className="w-screen h-screen relative">
      <Tldraw onMount={handleMount} />

      {/* Online users */}
      <div className="absolute top-6 right-6 flex items-center gap-2 z-50">
        {others.map((other) => (
          <div key={other.connectionId} className="bg-white/90 backdrop-blur px-3 py-1 rounded-2xl shadow text-xs font-medium">
            {other.presence?.userName ?? 'Guest'}
          </div>
        ))}
        <div className="bg-orange-500 text-white px-3 py-1 rounded-2xl shadow text-xs font-medium">
          {sessionName} (you)
        </div>
      </div>

      {/* Chat Panel */}
      <div className="absolute bottom-8 left-8 w-96 bg-white/95 backdrop-blur-xl border shadow-2xl rounded-3xl p-4 max-h-[480px] flex flex-col z-50">
        <div className="font-semibold text-sm mb-3 flex items-center gap-2">
          <span className="text-xl">💬</span>
          Team Chat + TAI
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 text-sm">
          {(messages as ChatMessage[]).map((msg) => (
            <div key={msg.id} className={`flex group ${msg.role === 'tai' || msg.role === 'spark' ? 'justify-start' : msg.role === 'tai-system' ? 'justify-center' : 'justify-end'}`}>
              {msg.role === 'tai-system' ? (
                <span className="text-xs text-zinc-400 italic">{msg.text}</span>
              ) : (
                <div className="flex flex-col gap-1 max-w-[80%]">
                  <div className={`px-4 py-3 rounded-3xl ${msg.role === 'tai' || msg.role === 'spark' ? 'bg-orange-100' : 'bg-zinc-100'}`}>
                    {(msg.role === 'tai' || msg.role === 'spark') && <div className="text-[10px] text-orange-600 mb-1">🧠 TAI</div>}
                    {msg.role === 'user' && <div className="text-[10px] text-zinc-400 mb-1">{msg.userName}</div>}
                    {msg.text}
                  </div>
                  <button
                    onClick={() => {
                      setReplyingTo(msg);
                      setInput('');
                    }}
                    className="text-[10px] text-zinc-400 hover:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity self-start px-2"
                  >
                    ↩ Reply
                  </button>
                </div>
              )}
            </div>
          ))}
          {thinking && <div className="text-orange-400 text-xs animate-pulse pl-2">TAI is thinking...</div>}

          {pendingAction && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 text-sm">
              <div className="text-[10px] text-orange-600 mb-1">
                🧠 TAI wants to {pendingAction.type === 'delete' ? 'delete from' : pendingAction.type === 'rewrite' ? 'edit on' : 'add to'} canvas:
              </div>
              <div className="font-medium mb-3 whitespace-pre-wrap text-xs">
                {pendingAction.type === 'delete' && `Delete: "${pendingAction.label}"`}
                {pendingAction.type === 'rewrite' && (
                  <div className="space-y-1">
                    <div className="line-through text-red-400">{pendingAction.oldText}</div>
                    <div className="text-green-600">{pendingAction.newText}</div>
                  </div>
                )}
                {(pendingAction.type === 'sticky' || pendingAction.type === 'text') && `"${pendingAction.text}"`}
              </div>
              <div className="flex gap-2">
                <button onClick={applyPending} className={`flex-1 ${pendingAction.type === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'} text-white rounded-2xl py-1.5 text-xs font-medium`}>
                  {pendingAction.type === 'delete' ? 'Delete' : 'Apply'}
                </button>
                <button onClick={rejectPending} className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-2xl py-1.5 text-xs font-medium">
                  Discard
                </button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-zinc-50 border rounded-2xl text-xs text-zinc-500">
            <span className="flex-1 truncate">↩ Replying to: "{replyingTo.text.slice(0, 50)}{replyingTo.text.length > 50 ? '…' : ''}"</span>
            <button onClick={() => setReplyingTo(null)} className="text-zinc-400 hover:text-zinc-600 font-bold">✕</button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Chat here... use @TAI to mention"
            className="flex-1 border rounded-3xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
          />
          <button onClick={sendMessage} className="bg-orange-500 hover:bg-orange-600 text-white px-6 rounded-3xl">
            Send
          </button>
        </div>
      </div>

      {/* TAI status */}
      <div className="absolute top-6 left-6 bg-white/90 backdrop-blur px-4 py-2 rounded-3xl shadow flex items-center gap-2 z-50">
        <span className="text-2xl">🧠</span>
        <div className="text-sm">
          TAI is watching
          <div className="text-[10px] text-zinc-500">mention with @TAI</div>
        </div>
      </div>
    </div>
  );
}

// ─── Root: wrap with Liveblocks RoomProvider ────────────────────────────────

export default function Home() {
  return (
    <RoomProvider
      id="brainstorm-room"
      initialPresence={{ userName: 'Guest', cursor: null }}
      initialStorage={{ canvasSnapshot: new LiveObject({ json: '', sessionId: '' }) }}
    >
      <CanvasApp />
    </RoomProvider>
  );
}
