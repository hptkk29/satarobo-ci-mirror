/**
 * R6-A — Service cấu hình 2 tầng (DB + cache + audit + guard quyền).
 *
 * - getSetting(key, { orgUnitId? }) → resolve Center → Global → default (cache TTL 300s).
 * - setGlobalSetting(actor, …) → chỉ SUPER_ADMIN (US-R6A-1 AC1).
 * - setCenterSetting(actor, …) → CENTER_MANAGER của cơ sở đó / SUPER_ADMIN (AC2),
 *   chỉ cho key centerOverridable.
 * Mọi mutation: validate (AC4) + reason bắt buộc + ghi AuditLog (AC3) + clear cache.
 */
import { safeCache, safeUpdateTag } from "@/lib/cache/safe-cache";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
  getSettingDef,
  validateSettingValue,
  SETTINGS,
  type SettingKey,
  type SettingDef,
} from "./registry";
import { kiemGiaTriTheoDb } from "./kiem-theo-db";
import { duocSuaKhoaCuaCoSo, laQuanLyCoSo } from "./quyen-co-so";
import { resolveSettingValue } from "./resolve";

/** Kiểu giá trị resolve được cho mỗi key (suy từ default trong registry). */
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

// ── Cache (REQ-12) ─────────────────────────────────────────────────────────
// safeCache = unstable_cache cross-request/instance + invalidate qua tag (thay Map
// per-process cũ — clearSettingsCache trước chỉ xoá 1 instance serverless → instance
// khác stale ≤300s). safeCache fallback gọi thẳng khi ngoài request context (test/script)
// → không ném incrementalCache. Cache GIÁ TRỊ ĐÃ RESOLVE (JSON) để tránh serialize Date.
const getResolvedSettingCached = safeCache(
  async (key: string, orgUnitId: string | null): Promise<unknown> => {
    const def = getSettingDef(key) as SettingDef | undefined;
    if (!def) throw new Error(`Unknown setting key: ${key}`);
    const [centerRow, globalRow] = await Promise.all([
      orgUnitId && def.centerOverridable
        ? db.centerSetting.findUnique({ where: { orgUnitId_key: { orgUnitId, key } } })
        : Promise.resolve(null),
      db.systemSetting.findUnique({ where: { key } }),
    ]);
    return resolveSettingValue({ def, centerRow, globalRow });
  },
  ["setting-resolve"],
  // ⚠️ 300 GIÂY, không phải 60 — hai chú thích ở đầu file này từng ghi "60s" và cả hai ĐỀU SAI
  // (sửa 18/09/2026). Con số này là thứ quyết định **bao lâu một cờ mới ăn**: sửa `SystemSetting`
  // / `CenterSetting` bằng SQL tay thì KHÔNG xoá cache, nên hiệu lực trễ tới 5 PHÚT. Với một cờ
  // tiền đang pilot thì đó là 5 phút sale vẫn bấm được sau khi ai đó tưởng đã tắt.
  // Đường đi qua `setCenterSetting` thì xoá cache ngay + ghi AuditLog — dùng nó khi có giao diện.
  // Runbook: `docs/runbook-bat-thu-linh-hoat-cs2.md`.
  { tags: [CACHE_TAGS.settings], revalidate: 300 },
);

/** Xoá cache settings (sau mutation + cho test) — invalidate tag toàn hệ thống. */
export function clearSettingsCache(): void {
  safeUpdateTag(CACHE_TAGS.settings);
}

// ── Đọc ───────────────────────────────────────────────────────────────────
/**
 * Lấy giá trị 1 setting. `orgUnitId` = OrgUnit.id của cơ sở (để xét override);
 * bỏ trống = chỉ Global → default.
 */
export async function getSetting<K extends SettingKey>(
  key: K,
  opts?: { orgUnitId?: string | null },
): Promise<SettingValue<K>> {
  const def = getSettingDef(key) as SettingDef | undefined;
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  const orgUnitId = opts?.orgUnitId ?? null;
  return (await getResolvedSettingCached(key, orgUnitId)) as never;
}

/** Lấy nhiều key cùng lúc (cho trang admin). */
export async function getResolvedSettings(
  keys: SettingKey[],
  orgUnitId?: string | null,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await getSetting(k, { orgUnitId })] as const),
  );
  return Object.fromEntries(entries);
}

// ── Ghi ────────────────────────────────────────────────────────────────────
export type SetResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string; field?: string } };

function fail(code: string, message: string, field?: string): SetResult {
  return { ok: false, error: { code, message, field } };
}


