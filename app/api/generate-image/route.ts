import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://platform.higgsfield.ai';
const HF_HEADERS = {
  'Content-Type': 'application/json',
  'hf-api-key': process.env.HIGGSFIELD_API_KEY!,
  'hf-secret': process.env.HIGGSFIELD_API_SECRET!,
};

async function poll(requestId: string, maxAttempts = 30, intervalMs = 3000): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const res = await fetch(`${BASE_URL}/requests/${requestId}/status`, { headers: HF_HEADERS });
    if (!res.ok) { console.error('Poll error:', await res.text()); return null; }
    const data = await res.json();
    console.log('Poll status:', data);
    if (data.status === 'completed' || data.status === 'succeeded' || data.status === 'success') {
      return data.images?.[0]?.url ?? data.url ?? data.image_url ?? data.output ?? null;
    }
    if (data.status === 'failed' || data.status === 'error') { console.error('Generation failed:', data); return null; }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, imageUrl: inputImageUrl } = body;

    if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

    const startRes = await fetch(`${BASE_URL}/flux-2`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({
        image_urls: inputImageUrl ? [inputImageUrl] : [],
        resolution: '1k',
        aspect_ratio: '4:3',
        prompt_upsampling: true,
        prompt,
      }),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      console.error('Higgsfield start error:', err);
      return NextResponse.json({ error: 'Image generation failed to start' }, { status: 502 });
    }

    const startData = await startRes.json();
    console.log('Higgsfield start response:', startData);

    const immediateUrl = startData.images?.[0]?.url ?? startData.url ?? startData.image_url ?? null;
    if (immediateUrl) return NextResponse.json({ imageUrl: immediateUrl });

    const requestId = startData.request_id ?? startData.id ?? startData.requestId;
    if (!requestId) {
      console.error('No request_id in response:', startData);
      return NextResponse.json({ error: 'No request ID returned' }, { status: 502 });
    }

    const resultUrl = await poll(requestId);
    if (!resultUrl) return NextResponse.json({ error: 'Image generation timed out or failed' }, { status: 502 });

    return NextResponse.json({ imageUrl: resultUrl });
  } catch (err) {
    console.error('generate-image route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
