type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitEntry>;

declare global {
  // Reuse the counter across warm invocations of the same Vercel instance.
  var __2048txRateLimitStore: RateLimitStore | undefined;
}

const store = globalThis.__2048txRateLimitStore ?? new Map<string, RateLimitEntry>();
globalThis.__2048txRateLimitStore = store;

const MAX_RATE_LIMIT_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
};

function pruneStore(now: number) {
  if (store.size < MAX_RATE_LIMIT_KEYS) return;

  for (const [key, value] of store) {
    if (value.resetAt <= now) store.delete(key);
  }

  // Keep random/spoofed IP headers from growing a warm instance forever.
  if (store.size >= MAX_RATE_LIMIT_KEYS) store.clear();
}

export function getClientIp(req: Request): string {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const cloudflareIp = normalizeIp(req.headers.get("cf-connecting-ip"));
  const hasCloudflareRay = Boolean(req.headers.get("cf-ray"));
  const isDirectVercelHost = host.endsWith(".vercel.app");

  // On the proxied custom domain Cloudflare supplies the actual visitor IP.
  // Direct Vercel traffic must use Vercel's own client-IP header instead.
  if (cloudflareIp && hasCloudflareRay && !isDirectVercelHost) return cloudflareIp;

  return (
    normalizeIp(req.headers.get("x-vercel-forwarded-for")) ||
    normalizeIp(req.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}

function normalizeIp(value: string | null): string | null {
  const ip = value?.split(",")[0]?.trim();
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

export function checkRateLimit(params: {
  req: Request;
  bucket: string;
  limit: number;
  windowMs: number;
  cost?: number;
}): RateLimitResult {
  const now = Date.now();
  const cost = Math.max(1, Math.floor(params.cost ?? 1));
  const key = `${params.bucket}:${getClientIp(params.req)}`;

  pruneStore(now);

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + params.windowMs };
  }

  const allowed = entry.count + cost <= params.limit;
  if (allowed) entry.count += cost;
  store.set(key, entry);

  return {
    allowed,
    limit: params.limit,
    remaining: Math.max(0, params.limit - entry.count),
    resetAt: entry.resetAt,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "ratelimit-limit": String(result.limit),
    "ratelimit-remaining": String(result.remaining),
    "ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed ? {} : { "retry-after": String(result.retryAfter) }),
  };
}
