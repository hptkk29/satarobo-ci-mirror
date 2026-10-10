"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";

/**
 * SỬA HỌC PHÍ HỢP ĐỒNG của một ghi danh (`Enrollment.finalPrice`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CẦN — và vì sao đến hôm nay mới có
 *
 * Chủ dự án 14/09/2026: "tôi cần 1 thứ để merge lại cái nào đã đóng full cái nào thiếu,
 * phải làm rõ ràng để tôi nhập liệu lại số liệu cũ 1 cách chính xác."
 *
 * Sau lượt nhập 796.455.000đ từ sheet, TỬ SỐ (đã đóng) là có thật. Thứ sai là MẪU SỐ:
 * `Enrollment.finalPrice` chỉ được ghi ở đúng hai chỗ — `convert-lead-v2.ts` và
 * `bulk-convert.ts`, cả hai đều ghi MỘT LẦN lúc chốt lead — và **không có đường sửa nào
 * sau đó** (`grep finalPrice:` toàn repo: 0 lời gọi `update`). Ghi danh chốt hàng loạt
 * qua nhánh `allowNoPayment` thì `finalPrice` còn có thể là `null`, và khi đó `/cong-no`
 * lọc bỏ luôn ⇒ em đã đóng tiền mà không ai nợ ai trong sổ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ĐÂY LÀ ĐƯỜNG SỬA SỐ PHỤ HUYNH ĐANG NHÌN THẤY
 *
 * `lib/portal/billing-student.ts` và `lib/finance/debt.ts` đều lấy `finalPrice` làm số
 * phải đóng. Sửa cột này là đổi ngay công nợ hiện trên cổng phụ huynh — nên:
 *   · BẮT BUỘC có lý do (không cho sửa lặng lẽ);
 *   · ghi `AuditLog` kèm giá trị CŨ và MỚI, trong CÙNG transaction — "có sửa là có log",
 *     không nửa vời;
 *   · tự gác `passesScope` vì `scopedDb` chỉ auto-scope đường ĐỌC.
 *
 * ⚠️ CỐ Ý KHÔNG đụng `listPrice`/`discountAmount`. Ba cột đó là snapshot giá lúc chốt
 * lead; sửa `finalPrice` mà đổi luôn hai cột kia là viết lại lịch sử giảm giá của một
 * giao dịch đã xảy ra. Ở đây chỉ chỉnh CON SỐ PHẢI ĐÓNG, và nói rõ lý do.
 *
 * ⚠️ CŨNG KHÔNG đụng `Order.totalAmount` hay bất kỳ `PaymentRequest` nào. Chủ dự án đã
 * chốt "KHÔNG sửa `amountDue` của phiếu đã có allocation — VOID + tạo phiếu mới"; đường
 * này không được lách luật đó bằng cửa sau.
 */
const schema = z.object({
  enrollmentId: z.string().min(1),
  /** Học phí hợp đồng mới, VND. `0` KHÔNG được phép — xem chú thích dưới. */
  hocPhi: z.number().int().positive("Học phí phải lớn hơn 0"),
  lyDo: z.string().trim().min(5, "Nhập lý do sửa (tối thiểu 5 ký tự)").max(500),
});

export type SuaHocPhiInput = z.input<typeof schema>;

export async function suaHocPhiGhiDanhAction(input: unknown) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // `enrollments:edit` — đúng ngữ nghĩa (sửa hồ sơ ghi danh), và là quyền mà Quản lý cơ
  // sở + Hội sở đang giữ. KHÔNG dùng `payments:record`: đây không phải ghi tiền, và gác
  // nhầm cổng là cho người nhập tiền tự sửa luôn số phải đóng.
  if (!(await checkPermission("enrollments:edit"))) {
    return { ok: false as const, error: "Không có quyền sửa ghi danh" };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const au = getAuditActor(session);

  // `Enrollment` NẰM trong SCOPED_MODELS (FL-R2 W5), nhưng đây là đường GHI nên vẫn tự
  // gác: `scopedDb` chỉ auto-scope các method ĐỌC.
  const gd = await sdb.enrollment.findUnique({
    where: { id: d.enrollmentId },
    select: {
      id: true,
      centerId: true,
      deletedAt: true,
      finalPrice: true,
      listPrice: true,
      tuition: true,
      student: { select: { id: true, name: true } },
      course: { select: { name: true } },
    },
  });
  if (!gd || gd.deletedAt || !passesScope("Enrollment", gd, actor)) {
    return { ok: false as const, error: "Không tìm thấy ghi danh trong phạm vi của bạn" };
  }

  const cu = gd.finalPrice;
  if (cu === d.hocPhi) {
    return { ok: false as const, error: "Học phí không đổi" };
  }

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.enrollment.update({
      where: { id: gd.id },
      data: { finalPrice: d.hocPhi },
    });
    // CÙNG transaction: có sửa là có log. Ghi cả giá trị CŨ — không có nó thì log chỉ nói
    // "ai đó đặt 8.640.000đ", và không ai dựng lại được chuyện gì đã xảy ra.
    await writeAudit({
      actor: { id: au.actorId, name: au.actorName },
      module: "finance",
      entityType: "Enrollment",
      entityId: gd.id,
      action: "UPDATE",
      oldValues: { finalPrice: cu },
      newValues: {
        finalPrice: d.hocPhi,
        lyDo: d.lyDo,
        nguon: "doi-soat-hoc-phi",
        hocVien: gd.student?.name ?? null,
        khoa: gd.course?.name ?? null,
        // Ghi kèm để người soát sau thấy ngay có phải "chưa chốt giá" không mà không
        // phải mở thêm bảng nào.
        chuaChotGiaTruocDo: cu == null,
      },
      orgUnitId: gd.centerId,
      tx,
    });
  });

  revalidatePath("/cong-no");
  revalidatePath("/thieu-hoc-phi");
  if (gd.student?.id) revalidatePath(`/students/${gd.student.id}`);
  return { ok: true as const, hocPhiCu: cu, hocPhiMoi: d.hocPhi };
}
