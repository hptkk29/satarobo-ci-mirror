"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { safeUpdateTag } from "@/lib/cache/safe-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { adsBudgetTargetInputSchema } from "@/lib/reports/ads-budget-target";
import { checkRevenueTargetScope } from "@/lib/reports/revenue-target-scope";
import { revalidatePath } from "next/cache";

type ActionResult = { ok: boolean; error?: string };

/**
 * D-02 — đặt/sửa chỉ tiêu NGÂN SÁCH QUẢNG CÁO cho (cơ sở, kỳ). centerId null = toàn hệ thống.
 *
 * Bảng chỉ tiêu thứ ba, cùng khuôn `setRevenueTargetAction` (B-01) và
 * `setLeadTargetAction` (C-01), và giữ nguyên ba điểm gãy đã biết:
 *  · `@@unique([centerId, period])` với `centerId` nullable — Postgres coi NULL là DISTINCT
 *    nên `upsert` KHÔNG match nhánh toàn hệ thống; nhánh đó phải `findFirst` + create/update
 *    tay, nếu không mỗi lần lưu là đẻ thêm một dòng "toàn hệ thống" của cùng một kỳ.
 *  · Trang đọc qua `safeCache(... tags: [CACHE_TAGS.report])`, mà `revalidatePath` KHÔNG
 *    đụng entry của `unstable_cache` ⇒ phải huỷ theo TAG, nếu không lưu xong bảng vẫn hiện
 *    số cũ tới hết TTL và người dùng bấm Lưu thêm vài lần.
 *  · Quyền chỉ trả lời "được đặt chỉ tiêu", KHÔNG trả lời "cho CƠ SỞ NÀO" — và
 *    `AdsBudgetTarget` ∈ SCOPE_EXEMPT nên `scopedDb` là pass-through, không chặn giúp.
 *
 * Ranh giới của D-02: hàm này KHÔNG đụng số chi tiêu thật (D-01) và KHÔNG gán campaign
 * về cơ sở (D-07). Nó chỉ ghi con số người ta ĐẶT RA.
 */
export async function setAdsBudgetTargetAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Quyền RIÊNG, đúng tiền lệ `revenue_targets:manage` + `lead_targets:manage`.
  // KHÔNG mượn `leads:view-all` (đang gác màn phễu marketing) và KHÔNG gọi `canEditAds`
  // (so roleCode bằng tay — vi phạm luật Nền Hệ thống #1, đã ghi nợ ở OQ-D5).
  if (!(await checkPermission("ads_budget_targets:manage"))) {
    return { ok: false, error: "Không có quyền đặt chỉ tiêu ngân sách quảng cáo" };
  }

  const parsed = adsBudgetTargetInputSchema.safeParse({
    centerId: formData.get("centerId") ?? undefined,
    period: formData.get("period") ?? "",
    // Ép về chuỗi rồi để schema tự kiểm: schema CỐ Ý không dùng `z.coerce.number()`
    // (Number("") = 0 ⇒ bấm Lưu khi chưa gõ gì sẽ ghi đè chỉ tiêu cũ về 0, im lặng).
    targetAmount: String(formData.get("targetAmount") ?? ""),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { centerId, period, targetAmount, note } = parsed.data;

  // Cách ly cơ sở: vai cấp cơ sở chỉ đặt được chỉ tiêu cho cơ sở MÌNH QUẢN; centerId null
  // (toàn hệ thống) chỉ cấp hội sở/quản trị. Luật nằm ở hàm thuần có test, dùng chung với
  // B-01/C-01 — ba màn chỉ tiêu không được có ba cách hiểu "cơ sở nào".
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor); // AdsBudgetTarget là SCOPE_EXEMPT → pass-through
  const scope = checkRevenueTargetScope(actor, centerId);
  if (!scope.ok) return { ok: false, error: scope.error };

  try {
    if (centerId === null) {
      // NULL distinct trong unique index → tự tìm rồi update/create.
      const existing = await sdb.adsBudgetTarget.findFirst({
        where: { centerId: null, period },
        select: { id: true },
      });
      if (existing) {
        await sdb.adsBudgetTarget.update({
          where: { id: existing.id },
          data: { targetAmount, note },
        });
      } else {
        await sdb.adsBudgetTarget.create({
          data: { centerId: null, period, targetAmount, note, createdById: session.user.id },
        });
      }
    } else {
      // `orgUnitId` do `lib/org/dual-write.ts` tự lấp khi centerId có giá trị — code mới
      // KHÔNG tự gọi `orgUnitIdForCenter()` (quyết định 24/08 · B1).
      await sdb.adsBudgetTarget.upsert({
        where: { centerId_period: { centerId, period } },
        update: { targetAmount, note },
        create: { centerId, period, targetAmount, note, createdById: session.user.id },
      });
    }
  } catch {
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được chỉ tiêu ngân sách" };
  }

  safeUpdateTag(CACHE_TAGS.report);
  // Giữ cả hai cách viết đường dẫn: URL thật là `/admin/bao-cao/ngan-sach-quang-cao`
  // (proxy rewrite từ host admin), bản không tiền tố là dấu vết cũ — vô hại. Tag ở trên
  // mới là cái chữa; trang đang `force-dynamic` nên hai dòng này chỉ là lớp phụ.
  revalidatePath("/bao-cao/ngan-sach-quang-cao");
  revalidatePath("/admin/bao-cao/ngan-sach-quang-cao");
  return { ok: true };
}
