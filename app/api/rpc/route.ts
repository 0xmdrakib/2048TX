import {
  checkRateLimit,
  rateLimitHeaders,
} from "../../../lib/server/requestSecurity";

const allowedMethods = new Set(["eth_call", "eth_getTransactionReceipt"]);

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json",
} as const;

function errorResponse(message: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { ...responseHeaders, ...headers } });
}

export async function POST(req: Request) {
  const upstream = process.env.BASE_RPC_URL;
  if (!upstream) return errorResponse("RPC is not configured", 500);

  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return errorResponse("Forbidden", 403);
  }

  const rateLimit = checkRateLimit({
    req,
    bucket: "rpc",
    limit: 300,
    windowMs: 60_000,
  });
  const limitHeaders = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) return errorResponse("Too many requests", 429, limitHeaders);

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) return errorResponse("Request too large", 413, limitHeaders);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400, limitHeaders);
  }

  if (Array.isArray(payload) || !allowedMethods.has(String(payload?.method ?? ""))) {
    return errorResponse("Method not allowed", 403, limitHeaders);
  }

  const method = String(payload.method);
  const params = Array.isArray(payload.params) ? payload.params : [];

  if (method === "eth_call") {
    const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS?.toLowerCase();
    const target = String(params?.[0]?.to ?? "").toLowerCase();
    if (!contract || target !== contract) {
      return errorResponse("Contract not allowed", 403, limitHeaders);
    }
  }

  if (method === "eth_getTransactionReceipt") {
    const txHash = String(params?.[0] ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return errorResponse("Invalid transaction hash", 400, limitHeaders);
    }
  }

  const upstreamResponse = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id ?? 1,
      method,
      params,
    }),
    cache: "no-store",
  });

  return new Response(await upstreamResponse.text(), {
    status: upstreamResponse.status,
    headers: { ...responseHeaders, ...limitHeaders },
  });
}
