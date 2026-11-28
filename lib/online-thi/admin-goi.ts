import { NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/response";
import { runAction, type ActionConfig } from "@/lib/actions/factory";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * CỔNG HTTP CHO ROUTE ADMIN CỦA BÀI THI ONLINE (V8.45): EX-01 cấp bù lỗi hệ thống · duyệt/từ chối bồi hoàn · EX-02 thu hồi (giữ bài làm) / cấp lại · lịch sử gián đoạn.
 * KHÔNG chép luật: mỗi route chạy ĐÚNG `ActionConfig` của E (`lib/elearning-online/actions.ts`) qua `runAction` — zod strict, `can()`, lý do bắt buộc, AuditLog.
 * Thêm LỚP RBAC theo cờ (`checkPermission`: prod = v2 động, local = v1) TRƯỚC `runAction` (vốn luôn dùng can() v2): thiếu một trong hai ⇒ 403. Phiên Auth.js (cookie), KHÔNG phải token di động —
 * học viên/phụ huynh không bao giờ gọi được các route này.
 */
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** Mã lỗi nghiệp vụ của lõi E (gian-doan-db / quyen-hoc-db) → HTTP (đề xuất §5c của E). Mã lạ ⇒ 422 (lỗi của yêu cầu, không phải của máy chủ). */
export const HTTP_LOI_ADMIN_ONLINE_THI: Record<string, number> = {
  AUTH: 401,
  VALIDATION: 400,
  PERMISSION_DENIED: 403,
  LUOT_KHONG_TON_TAI: 404,
  KHONG_TON_TAI: 404,
  HOC_VIEN_KHONG_TON_TAI: 404,
  KHOA_KHONG_TON_TAI: 404,
  LY_DO_QUA_NGAN: 422,
  THIEU_BANG_CHUNG: 422,
  QUYET_KHONG_HOP_LE: 422,
  KHOA_IDEMPOTENCY_KHONG_HOP_LE: 422,
  LUOT_DANG_LAM: 409,
  LUOT_DA_GIAN_DOAN_DO_THU_HOI: 409,
  KHONG_CHO_XEM_XET: 409,
  CHUA_CO_QUYEN: 409,
  DA_THU_HOI: 409,
  DA_TRON_DOI: 409,
  KHOA_KHONG_CHO_GIA_HAN: 409,
  CHUA_CO_QUYEN_DE_GIA_HAN: 409,
};

/**
 * Thứ tự: phiên (401) → quyền (403) → ĐỌC thân (400) → `runAction` (zod strict của E, can() v2, lý do, audit). Phiên/quyền kiểm TRƯỚC khi đọc thân: người chưa đăng nhập luôn nhận 401 dù thân sai.
 * `dung` đổi thân JSON (hoặc `null` với GET) thành `{ input, lyDo }`; `lyDo` đi vào `meta.reason` cho action bắt buộc lý do (cấp/thu hồi quyền).
 */
export async function chayAdminOnlineThi<I, T>(
  cfg: ActionConfig<I, T>,
  req: Request,
  dung: (than: Record<string, unknown> | null) => { input: unknown; lyDo?: string | null },
  coThan = true,
): Promise<NextResponse> {
  const s = await auth();
  const u = s?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  if (!u?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập.", { status: 401, headers: KHONG_LUU });
  if (!(await checkPermission(cfg.permission))) return fail("FORBIDDEN", "Không có quyền.", { status: 403, headers: KHONG_LUU });
  let than: Record<string, unknown> | null = null;
  if (coThan) {
    try {
      const raw = (await req.json()) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not-object");
      than = raw as Record<string, unknown>;
    } catch {
      return fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU });
    }
  }
  const { input, lyDo } = dung(than);
  const actor = await resolveActor(u.id);
  const { res } = await runAction(cfg, actor, input, { actorName: u.name ?? u.email ?? u.id, reason: lyDo ?? null });
  if (res.ok) return ok(res.data, { headers: KHONG_LUU });
  return fail(res.error.code, res.error.message, { status: HTTP_LOI_ADMIN_ONLINE_THI[res.error.code] ?? 422, headers: KHONG_LUU, ...(res.error.field ? { field: res.error.field } : {}) });
}
