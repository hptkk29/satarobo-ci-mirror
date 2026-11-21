// lib/enrollments/gan-quyen-hoc-ghi-danh-tay.ts — GHI DANH TAY CÓ GẮN QUYỀN HỌC (số buổi đã mua).
//
// Chủ dự án 21/10/2026: *"ghi danh học viên bằng tay có gắn quyền học đi là xong"*. Trước đó `enrollStudent` tạo ghi danh mà KHÔNG nối vào số buổi
// phụ huynh đã mua: ghi danh không dấu ⇒ `buoiBatDau` NULL = "học đủ khoá" (fail-open), quyền học cứ AWAITING_PLACEMENT mãi trong hàng đợi.
//
// CÙNG ĐƯỜNG VỚI BƯỚC CHUYỂN ĐỔI, không dựng đường thứ hai: bước Chuyển đổi nối quyền học bằng cách ghi `OrderItem.enrollmentId`
// (xem `chuyenDoiDonAction`), rồi `hichCapQuyenHocChoDon` → `xetXepLopChoDon` chốt bài bắt đầu / bài bỏ qua / học vượt. Ở đây cũng vậy:
// tìm quyền học CHỜ XẾP của học viên (cùng khoá, chưa có ghi danh), nối dòng đơn của nó vào ghi danh vừa tạo, rồi người gọi hích SAU commit.
//
// KHÔNG ĐOÁN: 0 quyền chờ ⇒ ghi danh như cũ (học viên chưa mua theo phạm vi); từ 2 quyền chờ cùng khoá trở lên ⇒ KHÔNG nối (nối nhầm đơn là xếp sai
// số buổi), quyền học ở lại hàng đợi để người có `entitlements:manage` chọn.
import "server-only";
import type { Prisma } from "@prisma/client";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";

export type KetQuaGanQuyenHocTay =
  | { kieu: "KHONG_CO" }
  | { kieu: "DA_GAN"; orderId: string; orderItemId: string; quyenHocId: string }
  | { kieu: "MO_HO"; soQuyen: number };

export async function ganGhiDanhTayVaoQuyenHoc(
  tx: Prisma.TransactionClient,
  vao: { studentId: string; courseId: string; enrollmentId: string },
): Promise<KetQuaGanQuyenHocTay> {
  const cho = await tx.studyEntitlement.findMany({
    where: { studentId: vao.studentId, courseId: vao.courseId, status: "AWAITING_PLACEMENT", enrollmentId: null },
    select: { id: true, orderId: true, orderItemId: true },
  });
  if (cho.length === 0) return { kieu: "KHONG_CO" };
  const q = cho[0];
  if (cho.length > 1 || !q || !q.orderId || !q.orderItemId) return { kieu: "MO_HO", soQuyen: cho.length };
  // Phép ghi CÓ ĐIỀU KIỆN: dòng đã gắn ghi danh khác (bước Chuyển đổi chạy trước / người khác vừa nối) ⇒ đổi 0 dòng, không ghi đè.
  const n = await tx.orderItem.updateMany({ where: { id: q.orderItemId, enrollmentId: null }, data: { enrollmentId: vao.enrollmentId } });
  if (n.count === 0) return { kieu: "MO_HO", soQuyen: 1 };
  return { kieu: "DA_GAN", orderId: q.orderId, orderItemId: q.orderItemId, quyenHocId: q.id };
}

/**
 * SAU commit: vừa nối được dòng đơn ⇒ hích cho quyền học chốt phạm vi bài (vỏ KHÔNG NÉM). Nguồn `CHUYEN_DOI` — cùng ý nghĩa "khách vừa có ghi danh".
 * `now` BẮT BUỘC (luật 7 + luật 19).
 */
export async function hichSauGhiDanhTay(kq: KetQuaGanQuyenHocTay, now: Date): Promise<void> {
  if (kq.kieu === "DA_GAN") await hichCapQuyenHocChoDon(kq.orderId, "CHUYEN_DOI", now);
}
