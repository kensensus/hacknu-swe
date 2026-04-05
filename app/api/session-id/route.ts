import { NextResponse } from 'next/server';

// Generated once when the server starts — changes on every restart
const SERVER_SESSION_ID = Date.now().toString();

export async function GET() {
  return NextResponse.json({ sessionId: SERVER_SESSION_ID });
}
