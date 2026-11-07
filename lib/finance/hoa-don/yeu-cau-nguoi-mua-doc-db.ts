import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { docCauHinhTuXuat } from "./feature";
import { gioTuXuat } from "./tu-xuat-sau-gio/chon-lan-thu";
import { daHetHan, duocXuLyYeuCau, phamViXuLyYeuCau, type TrangThaiYeuCau } from "./yeu-cau-nguoi-mua";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db.ts — ĐỌC trạng thái mã QR thông tin người mua của một đơn cho màn đơn hàng (Invoice Hub S11). Chỉ đọc.
//
// [03/11/2026 — chủ dự án: gộp hai thẻ người mua] Phụ huynh gửi xong là dữ liệu vào ĐƠN ngay (xem `yeu-cau-nguoi-mua-db.ts`), nên màn đơn đọc các ô từ ĐƠN (thẻ «Người mua trên hoá đơn», đã che theo
// `orders:view-pii`), còn hàm này chỉ trả TRẠNG THÁI của mã — KHÔNG trả ô nào của `duLieuGui` (bỏ luôn việc che ô ở đây: không có PII nào đi qua). Thêm:
//  · `phDaNhap`: phụ huynh ĐÃ TỪNG gửi (bất kỳ yêu cầu nào của đơn, kể cả đã đóng/thu hồi — dữ liệu họ gửi đã nằm trên đơn) ⇒ nút ở đầu thẻ là «Sửa», chưa từng ⇒ «Nhập thay PH»;
//  · `tuXuatLuc`: giờ hệ thống sẽ tự xuất hoá đơn (lần gửi cuối + n giờ) khi công tắc tự xuất bật và yêu cầu còn mở.
//
// Chỉ người trong phạm vi xử lý yêu cầu (cùng luật với dịch vụ ghi: `phamViXuLyYeuCau` / `duocXuLyYeuCau`) mới thấy. Ngoài tầm ⇒ `null` (cùng kết quả với «đơn không có yêu cầu»).
// KHÔNG trả `tokenHash`, `ipGui`, `uaGui`, `donY`; token thô không bao giờ lưu nên cũng không có ở đây.

export type KhoiYeuCauNguoiMua = {
  id: string;
  trangThai: TrangThaiYeuCau;
  hetHanLuc: string;
  /** Liên kết công khai đã hết hạn (đồng hồ máy chủ). Nhân viên vẫn sửa thông tin được. */
  linkHetHan: boolean;
  /** Lần gửi CUỐI của phụ huynh trên yêu cầu NÀY (ISO). */
  guiLuc: string | null;
  soLanMo: number;
  /** Đang bị khoá do nhập sai token quá số lần (đồng hồ máy chủ). */
  dangKhoa: boolean;
  /** Phụ huynh đã từng gửi thông tin cho đơn này (bất kỳ yêu cầu nào). */
  phDaNhap: boolean;
  /** Giờ hệ thống sẽ tự phát hành hoá đơn (ISO); `null` khi công tắc tự xuất tắt, phụ huynh chưa gửi, hoặc yêu cầu không còn mở. */
  tuXuatLuc: string | null;
};

export async function docYeuCauMoiNhatChoDon(actor: Actor, orderId: string, now: Date): Promise<KhoiYeuCauNguoiMua | null> {
  const pv = phamViXuLyYeuCau(actor);
  if (pv !== "ALL" && pv.length === 0) return null;
  const coSo = pv === "ALL" ? {} : { centerId: { in: pv } };
  const [row, daTungGui, tuXuat] = await Promise.all([
    db.hoaDonYeuCauNguoiMua.findFirst({
      where: { orderId, ...coSo },
      orderBy: { createdAt: "desc" },
      select: { id: true, centerId: true, trangThai: true, hetHanLuc: true, guiLuc: true, soLanMo: true, khoaDen: true },
    }),
    db.hoaDonYeuCauNguoiMua.count({ where: { orderId, guiLuc: { not: null }, ...coSo } }),
    docCauHinhTuXuat(),
  ]);
  if (!row || !duocXuLyYeuCau(actor, row.centerId)) return null;
  const tuXuatLuc = tuXuat.bat && row.trangThai === "DANG_MO" && row.guiLuc ? gioTuXuat(row.guiLuc, tuXuat.soGio).toISOString() : null;
  return {
    id: row.id,
    trangThai: row.trangThai as TrangThaiYeuCau,
    hetHanLuc: row.hetHanLuc.toISOString(),
    linkHetHan: daHetHan(row.hetHanLuc, now),
    guiLuc: row.guiLuc ? row.guiLuc.toISOString() : null,
    soLanMo: row.soLanMo,
    dangKhoa: row.khoaDen !== null && row.khoaDen.getTime() > now.getTime(),
    phDaNhap: daTungGui > 0,
    tuXuatLuc,
  };
}
