// lib/finance/ghi-danh-don-pham-vi.ts — những GHI DANH nào thuộc một đơn theo PHẠM VI HỌC (đơn SCOPE). Đọc DB, MỘT câu hỏi cho mọi đường hoàn tiền xuất phát từ ghi danh.
//
// ── VÌ SAO KHÔNG GÁC Ở `createRefundRequest` BẰNG `throw` ───────────────────────────────────────────────────────────────
// Ba nơi gọi `createRefundRequest` đều chạy SAU khi đã có phép ghi mà người dùng cần giữ: `nghiHocHan` đã gỡ học viên khỏi lớp, huỷ lớp đã đặt lớp CANCELLED và ghi danh
// WITHDREW. Ném là cuộn ngược cả "Nghỉ học hẳn" / "Huỷ lớp" của mọi lớp có MỘT học viên SCOPE — trái chốt 21/09/2026 ("không chặn cho bé nghỉ"). Nên: đường gọi hỏi hàm này
// TRƯỚC và bỏ qua phần tiền (nói ra), còn `createRefundRequest` là lưới CUỐI (trả `null` + AuditLog, không ném). Cùng khuôn `dongDonDaQuyetToan`.
//
// ── LIÊN KẾT GHI DANH → ĐƠN: HAI ĐƯỜNG, HỢP LẠI (fail-closed) ──────────────────────────────────────────────────────────
//   1. `OrderItem.enrollmentId` — `chuyenDoiDonAction` gán nó khi Chuyển đổi; đây là cầu nối mà dừng học và `dongDonDaQuyetToan` vẫn dùng. Dấu SCOPE nằm trên MỌI dòng của đơn
//      (`laDonPhamVi` = `some`), nên đọc cả `order.items`, không chỉ dòng nối với ghi danh.
//   2. `StudyEntitlement.enrollmentId` — quyền học chỉ được cấp cho đơn SCOPE (`cap-tu-don`: `KHONG_PHAI_DON_PHAM_VI` ⇒ rỗng). Ghi danh có quyền học thì thuộc đơn SCOPE kể cả
//      khi cột ở (1) chưa được gán.
// Một đường thiếu mà đường kia bắt được ⇒ vẫn chặn. Cả hai đều không bắt được ⇒ coi là đơn thường (hành vi cũ) — không đoán.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN } from "@/lib/orders/pham-vi/cong-hoan-tien";
import { laDonPhamVi } from "@/lib/orders/pham-vi/doc-dong";

type Client = Pick<PrismaClient | Prisma.TransactionClient, "orderItem" | "studyEntitlement">;

export type GhiDanhDonPhamVi = {
  /** Dòng đơn nối với ghi danh (có thể `null` khi chỉ tìm ra qua quyền học). */
  orderItemId: string | null;
  orderCode: string | null;
};

/**
 * Trong `enrollmentIds`, ghi danh nào thuộc đơn SCOPE ⇒ trả kèm dòng đơn / mã đơn để NÓI ra. Ghi danh thường KHÔNG có mặt trong Map. BATCH: đúng 2 câu tra bất kể số ghi danh.
 */
export async function ghiDanhThuocDonPhamVi(
  client: Client,
  enrollmentIds: readonly string[],
): Promise<Map<string, GhiDanhDonPhamVi>> {
  const ra = new Map<string, GhiDanhDonPhamVi>();
  if (enrollmentIds.length === 0) return ra;
  const ids = [...new Set(enrollmentIds)];

  const dong = await client.orderItem.findMany({
    where: { enrollmentId: { in: ids } },
    // `metadata` của MỌI dòng trong đơn: thiếu nó thì `laDonPhamVi` đọc `undefined` ⇒ LUÔN false ⇒ cổng chết mà không lỗi nào báo.
    select: { id: true, enrollmentId: true, order: { select: { code: true, items: { select: { metadata: true } } } } },
  });
  for (const d of dong) {
    if (!d.enrollmentId || ra.has(d.enrollmentId)) continue;
    if (laDonPhamVi(d.order?.items ?? [])) ra.set(d.enrollmentId, { orderItemId: d.id, orderCode: d.order?.code ?? null });
  }

  const quyen = await client.studyEntitlement.findMany({
    where: { enrollmentId: { in: ids } },
    select: { enrollmentId: true, orderItemId: true },
  });
  for (const q of quyen) {
    if (!q.enrollmentId || ra.has(q.enrollmentId)) continue;
    ra.set(q.enrollmentId, { orderItemId: q.orderItemId, orderCode: null });
  }
  return ra;
}

/**
 * Lý do chặn đề xuất hoàn cho MỘT ghi danh, hoặc `null` khi không phải đơn SCOPE. Cho action ở tầng `app/` (cấm import `@/lib/db` trần): tra bằng `db` KHÔNG-scope — qua
 * `scopedDb` thì đúng dòng cần chặn có thể bị lọc mất, trả rỗng, và cổng đọc rỗng thành "đơn thường, cho qua" ⇒ mở toang đúng lúc phải đóng (cùng bài học `method-lookup.ts`).
 * Người gọi PHẢI tự kiểm quyền / phạm vi cơ sở của ghi danh trước — hàm này chỉ trả một câu, không lộ dữ liệu nào ngoài câu đó.
 */
export async function lyDoGhiDanhDonPhamVi(enrollmentId: string): Promise<string | null> {
  return (await ghiDanhThuocDonPhamVi(db, [enrollmentId])).has(enrollmentId) ? LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN : null;
}
