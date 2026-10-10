import { unstable_cache, updateTag } from "next/cache";

/**
 * `unstable_cache` AN TOÀN ngoài request/render context của Next.
 *
 * `unstable_cache` chỉ chạy khi có `incrementalCache` trong async context (SSR/RSC của
 * một request thật). Khi gọi TRỰC TIẾP ngoài context — e2e service-level (Playwright gọi
 * `resolveActor`/`getSetting` thẳng trên DB), script, cron chạy tay — Next ném
 * `Invariant: incrementalCache missing in unstable_cache`.
 *
 * Wrapper này thử cache, nếu gặp đúng lỗi thiếu-context thì FALLBACK gọi `fn` trực tiếp
 * (không cache, dữ liệu tươi — đúng ý test). Prod/dev có context → cache như thường.
 * Lỗi khác vẫn ném lên bình thường.
 */
export function safeCache<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[],
  opts: { tags?: string[]; revalidate?: number | false },
): (...args: A) => Promise<R> {
  const cached = unstable_cache(fn, keyParts, opts);
  return async (...args: A): Promise<R> => {
    try {
      return await cached(...args);
    } catch (err) {
      if (err instanceof Error && err.message.includes("incrementalCache")) {
        // Ngoài request context (test/script) → chạy thẳng, không cache.
        return fn(...args);
      }
      throw err;
    }
  };
}

/**
 * `updateTag` AN TOÀN. Next 16: `updateTag` CHỈ chạy trong Server Action (read-your-own-
 * writes). Trong Route Handler / test / script / cron gọi tay → ném lỗi. Wrapper này thử
 * invalidate ngay (khi ở Server Action), nếu ngoài context thì BỎ QUA — invalidation là
 * best-effort, TTL của cache là backstop làm mới. Lỗi khác vẫn ném lên.
 */
export function safeUpdateTag(tag: string): void {
  try {
    updateTag(tag);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Server Action|incrementalCache|request (store|scope)|outside a request/i.test(msg)) {
      return;
    }
    throw err;
  }
}
