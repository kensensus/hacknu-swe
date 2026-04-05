import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://platform.higgsfield.ai';
const HF_HEADERS = {
  'Content-Type': 'application/json',
  'hf-api-key': process.env.HIGGSFIELD_API_KEY!,
  'hf-secret': process.env.HIGGSFIELD_API_SECRET!,
};

async function poll(requestId: string, maxAttempts = 40, intervalMs = 4000): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const res = await fetch(`${BASE_URL}/requests/${requestId}/status`, { headers: HF_HEADERS });
    if (!res.ok) { console.error('Poll error:', await res.text()); return null; }
    const data = await res.json();
    console.log('Video poll status:', data);
    if (data.status === 'completed' || data.status === 'succeeded' || data.status === 'success') {
      return data.video?.url ?? data.videos?.[0]?.url ?? data.url ?? data.video_url ?? data.output ?? null;
    }
    if (data.status === 'failed' || data.status === 'error') { console.error('Video failed:', data); return null; }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, imageUrl } = await request.json();
    if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

    const body: any = {
      params: {
        sound: 'on',
        duration: 5,
        elements: [],
        cfg_scale: 0.5,
        multi_shots: false,
        multi_prompt: [],
        prompt,
      },
    };

    if (imageUrl) body.image_url = imageUrl;

    // image-to-video if image provided, text-to-video otherwise
    const endpoint = imageUrl
      ? '/generate/kling-video/v3.0/std/image-to-video'
      : '/generate/kling-video/v3.0/std/text-to-video';

    const startRes = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify(body),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      console.error('Higgsfield video start error:', err);
      return NextResponse.json({ error: 'Video generation failed to start' }, { status: 502 });
    }

    const startData = await startRes.json();
    console.log('Higgsfield video start response:', startData);

    const immediateUrl = startData.video?.url ?? startData.videos?.[0]?.url ?? startData.url ?? startData.video_url ?? null;
    if (immediateUrl) return NextResponse.json({ videoUrl: immediateUrl });

    const requestId = startData.id ?? startData.request_id ?? startData.requestId;
    if (!requestId) {
      console.error('No request_id in response:', startData);
      return NextResponse.json({ error: 'No request ID returned' }, { status: 502 });
    }

    const videoUrl = await poll(requestId);
    if (!videoUrl) return NextResponse.json({ error: 'Video generation timed out or failed' }, { status: 502 });

    return NextResponse.json({ videoUrl });
  } catch (err) {
    console.error('generate-video route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
