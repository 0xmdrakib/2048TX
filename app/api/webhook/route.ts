import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // You can ignore the body if you only want to clear the warning
  // (clients may send notification tokens here). :contentReference[oaicite:2]{index=2}
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
