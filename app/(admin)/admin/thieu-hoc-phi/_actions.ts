"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import {
  createBackfillOrderPaymentInTx,
  themKhoanVaoDonBackfillInTx,
} from "@/lib/crm/backfill-order";
import { getAuditActor } from "@/lib/audit/log";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";

/**
 * Ghi học phí CŨ cho học viên đã chốt nhưng CHƯA PHÁT SINH ĐƠN HÀNG.
 *
 * Nhóm này sinh ra từ nhánh `allowNoPayment` của `lib/crm/bulk-convert.ts`: chốt lead
 * hàng loạt mà không nhập tiền thì hệ thống CỐ Ý không bịa khoản thu — nên các em có
 * `Enrollment` nhưng không có `Order`/`Payment`, và học phí không nằm trong sổ nào.
 *
 * DÙNG LẠI `createBackfillOrderPaymentInTx` — cùng hàm mà màn import dùng. Không viết
 * đường tạo đơn thứ hai. Nó idempotent theo lead ⇒ bấm hai lần không sinh hai đơn.
 *
 * ⚠️ GIÁ NIÊM YẾT VÀ SỐ ĐÃ THU LÀ HAI SỐ KHÁC NHAU, và đó là cả lý do màn này tồn tại.
 * Dữ liệu cũ có đủ kiểu: thu đủ, thu một phần (cọc / trả góp), và có giảm giá. Nếu chỉ
 * nhận MỘT con số thì mọi dòng thành "thu đủ, không nợ" — tức **xoá sạch công nợ cũ**.
 * Cùng bài học với `lib/lead/import-fee-plan.ts` (đo trên file thật 04/08: suy chênh
 * thành giảm giá làm mất ~30 triệu tiền phải đòi).
 *
 * Khoản tạo ra để `accountantStatus: PENDING` như mọi khoản backfill khác ⇒ muốn vào
 * doanh thu thì xác nhận hàng loạt ở `/payments`. Cố ý KHÔNG tự xác nhận ở đây: đó là
 * đường ghi `CONFIRMED` thứ hai.
 */
const schema = z.object({
  leadId: z.string().min(1),
  /**
   * Chế độ GHI THÊM — id đơn ĐÃ CÓ để nhận khoản mới.
   *
   * Có `orderId` ⇒ khoản vào đơn đó và MỌI ô giá bị bỏ qua: đơn đã có tiền rót vào thì
   * `totalAmount` là số đã báo phụ huynh, đổi nó ở một lượt "ghi thêm tiền" là sửa số
   * phải thu sau lưng khách. Muốn đổi giá thì là lượt điều chỉnh riêng.
   */
  orderId: z.string().min(1).nullish(),
  /** Loại đơn — khớp `OrderType` của Prisma. */
  orderType: z.enum(["COURSE", "PACKAGE", "EXAM", "PRODUCT", "COMBO"]).default("COURSE"),
  /** Giá NIÊM YẾT trước giảm. Đây là gốc để suy công nợ. */
  listPrice: z.number().int().nonnegative(),
  /** Chính sách giảm giá — bỏ trống = không giảm. */
  discountType: z.enum(["AMOUNT", "PERCENT", "SCHOLARSHIP", "PROGRAM"]).nullish(),
  discountValue: z.number().nonnegative().nullish(),
  discountReason: z.string().max(300).nullish(),
  /** Số tiền THỰC ĐÃ THU (có thể nhỏ hơn tổng phải đóng ⇒ còn nợ). */
  amount: z.number().int().positive("Số tiền đã thu phải lớn hơn 0"),
  paidDate: z.string().min(1),
  itemName: z.string().min(1, "Nhập nội dung dòng đơn").max(200),
  note: z.string().max(500).nullish(),
});

export type GhiHocPhiInput = z.input<typeof schema>;

