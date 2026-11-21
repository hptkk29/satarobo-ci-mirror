import "server-only";
import { db } from "@/lib/db";

// =============================================================================
// Zalo OA token manager — tự gia hạn access_token (sống ngắn) bằng refresh_token.
//
// Token Zalo OA: access_token hết hạn theo `expires_in`; refresh_token sống ~3
// tháng VÀ XOAY VÒNG mỗi lần refresh (refresh_token cũ chết, phải lưu cái mới).
// → Lưu trạng thái vào IntegrationConfig(provider="ZALO_OA").settings.
//
// Seed lần đầu: lấy refresh_token từ env (ZALO_OA_REFRESH_TOKEN). Sau đó DB là
// nguồn sự thật; env chỉ dùng để mồi + fallback khi DB chưa có.
//
// AUTH-SĐT P4 — refresh có KHOÁ chống đua (pg_advisory_xact_lock): vì
// refresh_token xoay vòng, 2 instance serverless refresh song song = một bên
// persist token rác → OA chết vĩnh viễn, phải OAuth lại tay. Khoá advisory theo
// transaction serialize cả CUỘC GỌI Zalo giữa các instance (chung 1 DB); sau khi
// giành khoá RE-READ trạng thái — instance khác có thể vừa refresh xong.
// Refresh hiếm (cron 6h/lần + on-demand khi gần hạn) nên giữ 1 kết nối pooler
// trong tối đa ~15s là chấp nhận được.
// =============================================================================

const PROVIDER = "ZALO_OA";
const REFRESH_ENDPOINT = "https://oauth.zaloapp.com/v4/oa/access_token";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh sớm 5 phút trước hạn
const FALLBACK_TTL_SEC = 3600; // nếu thiếu expires_in, coi như 1 giờ

export interface ZaloTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

function readStored(settings: unknown): ZaloTokenState | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  if (
    typeof s.accessToken === "string" &&
    typeof s.refreshToken === "string" &&
    typeof s.expiresAt === "number"
  ) {
    return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt };
  }
  return null;
}

async function loadStored(): Promise<ZaloTokenState | null> {
  try {
    const cfg = await db.integrationConfig.findUnique({ where: { provider: PROVIDER } });
    return readStored(cfg?.settings);
  } catch {
    return null;
  }
}

async function persist(state: ZaloTokenState): Promise<void> {
  await db.integrationConfig.upsert({
    where: { provider: PROVIDER },
    update: { isEnabled: true, settings: state as object },
    create: { provider: PROVIDER, isEnabled: true, settings: state as object },
  });
}

