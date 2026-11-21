// lib/entitlements/hang-doi/ghi-dong.ts — THI HÀNH một lời khuyên vòng đời (`HanhDongCho`) lên dòng `StudyEntitlementXuLy`. DB, CHỈ nhận `tx`.
//
// Cùng bốn việc (tạo mới / mở lại / đổi lý do / đóng) mà `cap-tu-don.ts` và `xep-lop-tu-don.ts` đang tự viết trong closure của mình. Hai nơi cũ KHÔNG đổi
// (lưới `[QHC-W14]` đếm từng phép ghi của chúng); đây là bản cho các dòng do HÀNG ĐỢI sở hữu: LECH_DU_LIEU (cron) và TREO_DUYET_TAY do người đánh dấu.
//
// QUY TẮC KHOÁ (lưới `[HD-W*]` canh): người gọi PHẢI đã giữ `khoaDonTrongTx(tx, orderId)` TRƯỚC khi gọi — cap-tu-don / xep-lop-tu-don đọc-quyết-ghi các dòng này
// dưới đúng khoá đó; một lần chèn không khoá trên cùng (orderItemId, loai) có thể P2002 làm hỏng cả transaction của một lượt hích tiền. `orgUnitId` do người gọi
// tính TRƯỚC transaction (không có `db.` trong tx — [DVU-PIN-07]). Mọi dòng MỚI mang centerId + orgUnitId tường minh ([QHC-W14b]: scopedDb không che write).
import type { Prisma } from "@prisma/client";
import type { HanhDongCho } from "../cho-chuyen-doi";
import type { LoaiHangDoi } from "./loai";

export interface NguCanhGhi {
  readonly orderId: string;
  readonly orderItemId: string;
  readonly courseId: string | null;
  readonly leadChildId: string | null;
  readonly studentId: string | null;
  readonly entitlementId: string | null;
  readonly centerId: string;
  readonly orgUnitId: string | null;
}

export type KetQuaThiHanh = "KHONG_DOI" | "TAO" | "MO_LAI" | "DOI_LY_DO" | "DONG_DA_XU_LY" | "DONG_HUY";

/**
 * @param hienCo  dòng hiện có (đọc DƯỚI KHOÁ bằng `tx`); `null` nếu chưa có.
 * @param payload payload ghi kèm khi TẠO / MỞ LẠI / ĐỔI LÝ DO (thay thế hẳn — gỡ luôn khối quyết định cũ của người nếu có). Đóng bởi máy KHÔNG đụng payload.
 */
export async function thiHanhHanhDongCho(
  tx: Prisma.TransactionClient,
  loai: LoaiHangDoi,
  viec: HanhDongCho,
  hienCo: { readonly id: string } | null,
  nc: NguCanhGhi,
  payload: Prisma.InputJsonValue | undefined,
  now: Date,
): Promise<KetQuaThiHanh> {
  if (viec.viec === "KHONG_LAM_GI") return "KHONG_DOI";
  if (viec.viec === "TAO_MOI") {
    await tx.studyEntitlementXuLy.create({
      data: {
        loai,
        trangThai: "OPEN",
        orderId: nc.orderId,
        orderItemId: nc.orderItemId,
        courseId: nc.courseId,
        leadChildId: nc.leadChildId,
        studentId: nc.studentId,
        entitlementId: nc.entitlementId,
        centerId: nc.centerId,
        orgUnitId: nc.orgUnitId,
        lyDo: viec.lyDo,
        payload,
      },
    });
    return "TAO";
  }
  if (!hienCo) return "KHONG_DOI"; // các việc còn lại đều cần dòng hiện có (hàm thuần bảo đảm); chặn kiểu cho tsc
  if (viec.viec === "MO_LAI") {
    await tx.studyEntitlementXuLy.update({
      where: { id: hienCo.id },
      data: { trangThai: "OPEN", lyDo: viec.lyDo, resolvedAt: null, resolvedNote: null, studentId: nc.studentId, entitlementId: nc.entitlementId, payload },
    });
    return "MO_LAI";
  }
  if (viec.viec === "CAP_NHAT_LY_DO") {
    await tx.studyEntitlementXuLy.update({ where: { id: hienCo.id }, data: { lyDo: viec.lyDo, payload } });
    return "DOI_LY_DO";
  }
  await tx.studyEntitlementXuLy.update({
    where: { id: hienCo.id },
    data: { trangThai: viec.trangThai, resolvedAt: now, resolvedNote: viec.lyDo, studentId: nc.studentId, entitlementId: nc.entitlementId },
  });
  return viec.trangThai === "DA_XU_LY" ? "DONG_DA_XU_LY" : "DONG_HUY";
}