export async function ghiHocPhiBackfillAction(input: unknown) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cùng cổng với màn ghi nhận khoản thu — đây là hành vi GHI TIỀN.
  if (!(await checkPermission("payments:record"))) {
    return { ok: false as const, error: "Không có quyền ghi nhận khoản thu" };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // scopedDb auto-scope READ; vẫn tự gác vì đây là đường GHI (Lead ∈ SCOPED_MODELS).
  const lead = await sdb.lead.findUnique({
    where: { id: d.leadId },
    select: { id: true, centerId: true, parentName: true, phone: true, email: true },
  });
  if (!lead || !passesScope("Lead", lead, actor)) {
    return { ok: false as const, error: "Không tìm thấy lead trong phạm vi của bạn" };
  }

  const ngay = new Date(d.paidDate);
  if (Number.isNaN(ngay.getTime())) {
    return { ok: false as const, error: "Ngày đóng không hợp lệ" };
  }

  // ── CHẾ ĐỘ GHI THÊM ──────────────────────────────────────────────────────────
  // "Học phí thiếu sao lại khoá luôn?" — đúng, thiếu thì phải ghi tiếp. Đường này ghi
  // khoản mới vào ĐƠN CŨ; trần và mọi phép chặn nằm trong
  // `themKhoanVaoDonBackfillInTx` (một nhà, không chép luật ra action).
  if (d.orderId) {
    const don = await sdb.order.findUnique({
      where: { id: d.orderId },
      select: { id: true, leadId: true, centerId: true, deletedAt: true },
    });
    if (!don || don.deletedAt || !passesScope("Order", don, actor)) {
      return { ok: false as const, error: "Không tìm thấy đơn trong phạm vi của bạn" };
    }
    // Đơn phải THUỘC lead đang mở. Thiếu vế này là gửi `orderId` của lead khác lên và
    // ghi tiền vào đơn của người khác — `passesScope` không chặn được vì hai lead có
    // thể cùng một cơ sở.
    if (don.leadId !== lead.id) {
      return { ok: false as const, error: "Đơn này không thuộc phụ huynh đang chọn" };
    }

    const auditActorGhiThem = getAuditActor(session);
    const kq = await sdb.$transaction((txRaw) =>
      themKhoanVaoDonBackfillInTx(txRaw as unknown as Prisma.TransactionClient, {
        actor: { id: auditActorGhiThem.actorId, name: auditActorGhiThem.actorName },
        orderId: don.id,
        amount: d.amount,
        paidDate: ngay,
        note: d.note?.trim() || null,
      }),
    );
    if (!kq.ok) return { ok: false as const, error: kq.error };

    revalidatePath("/thieu-hoc-phi");
    revalidatePath("/payments");
    revalidatePath("/cong-no");
    revalidatePath(`/orders/${don.id}`);
    revalidatePath(`/leads/${d.leadId}`);
    return { ok: true as const, paymentId: kq.paymentId, ghiThem: true as const };
  }

  // Giảm giá tính bằng ĐÚNG `computeEnrollmentPrice` mà toàn hệ dùng — không tự nhân %
  // ở đây, kẻo màn này ra một con số khác màn chốt lead.
  const gia = computeEnrollmentPrice({
    listPrice: d.listPrice,
    discount:
      d.discountType && d.discountValue != null
        ? { type: d.discountType, value: d.discountValue }
        : null,
  });

  if (d.amount > gia.finalPrice) {
    return {
      ok: false as const,
      error:
        `Đã thu (${d.amount.toLocaleString("vi-VN")}đ) lớn hơn tổng phải đóng ` +
        `(${gia.finalPrice.toLocaleString("vi-VN")}đ). Kiểm lại giá niêm yết hoặc mức giảm.`,
    };
  }

  const auditActor = getAuditActor(session);
  // tx từ scopedDb (ESLint R6-F1 chặn `@/lib/db` trần trong admin). Cast vì extended
  // client không structurally-assignable vào `Prisma.TransactionClient` — tiền lệ
  // `orders/_actions.ts:360-361`.
  const res = await sdb.$transaction((txRaw) =>
    createBackfillOrderPaymentInTx(txRaw as unknown as Prisma.TransactionClient, {
      actor: { id: auditActor.actorId, name: auditActor.actorName },
      lead,
      paid: {
        amount: d.amount,
        paidDate: ngay,
        note: d.note?.trim() || null,
        items: [{ itemName: d.itemName.trim(), unitPrice: d.listPrice }],
        // Giảm giá ghi lên ĐƠN ⇒ `totalAmount = listPrice − discount`, và công nợ =
        // totalAmount − đã thu. Đây là thứ giữ lại được khoản còn nợ của dữ liệu cũ.
        discountAmount: gia.discountAmount,
        discountReason: d.discountReason?.trim() || null,
      },
    }),
  );

  if (!res.created) {
    return {
      ok: false as const,
      error: res.paymentId
        ? "Lead này đã có khoản nhập liệu ban đầu — không tạo thêm đơn thứ hai"
        : "Số tiền không hợp lệ",
    };
  }

  revalidatePath("/thieu-hoc-phi");
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  revalidatePath(`/leads/${d.leadId}`);
  return {
    ok: true as const,
    paymentId: res.paymentId,
    tongPhaiDong: gia.finalPrice,
    conThieu: Math.max(0, gia.finalPrice - d.amount),
  };
}
