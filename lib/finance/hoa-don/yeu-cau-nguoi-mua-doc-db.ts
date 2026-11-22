import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { cheDoLoDem } from "./feature";
import { gioLoCuoiNgayKeTiep } from "./xuat-lo-dem/chon-lan-thu";
import { daHetHan, duocXuLyYeuCau, phamViXuLyYeuCau, type TrangThaiYeuCau } from "./yeu-cau-nguoi-mua";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db.ts — ĐỌC trạng thái mã QR thông tin người mua của một đơn cho màn đơn hàng (Invoice Hub S11). Chỉ đọc.
//
// [03/11/2026 — chủ dự án: gộp hai thẻ người mua] Phụ huynh gửi xong là dữ liệu vào ĐƠN ngay (xem `yeu-cau-nguoi-mua-db.ts`), nên màn đơn đọc các ô từ ĐƠN (thẻ «Người mua trên hoá đơn», đã che theo
// `orders:view-pii`), còn hàm này chỉ trả TRẠNG THÁI của mã — KHÔNG trả ô nào của `duLieuGui` (bỏ luôn việc che ô ở đây: không có PII nào đi qua). Thêm:
//  · `phDaNhap`: phụ huynh ĐÃ TỪNG gửi (bất kỳ yêu cầu nào của đơn, kể cả đã đóng/thu hồi — dữ liệu họ gửi đã nằm trên đơn) ⇒ nút ở đầu thẻ là «Sửa», chưa từng ⇒ «Nhập thay PH»;
//  · `xuatLoLuc`: lúc lô cuối ngày (23h30) kế tiếp sẽ xuất hoá đơn cho đơn này — khi lô ở chế độ TỰ ĐỘNG, phụ huynh ĐÃ gửi và yêu cầu còn mở. [09/11/2026: thay `tuXuatLuc` «lần gửi cuối + n giờ» — BGĐ bỏ «tự xuất sau n giờ».]
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
  /** Lúc lô cuối ngày kế tiếp xuất hoá đơn (ISO); `null` khi lô không ở chế độ TỰ ĐỘNG, phụ huynh chưa gửi, hoặc yêu cầu không còn mở. */
  xuatLoLuc: string | null;
  /** Phụ huynh ĐÃ gửi thông tin và yêu cầu còn mở ⇒ Sale có thể bấm «Xuất liền» (cổng thật — tiền đã xác nhận, cờ, pháp nhân — kiểm lại ở máy chủ khi bấm). */
  coTheXuatLien: boolean;
};

export async function docYeuCauMoiNhatChoDon(actor: Actor, orderId: string, now: Date): Promise<KhoiYeuCauNguoiMua | null> {
  const pv = phamViXuLyYeuCau(actor);
  if (pv !== "ALL" && pv.length === 0) return null;
  const coSo = pv === "ALL" ? {} : { centerId: { in: pv } };
  const [row, daTungGui, cheDo] = await Promise.all([
    db.hoaDonYeuCauNguoiMua.findFirst({
      where: { orderId, ...coSo },
      orderBy: { createdAt: "desc" },
      select: { id: true, centerId: true, trangThai: true, hetHanLuc: true, guiLuc: true, soLanMo: true, khoaDen: true },
    }),
    db.hoaDonYeuCauNguoiMua.count({ where: { orderId, guiLuc: { not: null }, ...coSo } }),
    cheDoLoDem().catch(() => "TAT" as const),
  ]);
  if (!row || !duocXuLyYeuCau(actor, row.centerId)) return null;
  const dangCho = row.trangThai === "DANG_MO" && row.guiLuc !== null;
  const xuatLoLuc = dangCho && cheDo === "TU_DONG" ? gioLoCuoiNgayKeTiep(now).toISOString() : null;
  return {
    id: row.id,
    trangThai: row.trangThai as TrangThaiYeuCau,
    hetHanLuc: row.hetHanLuc.toISOString(),
    linkHetHan: daHetHan(row.hetHanLuc, now),
    guiLuc: row.guiLuc ? row.guiLuc.toISOString() : null,
    soLanMo: row.soLanMo,
    dangKhoa: row.khoaDen !== null && row.khoaDen.getTime() > now.getTime(),
    phDaNhap: daTungGui > 0,
    xuatLoLuc,
    coTheXuatLien: dangCho,
  };
}
