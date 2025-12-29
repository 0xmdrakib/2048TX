import { NextResponse } from "next/server";

// Base / Farcaster may ping this webhook during add/pin validation and for future events.
// We don't require any processing yet; just ACK with 200.
export async function POST(req: Request) {
  try {
    await req.text();
  } catch {
    // ignore
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
