import {
  checkRateLimit,
  rateLimitHeaders,
} from "../../../lib/server/requestSecurity";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
} as const;

export async function OPTIONS() {
  // Some environments may preflight (especially in stricter mobile webviews).
  return new Response(null, { status: 204, headers: corsHeaders });
}


const ALLOWED_BUNDLER_METHODS = new Set([
  // Common ERC-4337 bundler methods (the CDP endpoint is "Paymaster & Bundler").
  "eth_supportedEntryPoints",
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",

  // Some clients also call these on the bundler endpoint:
  "eth_chainId",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getUserOperationGasPrice",
]);

const EXPENSIVE_METHODS = new Set(["eth_sendUserOperation", "eth_estimateUserOperationGas"]);

function isAllowedMethod(method: string) {
  if (method.startsWith("pm_")) return true; // ERC-7677 paymaster methods
  if (ALLOWED_BUNDLER_METHODS.has(method)) return true;
  return false;
}

function isExpensiveMethod(method: string) {
  return method.startsWith("pm_") || EXPENSIVE_METHODS.has(method);
}

function rateLimitError(message: string, headers: Record<string, string>) {
  return Response.json({ error: message }, { status: 429, headers: { ...corsHeaders, ...headers } });
}

export async function POST(req: Request) {
  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) {
    return new Response("Missing CDP_PAYMASTER_URL", { status: 500 });
  }

  const generalLimit = checkRateLimit({
    req,
    bucket: "paymaster-total",
    limit: 180,
    windowMs: 60_000,
  });
  const generalHeaders = rateLimitHeaders(generalLimit);
  if (!generalLimit.allowed) return rateLimitError("Too many requests", generalHeaders);

  const bodyText = await req.text();

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Wallets may send JSON-RPC batch requests.
  const requests = Array.isArray(payload) ? payload : [payload];

  const methods: string[] = [];
  for (const r of requests) {
    const method = String(r?.method ?? "");
    if (!isAllowedMethod(method)) {
      return new Response("Forbidden", { status: 403 });
    }
    methods.push(method);
  }

  const expensiveCount = methods.filter(isExpensiveMethod).length;
  let responseLimitHeaders = generalHeaders;

  if (expensiveCount > 0) {
    const expensiveLimit = checkRateLimit({
      req,
      bucket: "paymaster-expensive",
      limit: 30,
      windowMs: 60_000,
      cost: expensiveCount,
    });
    responseLimitHeaders = rateLimitHeaders(expensiveLimit);
    if (!expensiveLimit.allowed) {
      return rateLimitError("Too many sponsored requests", responseLimitHeaders);
    }
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
      ...corsHeaders,
      ...responseLimitHeaders,
    },
  });
}
