"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { safeUpdateTag } from "@/lib/cache/safe-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { leadTargetInputSchema } from "@/lib/reports/lead-target";
import { checkRevenueTargetScope } from "@/lib/reports/revenue-target-scope";
import { revalidatePath } from "next/cache";

type ActionResult = { ok: boolean; error?: string };

/**
 * C-01 — đặt/sửa chỉ tiêu LEAD (SỐ HỌC SINH) cho (cơ sở, kỳ). centerId null = toàn hệ thống.
 *
 * Chép khuôn `setRevenueTargetAction` (bảng song sinh) và giữ nguyên hai điểm gãy đã biết:
 *  · `@@unique([centerId, period])` với `centerId` nullable — Postgres coi NULL là DISTINCT
 *    nên `upsert` KHÔNG match nhánh toàn hệ thống; nhánh đó phải `findFirst` + create/update
 *    tay, nếu không mỗi lần lưu là đẻ thêm một dòng "toàn hệ thống" của cùng một kỳ.
 *  · Trang đọc qua `safeCache(... tags: [CACHE_TAGS.report])`, mà `revalidatePath` KHÔNG
 *    đụng entry của `unstable_cache` ⇒ phải huỷ theo TAG, nếu không lưu xong bảng vẫn hiện
 *    số cũ tới hết TTL và người dùng bấm Lưu thêm vài lần.
 */
export async function setLeadTargetAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Quyền RIÊNG (chốt 24/08/2026 · OQ-C5). KHÔNG dùng lại `leads:assign-config`: key đó
  // gác màn "Cấu hình chia lead tự động", cấp nó để đổi lấy một ô nhập số là trao nhầm.
  if (!(await checkPermission("lead_targets:manage"))) {
    return { ok: false, error: "Không có quyền đặt chỉ tiêu lead" };
  }

  const parsed = leadTargetInputSchema.safeParse({
    centerId: formData.get("centerId") ?? undefined,
    period: formData.get("period") ?? "",
    // Ép về chuỗi rồi để schema tự kiểm: schema CỐ Ý không dùng `z.coerce.number()`
    // (Number("") = 0 ⇒ bấm Lưu khi chưa gõ gì sẽ ghi đè chỉ tiêu cũ về 0, im lặng).
    targetCount: String(formData.get("targetCount") ?? ""),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { centerId, period, targetCount, note } = parsed.data;

  // Cách ly cơ sở: QLCS chỉ đặt được chỉ tiêu cho cơ sở MÌNH QUẢN; centerId null (toàn hệ
  // thống) chỉ cấp hội sở/quản trị. Luật nằm ở hàm thuần có test — quyền
  // `lead_targets:manage` chỉ trả lời "được đặt chỉ tiêu", KHÔNG trả lời "cho cơ sở nào",
  // và `LeadTarget` ∈ SCOPE_EXEMPT nên `scopedDb` là pass-through, không chặn giúp.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor); // LeadTarget là SCOPE_EXEMPT → pass-through
  const scope = checkRevenueTargetScope(actor, centerId);
  if (!scope.ok) return { ok: false, error: scope.error };

  try {
    if (centerId === null) {
      // NULL distinct trong unique index → tự tìm rồi update/create.
      const existing = await sdb.leadTarget.findFirst({
        where: { centerId: null, period },
        select: { id: true },
      });
      if (existing) {
        await sdb.leadTarget.update({
          where: { id: existing.id },
          data: { targetCount, note },
        });
      } else {
        await sdb.leadTarget.create({
          data: { centerId: null, period, targetCount, note, createdById: session.user.id },
        });
      }
    } else {
      // `orgUnitId` do `lib/org/dual-write.ts` tự lấp khi centerId có giá trị — code mới
      // KHÔNG tự gọi `orgUnitIdForCenter()` (quyết định 24/08 · B1).
      await sdb.leadTarget.upsert({
        where: { centerId_period: { centerId, period } },
        update: { targetCount, note },
        create: { centerId, period, targetCount, note, createdById: session.user.id },
      });
    }
  } catch {
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được chỉ tiêu" };
  }

  safeUpdateTag(CACHE_TAGS.report);
  // Giữ cả hai cách viết đường dẫn: URL thật là `/admin/bao-cao/muc-tieu-lead` (proxy
  // rewrite từ host admin), bản không tiền tố là dấu vết cũ — vô hại. Tag ở trên mới là
  // cái chữa; trang đang `force-dynamic` nên hai dòng này chỉ là lớp phụ.
  revalidatePath("/bao-cao/muc-tieu-lead");
  revalidatePath("/admin/bao-cao/muc-tieu-lead");
  return { ok: true };
}
