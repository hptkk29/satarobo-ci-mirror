/**
 * FL2-01 — Convert v2 + học phí 1 đợt / 2 đợt. AC theo BA #07 US-LEAD-1.
 *
 * ⚠️ SPEC PHÁC (không nằm trong CI run mặc định của lane) — tài liệu hoá AC + 1 assert
 * runnable cho phần "nối recordInstallmentPlan" (tái dùng lib sẵn có). Phần convert UI
 * đầy đủ (lead REGISTERED + payment RECORDED + order + class) để fixme khi dựng fixture.
 *
 * Postgres LOCAL (.env.test) — KHÔNG trỏ Supabase.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { computeInstallmentSplit } from "../../../lib/crm/convert-lead-v2";
import {
  recordInstallmentPlan,
  getOrderInstallments,
  markInstallmentPaid,
} from "../../../lib/orders/installments";

let seq = 0;
async function makeCourseOrder(total: number) {
  seq += 1;
  return db.order.create({
    data: {
      code: `ORD-FL2-${seq}`,
      type: "COURSE",
      customerName: "PH FL2",
      customerPhone: "0900000001",
      totalAmount: total,
      status: "PENDING_PAYMENT",
    },
  });
}

test.describe("[FL2-01] Convert v2 — học phí 1/2 đợt", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  // AC3 — chọn 2 đợt → convert NỐI recordInstallmentPlan: dot1 đã thu (PAID), dot2 hẹn
  // (PENDING). dot2 = total - dot1 (computeInstallmentSplit) nên luôn khớp ràng buộc.
  test("[FL2-01-T1] 2 đợt: dot1 đã thu + dot2 hẹn ngày, tổng khớp order", async () => {
    const order = await makeCourseOrder(10_000_000);
    const { dot1, dot2 } = computeInstallmentSplit(order.totalAmount, 6_000_000);
    const res = await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: dot1,
      dot2Amount: dot2,
      dot2DueDate: new Date("2026-08-01"),
      actorId: "sale-1",
    });
    expect(res.ok).toBe(true);

    const insts = await getOrderInstallments(order.id);
    expect(insts).toHaveLength(2);
    expect(insts[0]!.status).toBe("PAID");
    expect(insts[1]!.status).toBe("PENDING");
    expect(insts[0]!.amount + insts[1]!.amount).toBe(order.totalAmount);
  });

  // S5 — kế hoạch 2 đợt: đợt1 ghi Payment ngay. (Vế "plan mặc định PENDING_APPROVAL"
  // của C4 đã GỠ 14/09/2026 cùng cơ chế duyệt đơn hàng — chú thích nói ngược mã là gài
  // bẫy cho người đọc sau.)
  //
  // ⚠️ ĐẢO 13/09/2026 — tên cũ của ca này là "đợt2 cần CENTER_MANAGER duyệt mới ghi
  // Payment". Luật đó đã bị chủ dự án đảo: giữ nó nghĩa là khách quét QR đóng đợt 2 thì
  // Ledger-B đánh PAID còn Ledger-A bỏ qua ⇒ **công nợ hiển thị KHÔNG GIẢM dù tiền đã vào
  // tài khoản**. Xem `lib/payments/installment-plan.ts` + mục tương ứng trong CLAUDE.md.
  //
  // Cổng chống lách duyệt KHÔNG mất — nó chuyển sang đường TỰ CHỐT ĐƠN
  // (`confirmSettledOrder`, `payos-ingest`), chứ không nằm ở đường nhận tiền nữa.
  // Ca này nay khoá đúng luật MỚI: đóng đợt 2 là ghi Payment ngay, không chờ duyệt;
  // và cổng QUYỀN duyệt (non-manager bị chặn) vẫn nguyên.
  test("[SPINE-S5] đóng đợt2 ghi Payment NGAY (Ledger-A khớp Ledger-B)", async () => {
    const order = await makeCourseOrder(10_000_000);
    const { dot1, dot2 } = computeInstallmentSplit(order.totalAmount, 6_000_000);
    await recordInstallmentPlan({
      orderId: order.id,
      dot1Amount: dot1,
      dot2Amount: dot2,
      dot2DueDate: new Date("2026-08-01"),
      actorId: "sale-1",
    });

    // ⚠️ ĐẢO 14/09/2026 — trước đây kỳ vọng `PENDING_APPROVAL`. Cơ chế duyệt đơn hàng
    // đã bỏ theo chốt của chủ dự án; lưu kế hoạch không còn sinh cờ chờ duyệt.
    // Phần đáng giá của ca này KHÔNG mất: nó vẫn khoá "đợt 1 đã thu ghi ĐÚNG 1 Payment",
    // và bên dưới vẫn khoá "đóng đợt 2 ghi Payment NGAY" — luật đảo 13/09.
    const ord1 = await db.order.findUnique({ where: { id: order.id }, select: { installmentApprovalStatus: true } });
    expect(ord1?.installmentApprovalStatus).toBeNull();
    expect(await db.payment.count({ where: { orderId: order.id, saleStatus: "RECORDED" } })).toBe(1);

    // Đóng đợt2 khi CHƯA duyệt → đánh dấu PAID (Ledger-B) VÀ ghi Payment (Ledger-A).
    // Trước đảo 13/09 chỗ này kỳ vọng 1 (bị gate chặn); nay là 2.
    const insts = await getOrderInstallments(order.id);
    const dot2Inst = insts.find((i) => i.soDot === 2)!;
    await markInstallmentPaid(dot2Inst.id, "sale-1");
    expect(await db.payment.count({ where: { orderId: order.id, saleStatus: "RECORDED" } })).toBe(2);

    // ⚠️ ĐÃ CẮT 14/09/2026 — phần cuối ca này vốn kiểm "non-manager duyệt bị chặn" và
    // "CENTER_MANAGER duyệt → APPROVED". Cơ chế duyệt đơn hàng đã bỏ theo chốt của chủ
    // dự án, nên `approveInstallmentPlan` không còn gọi được trên đơn mới: nó đòi
    // `installmentApprovalStatus != null`, mà đường sinh cờ đó đã gỡ.
    //
    // Hai hàm approve/reject VẪN GIỮ cho DỮ LIỆU CŨ (`applyInstallmentApproval` là đường
    // ghi bù Ledger-A duy nhất cho đơn sinh dưới luật cũ) và được khoá ở
    // `tests/e2e/r7/payment-request-lifecycle.spec.ts` ca [PR-06], nơi cờ được đặt thủ
    // công để mô phỏng đơn cũ. Không mất lưới.
    //
    // Phần ĐÁNG GIÁ của ca này nằm ở trên và giữ nguyên: đợt 1 ghi ĐÚNG 1 Payment, và
    // đóng đợt 2 ghi Payment NGAY (luật đảo 13/09) — tổng đúng 2.
  });

  // AC3 — 1 đợt (full): convert KHÔNG ghi installment (giữ flow hiện tại). Kiểm chứng:
  // computeInstallmentSplit với dot1 = total → dot2 = 0.
  test("[FL2-01-T2] 1 đợt (full): dot2 = 0", async () => {
    const order = await makeCourseOrder(8_000_000);
    const { dot1, dot2 } = computeInstallmentSplit(order.totalAmount, order.totalAmount);
    expect(dot1).toBe(8_000_000);
    expect(dot2).toBe(0);
  });

  // AC1/AC2/AC4 — luồng UI đầy đủ: nút "chuyển đã đăng ký" ngoài Lead → /leads/{id}
  // (KHÔNG popup) → convert v2 đa con + chọn 2 đợt → enrollment + installment; giữ guard
  // payment-required, dedupe phụ huynh, idempotency, consent media.
  test.fixme("[FL2-01-T3] UI: kanban → /leads/{id} → convert 2 con + 2 đợt", async () => {
    // TODO(fixture): seed lead REGISTERED + order COURSE + payment RECORDED + class OPEN.
    // 1) /leads?view=kanban → bấm "Chuyển Đã đăng ký" → URL = /leads/{id} (no dialog).
    // 2) mở /leads/{id}/convert → thêm 2 con → chọn "Chia 2 đợt" + nhập dot1 + dueDate.
    // 3) submit → 2 enrollment + Order có 2 OrderInstallment (PAID/PENDING).
    // 4) double-submit cùng payload → idempotent (không nhân đôi).
  });
});
