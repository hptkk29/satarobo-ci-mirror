// lib/finance/hoa-don/dau-phieu-xem-truoc.ts — DẤU VÂN TAY của tờ hoá đơn kế toán đã XEM TRƯỚC (24/11/2026). THUẦN (chỉ `node:crypto`).
//
// Nút «Xem trước» bày đúng tờ sẽ gửi (người mua · dòng hàng · tiền); nút «Phát hành» gửi kèm dấu này, `batDauPhatHanh` dựng lại tờ DƯỚI KHOÁ ĐƠN rồi so — lệch (sale sửa người mua, đổi
// số tiền, qua nửa đêm đổi ngày hoá đơn, kế toán chọn con nhưng máy dựng ba/mẹ…) ⇒ từ chối, không phát hành một tờ khác tờ người bấm vừa soát. Cùng tinh thần `soTienDaThay`, nhưng phủ CẢ tờ.
//
// KHÔNG gồm `refId` (UUID sinh mỗi lần dựng — đưa vào là dấu không bao giờ khớp). Gồm mọi thứ còn lại mà nhà cung cấp nhận: ký hiệu, MST bán, ngày, khối người mua, hình thức thanh toán,
// từng dòng hàng, tổng. Mảng CÓ THỨ TỰ qua JSON (ghép chuỗi trần thì ("ab","") và ("a","b") ra cùng một dấu — cùng bài học `bam-nguoi-mua.ts`).

import { createHash } from "node:crypto";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";

const chuan = (v: string | null | undefined): string => (v ?? "").normalize("NFC").trim().replace(/\s+/g, " ");

export function bamPhieuXemTruoc(p: PhieuPhatHanh): string {
  const nm = p.nguoiMua;
  const thanPhieu = [
    chuan(p.kyHieu),
    chuan(p.mstNguoiBan),
    p.ngayHoaDon.toISOString().slice(0, 10),
    [nm.hoTen, nm.donVi, nm.mst, nm.diaChi, nm.email, nm.maKhachHang ?? null, nm.cccd ?? null].map(chuan),
    chuan(p.hinhThucThanhToan),
    p.dong.map((d) => [d.stt, chuan(d.ten), chuan(d.donViTinh), d.soLuong, d.donGia, d.thanhTien, d.thueSuat, d.tienThue]),
    p.tongTruocThue,
    p.tongThue,
    p.tongThanhToan,
  ];
  return createHash("sha256").update(JSON.stringify(thanPhieu)).digest("hex").slice(0, 32);
}
