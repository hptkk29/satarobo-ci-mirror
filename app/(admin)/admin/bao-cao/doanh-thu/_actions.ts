"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { safeUpdateTag } from "@/lib/cache/safe-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { checkRevenueTargetScope } from "@/lib/reports/revenue-target-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type ActionResult = { ok: boolean; error?: string };

const targetSchema = z.object({
  // "" / "ALL" → null = mục tiêu toàn hệ thống.
  centerId: z
    .string()
    .optional()
    .transform((s) => (!s || s === "" || s === "ALL" ? null : s)),
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Kỳ phải dạng YYYY-MM"),
  targetAmount: z.coerce
    .number()
    .int("Mục tiêu phải là số nguyên")
    .min(0, "Mục tiêu không được âm"),
  note: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : null;
    }),
});

/**
 * Đặt/sửa mục tiêu doanh thu cho (center, period). centerId null = toàn hệ thống.
 * Vì @@unique([centerId, period]) coi NULL là DISTINCT (không match được qua upsert),
 * nhánh global PHẢI findFirst + create/update tay; nhánh có center dùng upsert bình thường.
 */
export async function setRevenueTargetAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // B-01 — quyền RIÊNG cho việc đặt mục tiêu. Trước đây gác bằng quyền thao tác tiền
  // (mở/huỷ/hoàn, cấu hình phương thức thanh toán, hoa hồng) mà Quản lý cơ sở cố ý
  // không có ⇒ đúng người cần dùng lại là người bị chặn.
  if (!(await checkPermission("revenue_targets:manage"))) {
    return { ok: false, error: "Không có quyền đặt mục tiêu doanh thu" };
  }

  const parsed = targetSchema.safeParse({
    centerId: formData.get("centerId") ?? undefined,
    period: formData.get("period") ?? "",
    targetAmount: formData.get("targetAmount") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { centerId, period, targetAmount, note } = parsed.data;

  // Cách ly cơ sở: Quản lý cơ sở chỉ đặt được mục tiêu cho cơ sở MÌNH QUẢN; centerId
  // null (toàn hệ thống) chỉ HO-level/SUPER_ADMIN. Luật nằm ở hàm thuần có test
  // (lib/reports/revenue-target-scope.ts) — quyền `revenue_targets:manage` chỉ trả lời
  // "được đặt mục tiêu", không trả lời "cho cơ sở nào", và `RevenueTarget` ∈ SCOPE_EXEMPT
  // nên `scopedDb` là pass-through, không chặn giúp.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor); // RevenueTarget là SCOPE_EXEMPT → pass-through (thoả R6-F1)
  const scope = checkRevenueTargetScope(actor, centerId);
  if (!scope.ok) return { ok: false, error: scope.error };

  try {
    if (centerId === null) {
      // NULL distinct trong unique index → tự tìm rồi update/create.
      const existing = await sdb.revenueTarget.findFirst({
        where: { centerId: null, period },
        select: { id: true },
      });
      if (existing) {
        await sdb.revenueTarget.update({
          where: { id: existing.id },
          data: { targetAmount, note },
        });
      } else {
        await sdb.revenueTarget.create({
          data: { centerId: null, period, targetAmount, note, createdById: session.user.id },
        });
      }
    } else {
      await sdb.revenueTarget.upsert({
        where: { centerId_period: { centerId, period } },
        update: { targetAmount, note },
        create: { centerId, period, targetAmount, note, createdById: session.user.id },
      });
    }
  } catch {
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được mục tiêu" };
  }

  // B-01 — lưu xong PHẢI thấy số mới ngay. Trang đọc qua `safeCache(..., { tags:
  // [CACHE_TAGS.report], revalidate: 120 })` với khoá gồm actorScopeKey + bộ lọc;
  // `revalidatePath` KHÔNG đụng entry của `unstable_cache` ⇒ trước đây bảng vẫn hiện
  // số cũ tới 2 phút và người dùng bấm Lưu thêm vài lần. Huỷ theo TAG mới đúng chỗ.
  safeUpdateTag(CACHE_TAGS.report);
  // Giữ cả hai cách viết đường dẫn: URL thật của trang là `/admin/bao-cao/doanh-thu`
  // (proxy rewrite từ host admin), bản không tiền tố là dấu vết cũ — vô hại, và trang
  // đang `force-dynamic` nên hai dòng này chỉ là lớp phụ, tag ở trên mới là cái chữa.
  revalidatePath("/bao-cao/doanh-thu");
  revalidatePath("/admin/bao-cao/doanh-thu");
  return { ok: true };
}
