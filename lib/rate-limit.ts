// =============================================================================
// Rate limiter — Phase 5.1
// =============================================================================
//
// 2-tier strategy:
// - Production / multi-instance (Vercel serverless): Upstash Redis when env vars set
// - Dev / single-instance fallback: in-memory Map (current behaviour)
//
// Why: Vercel cold-start creates a fresh JS module per instance, so the
// in-memory Map's count is per-instance — not global. Attacker spamming can
// land on different instances each time and bypass the limit entirely. Upstash
// keeps counter in shared Redis so all instances see the same number.
//
// Usage in any API route:
//   const result = await rateLimit({ key: `leads:${ip}`, max: 5, windowMs: 60_000 });
//   if (!result.success) return NextResponse.json({error: 'rate-limited'}, {status: 429});
//
// =============================================================================

type RateLimitArgs = {
  /** Unique identifier per actor — typically `${resource}:${ip}` */
  key: string;
  /** Max requests allowed within window */
  max: number;
  /** Window length in milliseconds */
  windowMs: number;
};

type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number; // Unix ms
};

// =============================================================================
// Upstash Redis client (lazy-loaded)
// =============================================================================

let upstashClient: {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
} | null = null;

function getUpstash(): typeof upstashClient {
  if (upstashClient !== null) return upstashClient;

  // Vercel Marketplace Upstash integration sets KV_* names by default.
  // Standalone Upstash uses UPSTASH_* names. Support both — prefer UPSTASH_*
  // when explicitly set (e.g. local .env.local overrides), fall back to KV_*.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;

  upstashClient = {
    fetch: (path: string, init?: RequestInit) =>
      fetch(`${url}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      }),
  };

  return upstashClient;
}

/**
 * Run one Redis command against the shared Upstash instance.
 *
 * Exported so other features (e.g. the e-learning play lock) can reuse the SAME
 * env-var resolution instead of re-deriving `UPSTASH_*` / `KV_*` in a second
 * place — two copies of that fallback chain is two things to keep in sync, and
 * the one that drifts fails silently by falling back to no-Redis.
 *
 * Returns `null` when Upstash is not configured or the call fails. Callers MUST
 * decide what "no shared store" means for them; this helper deliberately does
 * not pick fail-open or fail-closed on their behalf.
 */
export async function upstashCommand(cmd: string[]): Promise<unknown | null> {
  const client = getUpstash();
  if (!client) return null;
  try {
    const res = await client.fetch("/", {
      method: "POST",
      body: JSON.stringify(cmd),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown };
    return data.result ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// In-memory fallback (legacy behavior)
// =============================================================================

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function rateLimitMemory(args: RateLimitArgs): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(args.key);

  if (!entry || entry.resetAt <= now) {
    memoryStore.set(args.key, { count: 1, resetAt: now + args.windowMs });
    return { success: true, remaining: args.max - 1, resetAt: now + args.windowMs };
  }

  if (entry.count >= args.max) {
    return { success: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    success: true,
    remaining: args.max - entry.count,
    resetAt: entry.resetAt,
  };
}

// =============================================================================
// Upstash implementation (atomic pipeline INCR + EXPIRE NX)
// =============================================================================

async function rateLimitUpstash(args: RateLimitArgs): Promise<RateLimitResult> {
  const client = getUpstash();
  if (!client) return rateLimitMemory(args);

  const windowSec = Math.ceil(args.windowMs / 1000);
  const now = Date.now();

  try {
    // Pipeline: INCR + EXPIRE NX in 1 HTTP roundtrip.
    // EXPIRE with NX flag only sets TTL if the key has no TTL yet,
    // preventing concurrent instances from resetting the window mid-flight.
    const pipelineRes = await client.fetch("/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", args.key],
        ["EXPIRE", args.key, windowSec, "NX"],
      ]),
    });

    if (!pipelineRes.ok) {
      throw new Error(`Upstash pipeline failed: ${pipelineRes.status}`);
    }

    const data = (await pipelineRes.json()) as Array<{ result: number | string }>;
    const count = Number(data[0]?.result ?? 0);

    if (!Number.isFinite(count) || count <= 0) {
      throw new Error(`Upstash returned unexpected count: ${JSON.stringify(data)}`);
    }

    const resetAt = now + windowSec * 1000;

    if (count > args.max) {
      return { success: false, remaining: 0, resetAt };
    }

    return {
      success: true,
      remaining: Math.max(0, args.max - count),
      resetAt,
    };
  } catch (err) {
    console.error("[rate-limit] Upstash error, falling back to memory:", err);
    return rateLimitMemory(args);
  }
}

// =============================================================================
// Public API
// =============================================================================

export async function rateLimit(args: RateLimitArgs): Promise<RateLimitResult> {
  if (getUpstash()) {
    return rateLimitUpstash(args);
  }
  return rateLimitMemory(args);
}

/** Detect best-available implementation — useful for logging at boot. */
export function getRateLimitBackend(): "upstash" | "memory" {
  return getUpstash() ? "upstash" : "memory";
}