/** Gọi endpoint refresh của Zalo — KHÔNG persist (caller lo, trong khoá). */
async function callZaloRefreshApi(
  refreshToken: string,
  now: number,
): Promise<ZaloTokenState | null> {
  const appId = process.env.ZALO_APP_ID;
  const secret = process.env.ZALO_APP_SECRET;
  if (!appId || !secret || !refreshToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(REFRESH_ENDPOINT, {
      method: "POST",
      headers: { secret_key: secret, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        app_id: appId,
        grant_type: "refresh_token",
      }).toString(),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | {
          access_token?: string;
          refresh_token?: string;
          expires_in?: string | number;
          error?: number | string;
          message?: string;
        }
      | null;

    if (!json || !json.access_token || !json.refresh_token) {
      console.warn(`[zalo:token] refresh thất bại: ${json ? JSON.stringify(json) : "no-response"}`);
      return null;
    }

    const expiresInSec =
      typeof json.expires_in === "string" ? parseInt(json.expires_in, 10) : json.expires_in;
    const ttl =
      Number.isFinite(expiresInSec) && (expiresInSec as number) > 0
        ? (expiresInSec as number)
        : FALLBACK_TTL_SEC;

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: now + ttl * 1000,
    };
  } catch (err) {
    console.warn(`[zalo:token] refresh lỗi: ${err instanceof Error ? err.message : "unknown"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh dưới khoá advisory. `force=false` → nếu sau khi giành khoá thấy token
 * còn hạn (instance khác vừa refresh) thì DÙNG LUÔN, không xoay thêm.
 *
 * Đường cứu khi Zalo ĐÃ xoay mà commit DB thất bại: persist lại NGOÀI
 * transaction; vẫn hỏng → refresh_token mới mất, token cũ đã chết ⇒ log
 * ❌ MẤT TOKEN + làm theo runbook `docs/otp-service.md` §Runbook.
 */
async function refreshLocked(opts: {
  now: number;
  seedRefreshToken: string | null;
  force: boolean;
}): Promise<ZaloTokenState | null> {
  let rotated: ZaloTokenState | null = null;
  try {
    return await db.$transaction(
      async (tx) => {
        // ⚠️ PHẢI là $executeRaw, KHÔNG phải $queryRaw: `pg_advisory_xact_lock()`
        // trả kiểu `void`, Prisma $queryRaw cố giải mã cột đó và ném "Failed to
        // deserialize column of type 'void'" ⇒ mọi lần refresh token đều chết
        // (đã xảy ra thật trên prod 31/07). $executeRaw không đọc cột nên an toàn.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zalo_oa_token'))`;
        const cfg = await tx.integrationConfig.findUnique({ where: { provider: PROVIDER } });
        const stored = readStored(cfg?.settings);

        // RE-READ sau khoá: còn hạn + không ép xoay → dùng của instance kia.
        if (!opts.force && stored && stored.expiresAt - EXPIRY_BUFFER_MS > opts.now) {
          return stored;
        }

        // Ưu tiên refresh_token ĐÃ LƯU (bản mới nhất sau xoay vòng); seed/env chỉ mồi lần đầu.
        const refreshToken = stored?.refreshToken || opts.seedRefreshToken;
        if (!refreshToken) return null;

        const fresh = await callZaloRefreshApi(refreshToken, opts.now);
        if (!fresh) return null;
        rotated = fresh; // từ đây Zalo đã xoay — BẮT BUỘC persist được

        await tx.integrationConfig.upsert({
          where: { provider: PROVIDER },
          update: { isEnabled: true, settings: fresh as object },
          create: { provider: PROVIDER, isEnabled: true, settings: fresh as object },
        });
        return fresh;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  } catch (err) {
    if (rotated) {
      console.error(
        "[zalo:token] ❌ Zalo ĐÃ XOAY refresh_token nhưng ghi DB trong transaction thất bại — thử cứu bằng persist trực tiếp…",
      );
      try {
        await persist(rotated);
        console.error("[zalo:token] ✅ Đã cứu được token (persist ngoài transaction).");
        return rotated;
      } catch {
        console.error(
          "[zalo:token] ❌❌ MẤT REFRESH TOKEN: token mới không lưu được mà token cũ đã bị Zalo vô hiệu. " +
            "OA sẽ ngừng gửi ZNS khi access_token hiện tại hết hạn. Làm theo runbook docs/otp-service.md §Runbook " +
            "(OAuth lại OA lấy refresh_token mới → cập nhật env ZALO_OA_REFRESH_TOKEN → xoá row IntegrationConfig ZALO_OA → redeploy).",
        );
      }
    } else {
      console.warn(
        `[zalo:token] refresh (locked) lỗi: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
    return null;
  }
}

/**
 * Gọi refresh với refresh_token cho trước (mồi lần đầu / test), có khoá chống
 * đua. Dưới khoá, bản refresh_token ĐÃ LƯU trong DB (nếu có) được ưu tiên hơn
 * tham số — tham số chỉ là seed.
 */
export async function refreshZaloToken(
  refreshToken: string,
  now: number = Date.now(),
): Promise<ZaloTokenState | null> {
  return refreshLocked({ now, seedRefreshToken: refreshToken, force: true });
}

/**
 * Trả access_token còn hạn; tự refresh khi gần hết hạn. null nếu không cấu hình
 * được (không có token tĩnh lẫn refresh creds).
 */
export async function getValidZaloAccessToken(now: number = Date.now()): Promise<string | null> {
  const stored = await loadStored();

  // Còn hạn (trừ buffer) → dùng luôn, không gọi mạng.
  if (stored && stored.expiresAt - EXPIRY_BUFFER_MS > now) {
    return stored.accessToken;
  }

  // Cần refresh — force=false: instance khác vừa refresh xong thì dùng luôn.
  const refreshed = await refreshLocked({
    now,
    seedRefreshToken: process.env.ZALO_OA_REFRESH_TOKEN ?? null,
    force: false,
  });
  if (refreshed) return refreshed.accessToken;

  // Fallback cuối: token đã lưu / token tĩnh env (có thể đã hết hạn).
  return stored?.accessToken || process.env.ZALO_OA_ACCESS_TOKEN || null;
}

/**
 * Buộc refresh ngay (cron keep-alive + retry khi gặp lỗi auth). Trả
 * access_token mới, null nếu refresh không thực hiện được.
 */
export async function forceRefreshZaloToken(now: number = Date.now()): Promise<string | null> {
  const refreshed = await refreshLocked({
    now,
    seedRefreshToken: process.env.ZALO_OA_REFRESH_TOKEN ?? null,
    force: true,
  });
  return refreshed?.accessToken ?? null;
}
