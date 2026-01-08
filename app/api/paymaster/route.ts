export async function POST(req: Request) {
  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) {
    return new Response("Missing CDP_PAYMASTER_URL", { status: 500 });
  }

  // Read raw body (JSON-RPC)
  const bodyText = await req.text();

  // Basic safety: only allow Paymaster JSON-RPC methods
  // (tighten/loosen as needed)
  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const method = String(payload?.method ?? "");
  if (!method.startsWith("pm_")) {
    return new Response("Forbidden", { status: 403 });
  }

  const upstreamRes = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
  });

  return new Response(await upstreamRes.text(), {
    status: upstreamRes.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
