// lib/finance/hoa-don/quyen-sua-nguoi-mua.ts — AI ĐƯỢC SỬA khối «Người mua trên hoá đơn» của một đơn (chủ dự án chốt 06/11/2026).
//
// Ba luật, MỘT nơi quyết định (trang đơn dựng nút + hành động Lưu cùng gọi — hai nơi tự chép là có ngày nút nói một đằng, máy chủ trả lời một nẻo, luật 12):
//   1. Đơn ĐÃ XUẤT hoá đơn ⇒ KHÔNG AI sửa được, kể cả Quản trị tối cao (nút biến mất; hành động từ chối). Muốn đổi sau khi xuất thì đi đường huỷ / thay thế của kế toán.
//   2. Người có `orders:manage` (kế toán Hội sở, quản lý cơ sở, kế toán cơ sở, Quản trị tối cao) ⇒ sửa được mọi đơn trong PHẠM VI CƠ SỞ của họ (phạm vi do `scopedDb` + `passesScope`
//      ở nơi gọi — Quản trị tối cao không bị giới hạn cơ sở).
//   3. Người chỉ có `orders:edit-invoice-buyer` (vai «Tư vấn & CSKH cơ sở») ⇒ CHỈ đơn do CHÍNH MÌNH TẠO (`Order.createdById`). Đơn không ghi người tạo (đơn cũ, đơn nhập tay) ⇒ không sửa.
//
// «ĐÃ XUẤT» là gì: có ít nhất một hoá đơn của đơn ở một trong các trạng thái dưới đây. LOI_PHAT_HANH (nhà cung cấp từ chối, CHƯA có hoá đơn) và THAY_THE (đã huỷ) KHÔNG khoá —
// sửa người mua rồi «Phát hành lại» chính là cách gỡ lỗi từ chối; khoá chúng là chặn đường sửa lỗi.

import "server-only";
import type { HoaDonTrangThai } from "@prisma/client";
import { db } from "@/lib/db";
import { LY_DO_DA_XUAT_NGOAI } from "./ly-do-khong-xuat";

/** Trạng thái hoá đơn làm đơn thành «đã xuất». NHAP = đã tải tệp, kế toán đang xử lý; DANG_PHAT_HANH = đang gửi nhà cung cấp; DA_XAC_NHAN = đã chốt. */
export const TRANG_THAI_DA_XUAT: readonly HoaDonTrangThai[] = ["NHAP", "DANG_PHAT_HANH", "DA_XAC_NHAN"];

export type HoaDonDeXet = { trangThai: HoaDonTrangThai; lyDo: string | null };

/** Một hoá đơn có tính là «đã xuất» không. `KHONG_XUAT` chỉ tính khi lý do là «đã xuất ngoài hệ thống» (khách ĐÃ có hoá đơn ở nơi khác). */
export function laHoaDonDaXuat(h: HoaDonDeXet): boolean {
  if (TRANG_THAI_DA_XUAT.includes(h.trangThai)) return true;
  return h.trangThai === "KHONG_XUAT" && h.lyDo === LY_DO_DA_XUAT_NGOAI;
}

export function donDaXuatHoaDon(hoaDon: readonly HoaDonDeXet[]): boolean {
  return hoaDon.some(laHoaDonDaXuat);
}

export type LyDoKhongSua = "DA_XUAT_HOA_DON" | "KHONG_CO_QUYEN" | "KHONG_PHAI_DON_CUA_MINH";

export type DauVaoQuyenSua = {
  /** `orders:manage`. */
  coQuyenQuanLy: boolean;
  /** `orders:edit-invoice-buyer`. */
  coQuyenHep: boolean;
  /** `session.user.id`. */
  nguoiDungId: string;
  /** `Order.createdById` — `null` với đơn cũ / đơn không ghi người tạo. */
  nguoiTaoDonId: string | null;
  /** `donDaXuatHoaDon(...)` trên các hoá đơn của ĐƠN. */
  daXuatHoaDon: boolean;
};

export type KetQuaQuyenSua = { duoc: true } | { duoc: false; lyDo: LyDoKhongSua };

export function quyenSuaNguoiMua(i: DauVaoQuyenSua): KetQuaQuyenSua {
  // Luật 1 đứng TRƯỚC mọi luật về người: đã xuất thì không ai sửa, kể cả người có toàn quyền.
  if (i.daXuatHoaDon) return { duoc: false, lyDo: "DA_XUAT_HOA_DON" };
  if (i.coQuyenQuanLy) return { duoc: true };
  if (!i.coQuyenHep) return { duoc: false, lyDo: "KHONG_CO_QUYEN" };
  // `null === null` không bao giờ được coi là «đơn của mình»: người dùng luôn có id, đơn thiếu người tạo thì loại.
  return i.nguoiTaoDonId !== null && i.nguoiTaoDonId === i.nguoiDungId ? { duoc: true } : { duoc: false, lyDo: "KHONG_PHAI_DON_CUA_MINH" };
}

/** Câu tiếng Việt cho hành động Lưu khi bị từ chối (nút đã ẩn, nên đây là lớp thứ hai). */
export const CAU_KHONG_SUA_NGUOI_MUA: Record<LyDoKhongSua, string> = {
  DA_XUAT_HOA_DON: "Đơn đã xuất hoá đơn — không sửa người mua được nữa. Cần đổi thì nhờ kế toán huỷ / thay thế hoá đơn.",
  KHONG_CO_QUYEN: "Bạn không có quyền sửa người mua trên hoá đơn.",
  KHONG_PHAI_DON_CUA_MINH: "Bạn chỉ sửa được người mua trên hoá đơn của đơn do chính bạn tạo.",
};

/**
 * Phần đọc DB của `donDaXuatHoaDon`. ⚠️ ĐỌC TRỰC TIẾP (không qua `scopedDb`): đây là cổng KHOÁ. Qua `scopedDb`, một vai không thấy hoá đơn của cơ sở (vd. «Tư vấn & CSKH» không có quyền
 * `payments:*`) sẽ nhận danh sách RỖNG ⇒ «chưa xuất» ⇒ MỞ nút sửa trên đơn đã có hoá đơn — cổng khoá mở toang đúng lúc phải đóng. Người gọi PHẢI đã kiểm đơn thuộc phạm vi của actor.
 */
export async function docDonDaXuatHoaDon(orderId: string): Promise<boolean> {
  const ds = await db.hoaDonDienTu.findMany({ where: { orderId }, select: { trangThai: true, lyDo: true } });
  return donDaXuatHoaDon(ds);
}
