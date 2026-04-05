import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are TAI, an AI brainstorming collaborator inside a shared canvas with a team.
You behave like a real human teammate — thoughtful, concise, and collaborative.

When responding, always return valid JSON with this structure:
{
  "reply": "your short conversational reply (1-2 sentences)",
  "action": "suggest_sticky" | "suggest_text" | "suggest_delete" | "suggest_rewrite" | "none",
  "text": "content to add or the new rewritten content of the shape",
  "deleteId": "shape id to delete or rewrite (for suggest_delete and suggest_rewrite)",
  "x": 400,
  "y": 300,
  "color": "orange" | "blue" | "green" | "yellow" | "red"
}

Action rules — be conservative, only use canvas actions when they genuinely add value:
- "none": use this for questions, elaborations, explanations, follow-ups, opinions. If the user asks you to elaborate, explain, or discuss — ALWAYS use "none" and just reply in the chat.
- "suggest_sticky": propose a short sticky note idea (1 sentence max). Only when brainstorming new ideas that belong on the canvas as a card.
- "suggest_text": propose a longer text block or a table (use tab characters or spacing to format tables). Use for structured content like lists, comparisons, or summaries that need more space than a sticky note.
- "suggest_delete": propose removing an entire shape by its ID. IMPORTANT: whenever the user says "delete", "remove", or "get rid of" a shape and you can identify it from the canvas state — you MUST use this action with the exact shape id from the canvas. Never just chat about deleting — always return the action.
- "suggest_rewrite": propose editing the content of an existing shape. Use when the user wants to remove specific lines, rename, or modify content inside a shape. Set "deleteId" to the shape's id and "text" to the full new content of that shape.

The user must approve all canvas actions before they are applied — you are proposing, not acting.
Canvas coordinates: x 0-1200, y 0-800. Spread content out, don't stack.
Shapes marked *** SELECTED *** are currently selected by the user — treat them as the target when user says "this", "it", "the selected", etc.
Never be verbose. Sound like a real collaborator, not an assistant.
Always respond with valid JSON only, no markdown, no extra text.`;

// Model fallback chains
const TEXT_MODELS = ['stepfun/step-3.5-flash:free', 'qwen/qwen3.6-plus:free', 'minimax/minimax-m2.5:free'];
const VISION_MODELS = ['qwen/qwen3.6-plus:free', 'stepfun/step-3.5-flash:free', 'minimax/minimax-m2.5:free'];

async function callModel(model: string, messages: any[]): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-OpenRouter-Title': 'HackNU Brainstorm Canvas',
    },
    body: JSON.stringify({ model, messages }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, canvasSummary, chatHistory, hasDrawings, screenshotBase64 } = body;

    const models = hasDrawings ? VISION_MODELS : TEXT_MODELS;

    let userContent: any;
    if (hasDrawings && screenshotBase64) {
      userContent = [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
        {
          type: 'text',
          text: `Canvas state (text shapes): ${canvasSummary || 'Empty canvas'}

Chat history:
${(chatHistory || []).map((m: { role: string; text: string }) => `${m.role}: ${m.text}`).join('\n')}

Latest message: ${message}`,
        },
      ];
    } else {
      userContent = `Canvas state: ${canvasSummary || 'Empty canvas'}

Chat history:
${(chatHistory || []).map((m: { role: string; text: string }) => `${m.role}: ${m.text}`).join('\n')}

Latest message: ${message}`;
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    // Try each model in order, fall back on rate limit (429) or error
    let lastError = '';
    for (const model of models) {
      const response = await callModel(model, messages);

      if (response.ok) {
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content ?? '{}';
        const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = { reply: cleaned, action: 'none' };
        }
        return NextResponse.json(parsed);
      }

      const errText = await response.text();
      lastError = errText;
      console.warn(`Model ${model} failed:`, errText);

      // Only fall back on rate limit errors, not auth/bad request
      let errJson: any = {};
      try { errJson = JSON.parse(errText); } catch {}
      const code = errJson?.error?.code;
      if (code !== 429 && response.status !== 429) break;
    }

    console.error('All models failed. Last error:', lastError);
    return NextResponse.json({ error: 'All models unavailable' }, { status: 502 });
  } catch (err) {
    console.error('Agent route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
