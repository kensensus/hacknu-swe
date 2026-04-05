# TAI — AI Brainstorming Canvas

A real-time collaborative canvas where an AI agent named **TAI** lives alongside your team. Built for HackNU 2026 by Higgsfield AI team.

## What it does

- **Shared canvas** — multiple users draw, write, and brainstorm together on a [tldraw](https://tldraw.dev) canvas synced in real time via [Liveblocks](https://liveblocks.io)
- **TAI AI agent** — an AI collaborator that reads the canvas, participates in team chat, and proposes additions, edits, or deletions to the canvas
- **Approval flow** — TAI always proposes changes first; the team clicks Apply or Discard before anything is committed to the canvas
- **Image generation** — ask TAI to generate or edit an image (Higgsfield Flux 2 Pro)
- **Video generation** — ask TAI to generate a video or animate a selected image (Higgsfield Kling v3.0)
- **Vision mode** — when the canvas contains handwritten drawings, TAI takes a screenshot and uses a vision model to understand them

## How to trigger TAI

| Trigger | Example |
|---|---|
| Mention `@TAI` | `@TAI what should we add here?` |
| Say `bot` | `bot give me ideas` |
| Reply to a TAI message | click the ↩ Reply button |
| 25% random chance | on any message |
| Proactive (every ~5-10 min) | TAI chimes in on its own if the canvas has content |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 App Router, React, Tailwind CSS |
| Canvas | tldraw v4 |
| Multiplayer | Liveblocks (canvas persistence + ephemeral chat broadcast) |
| AI (text) | OpenRouter — Step 3.5 Flash → Qwen 3.6 Plus → MiniMax M2.5 (free tier, with fallback) |
| Image generation | Higgsfield Flux 2 Pro |
| Video generation | Higgsfield Kling v3.0 |

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create `.env.local`** in the project root:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   HIGGSFIELD_API_KEY=...
   HIGGSFIELD_API_SECRET=...
   NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY=pk_dev_...
   ```

3. **Run the dev server**
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

To share with teammates on the same network, find your local IP and open `http://<your-ip>:3000`.

## Project structure

```
app/
  page.tsx                  # Main canvas + chat UI, TAI integration
  liveblocks.config.ts      # Liveblocks types and room provider
  api/
    ai/route.ts             # LLM route with model fallback chain
    generate-image/route.ts # Higgsfield image generation + editing
    generate-video/route.ts # Higgsfield video generation
    session-id/route.ts     # Server session ID (canvas reset on restart)
```