/** SUPER_ADMIN sửa GLOBAL. */
export async function setGlobalSetting(
  actor: Actor,
  params: { key: string; value: unknown; reason: string; actorName: string },
): Promise<SetResult> {
  if (!actor.isSuperAdmin) {
    return fail("FORBIDDEN", "Chỉ SUPER_ADMIN được sửa cấu hình toàn hệ thống");
  }
  // Khoá CHỈ ghi qua action riêng có cổng DB (`hoaHong.kyCutover` → `datMocCutover`): từ chối TRƯỚC mọi phép ghi. [PR5c · 05 §2.2c]
  if (getSettingDef(params.key)?.ghiQuaActionRieng) {
    return fail("VALIDATION", "Khoá này chỉ đặt được bằng thao tác riêng có kiểm soát, không sửa ở đây", params.key);
  }
  if (!params.reason?.trim()) {
    return fail("VALIDATION", "Lý do thay đổi là bắt buộc", "reason");
  }
  const v = validateSettingValue(params.key, params.value);
  if (!v.ok) return fail("VALIDATION", v.error, params.key);
  // Phép kiểm cần ĐỌC DB (Zod ở registry là thuần): vd nguồn mặc định của nhân sự giới thiệu phải là nguồn có thật, chọn được, kiểu nhân sự. Trước phép ghi đầu tiên.
  const loiDb = await kiemGiaTriTheoDb(params.key, v.value, new Date());
  if (loiDb) return fail("VALIDATION", loiDb, params.key);

  const old = await db.systemSetting.findUnique({ where: { key: params.key } });
  await db.systemSetting.upsert({
    where: { key: params.key },
    create: {
      key: params.key,
      valueJson: v.value as never,
      updatedById: actor.userId,
      updatedByName: params.actorName,
    },
    update: {
      valueJson: v.value as never,
      updatedById: actor.userId,
      updatedByName: params.actorName,
    },
  });
  await writeAudit({
    actor: { id: actor.userId, name: params.actorName },
    module: "settings",
    entityType: "SystemSetting",
    entityId: params.key,
    action: old ? "UPDATE" : "CREATE",
    oldValues: old ? { value: old.valueJson } : null,
    newValues: { value: v.value },
    reason: params.reason,
  });
  clearSettingsCache();
  return { ok: true };
}

/** CENTER_MANAGER của cơ sở (hoặc SUPER_ADMIN) override theo cơ sở. */
export async function setCenterSetting(
  actor: Actor,
  params: { orgUnitId: string; key: string; value: unknown; reason: string; actorName: string },
): Promise<SetResult> {
  // Phép kiểm ở `lib/settings/quyen-co-so.ts` — MỘT bản, dùng chung với màn Cấu hình vận
  // hành (nó phải bày đúng những cơ sở người ta sửa được). Trước 24/09 điều kiện này chép
  // tay ở hai hàm dưới đây, và màn hình thì không có bản nào ⇒ nó bày MỌI cơ sở.
  if (!laQuanLyCoSo(actor, params.orgUnitId)) {
    return fail("FORBIDDEN", "Không có quyền sửa cấu hình cơ sở này");
  }
  const def = getSettingDef(params.key);
  if (!def) return fail("VALIDATION", `Key cấu hình không hợp lệ: ${params.key}`, params.key);
  if (def.ghiQuaActionRieng) {
    return fail("VALIDATION", "Khoá này chỉ đặt được bằng thao tác riêng có kiểm soát, không sửa ở đây", params.key);
  }
  if (!def.centerOverridable) {
    return fail("VALIDATION", "Key này chỉ cấu hình ở cấp toàn hệ thống", params.key);
  }
  // Vế THỨ HAI: đúng cơ sở chưa đủ, còn phải đúng KHOÁ. Xem `duocSuaKhoaCuaCoSo`.
  if (!duocSuaKhoaCuaCoSo(actor, def)) {
    return fail(
      "FORBIDDEN",
      "Tham số này do quản trị hệ thống đặt, cấp cơ sở không sửa được",
      params.key,
    );
  }
  if (!params.reason?.trim()) {
    return fail("VALIDATION", "Lý do thay đổi là bắt buộc", "reason");
  }
  const v = validateSettingValue(params.key, params.value);
  if (!v.ok) return fail("VALIDATION", v.error, params.key);

  const old = await db.centerSetting.findUnique({
    where: { orgUnitId_key: { orgUnitId: params.orgUnitId, key: params.key } },
  });
  await db.centerSetting.upsert({
    where: { orgUnitId_key: { orgUnitId: params.orgUnitId, key: params.key } },
    create: {
      orgUnitId: params.orgUnitId,
      key: params.key,
      valueJson: v.value as never,
      updatedById: actor.userId,
      updatedByName: params.actorName,
    },
    update: {
      valueJson: v.value as never,
      updatedById: actor.userId,
      updatedByName: params.actorName,
    },
  });
  await writeAudit({
    actor: { id: actor.userId, name: params.actorName },
    module: "settings",
    entityType: "CenterSetting",
    entityId: `${params.orgUnitId}:${params.key}`,
    action: old ? "UPDATE" : "CREATE",
    oldValues: old ? { value: old.valueJson } : null,
    newValues: { value: v.value },
    reason: params.reason,
    orgUnitId: params.orgUnitId,
  });
  clearSettingsCache();
  return { ok: true };
}

