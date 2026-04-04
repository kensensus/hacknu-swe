'use client';

import dynamic from 'next/dynamic';
import 'tldraw/tldraw.css';
import { useRef, useState } from 'react';

const Tldraw = dynamic(
  () => import('tldraw').then((mod) => ({ default: mod.Tldraw })),
  { ssr: false }
);

export default function Home() {
  const editorRef = useRef<any>(null);
  const [chatMessages, setChatMessages] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  const handleMount = (editor: any) => {
    editorRef.current = editor;
    console.log('🎨 Canvas + Shared Chat + Spark ready!');
  };

  // Send message to shared chat + ask Spark
  const sendMessage = async () => {
    if (!input.trim() || !editorRef.current) return;

    // Add user's message to chat
    const userMsg = { role: 'user', text: input };
    setChatMessages(prev => [...prev, userMsg]);
    const userInput = input;
    setInput('');
    setThinking(true);

    const editor = editorRef.current;
    const shapes = editor.getCurrentPageShapes();

    // Build canvas summary for Claude
    const canvasSummary = shapes.length > 0
      ? `Canvas has ${shapes.length} items. Recent ideas: ${shapes.slice(-5).map((s: any) => s.props?.text?.slice(0, 40) || '').join(' | ')}`
      : 'Empty canvas';

    // Send chat history + canvas to Spark
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatHistory: [...chatMessages, userMsg],   // full conversation
        canvasSummary,
        message: userInput,
      }),
    });

    const action = await res.json();

    // Add Spark's reply to the shared chat
    setChatMessages(prev => [...prev, { role: 'spark', text: action.reply || action.text || 'Got it!' }]);

    // Spark acts spatially on the canvas
    if (action.action === 'add_sticky' || action.action === 'add_note') {
      const x = action.x || Math.random() * 700 + 300;
      const y = action.y || Math.random() * 400 + 200;

      // Show Spark "moving" on canvas
      const avatarId = editor.createShape({
        type: 'geo',
        x: x - 40,
        y: y - 70,
        props: { w: 40, h: 40, text: '🧠', fill: 'orange' },
      });

      // Create the actual content
      editor.createShape({
        type: 'geo',
        x: x,
        y: y,
        props: {
          w: 260,
          h: 130,
          text: action.text,
          fill: action.color || 'orange',
        },
      });

      setTimeout(() => editor.deleteShape(avatarId), 1400);
    }

    setThinking(false);
  };

  return (
    <div className="w-screen h-screen relative">
      <Tldraw onMount={handleMount} />

      {/* Shared Chat Panel (on the canvas) */}
      <div className="absolute bottom-8 left-8 w-96 bg-white/95 backdrop-blur-xl border shadow-2xl rounded-3xl p-4 max-h-[420px] flex flex-col z-50">
        <div className="font-semibold text-sm mb-3 flex items-center gap-2">
          <span className="text-xl">💬</span>
          Team Chat + Spark
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 mb-4 text-sm">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'spark' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] px-4 py-3 rounded-3xl ${msg.role === 'spark' ? 'bg-orange-100' : 'bg-zinc-100'}`}>
                {msg.role === 'spark' && <div className="text-[10px] text-orange-600 mb-1">🧠 Spark</div>}
                {msg.text}
              </div>
            </div>
          ))}
          {thinking && <div className="text-orange-500 text-xs animate-pulse">Spark is thinking...</div>}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type here... (everyone + Spark sees this)"
            className="flex-1 border rounded-3xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={sendMessage}
            disabled={thinking}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 rounded-3xl"
          >
            Send
          </button>
        </div>
      </div>

      {/* Spark status */}
      <div className="absolute top-6 left-6 bg-white/90 backdrop-blur px-4 py-2 rounded-3xl shadow flex items-center gap-2 z-50">
        <span className="text-2xl">🧠</span>
        <div className="text-sm">
          Spark is watching
          <div className="text-[10px] text-zinc-500">chat + canvas</div>
        </div>
      </div>
    </div>
  );
}