/**
 * GỠ override của một cơ sở ⇒ cơ sở ấy quay về THEO TOÀN HỆ. [PHIÊN H · 22/09/2026]
 *
 * ⚠️ Vì sao cần một hàm riêng chứ không "ghi giá trị rỗng": ba trạng thái của một cơ sở là
 * **theo toàn hệ** (không có dòng) · **bật riêng** (dòng `true`) · **tắt riêng** (dòng
 * `false`). Chúng là BA, không phải hai — và trạng thái thứ nhất chỉ diễn đạt được bằng
 * việc KHÔNG có dòng. Không có đường gỡ thì một cơ sở lỡ cài riêng sẽ mắc kẹt ở đó mãi:
 * quản trị đổi mức toàn hệ mà cơ sở ấy không đổi theo, và không ai hiểu vì sao.
 *
 * ⚠️ Gỡ KHÔNG PHẢI "tắt". Tắt riêng là một quyết định (`false` ghi vào sổ, có lý do, có
 * nhật ký); gỡ là rút lại quyết định ấy. Gộp hai thứ vào một nút là người vận hành tưởng
 * mình vừa tắt trong khi thật ra vừa trả cơ sở về theo mức toàn hệ — mà mức toàn hệ có thể
 * đang BẬT.
 *
 * Cùng cổng quyền, cùng đòi lý do, cùng ghi `AuditLog`, cùng xoá cache như `setCenterSetting`.
 */
export async function clearCenterSetting(
  actor: Actor,
  params: { orgUnitId: string; key: string; reason: string; actorName: string },
): Promise<SetResult> {
  // Phép kiểm ở `lib/settings/quyen-co-so.ts` — MỘT bản, dùng chung với màn Cấu hình vận
  // hành (nó phải bày đúng những cơ sở người ta sửa được). Trước 24/09 điều kiện này chép
  // tay ở hai hàm dưới đây, và màn hình thì không có bản nào ⇒ nó bày MỌI cơ sở.
  if (!laQuanLyCoSo(actor, params.orgUnitId)) {
    return fail("FORBIDDEN", "Không có quyền sửa cấu hình cơ sở này");
  }
  if (getSettingDef(params.key)?.ghiQuaActionRieng) {
    return fail("VALIDATION", "Khoá này chỉ đặt được bằng thao tác riêng có kiểm soát, không sửa ở đây", params.key);
  }
  // ⚠️ GỠ mức riêng CŨNG LÀ SỬA cấu hình của cơ sở đó — chỉ khác chiều. Thiếu vế này thì
  // cấp cơ sở không đặt được `billing.siblingPercentSecond` nhưng vẫn XOÁ được mức riêng
  // mà quản trị đã đặt cho cơ sở mình, tức vẫn đổi được con số đang chạy. Đây đúng cái
  // bẫy "vá một hàm quên hàm kia" mà `[QCS-03]` sinh ra để canh.
  {
    const def = getSettingDef(params.key);
    if (def && !duocSuaKhoaCuaCoSo(actor, def)) {
      return fail(
        "FORBIDDEN",
        "Tham số này do quản trị hệ thống đặt, cấp cơ sở không gỡ được",
        params.key,
      );
    }
  }
  if (!params.reason?.trim()) {
    return fail("VALIDATION", "Lý do thay đổi là bắt buộc", "reason");
  }

  const old = await db.centerSetting.findUnique({
    where: { orgUnitId_key: { orgUnitId: params.orgUnitId, key: params.key } },
  });
  // Không có gì để gỡ ⇒ coi là XONG, không phải lỗi. Hai người cùng bấm thì người sau
  // không được nhận một câu lỗi cho một trạng thái đã đúng ý họ.
  if (!old) return { ok: true };

  await db.centerSetting.delete({
    where: { orgUnitId_key: { orgUnitId: params.orgUnitId, key: params.key } },
  });
  await writeAudit({
    actor: { id: actor.userId, name: params.actorName },
    module: "settings",
    entityType: "CenterSetting",
    entityId: `${params.orgUnitId}:${params.key}`,
    action: "DELETE",
    oldValues: { value: old.valueJson },
    newValues: null,
    reason: params.reason,
    orgUnitId: params.orgUnitId,
  });
  clearSettingsCache();
  return { ok: true };
}
