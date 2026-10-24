// lib/finance/hoa-don/ly-do-gan-ghi-danh.ts — câu "vì sao khoản này CHƯA gắn được ghi danh" cho kế toán
// (GĐ 8b). THUẦN. Mỗi câu nói bằng ngôn ngữ của NGUYÊN NHÂN và chỉ đúng việc phải làm (luật 12).
//
// ⚠️ Không câu nào bảo "sang màn Thanh toán gắn": đường gắn ở đó (`ganGhiDanhChoKhoanAction`) đòi
// `Order.studentId`, mà đơn lập từ lead để trống cột đó — chính là tập đơn rơi vào đây.

import type { KhoaHoaDonCuaKhoan, MaBoQuaGan } from "@/lib/finance/ke-hoach-gan-ghi-danh";

export const CAU_CHAN_GAN_GHI_DANH = "Đơn có khoản đã xác nhận mà chưa gắn ghi danh — dữ liệu lệch, báo Quản trị hệ thống";

export function cauBoQuaGan(
  ma: MaBoQuaGan,
  ctx: {
    /** MO_HO — tên bé nhận ≥ 2 phần và số ghi danh cùng khoá của bé. */
    tenBe: string | null;
    soGhiDanh: number;
    /** PHAI_TACH_DA_KHOA — số bé phải chia + hoá đơn đang giữ khoản. */
    soBe: number;
    khoaHoaDon: KhoaHoaDonCuaKhoan | null;
  },
): string {
  switch (ma) {
    case "KHONG_HOC_VIEN":
      return "Đơn chưa có học viên (dòng đơn trống học viên, không có học viên mang SĐT phụ huynh này) — chuyển đổi lead / tạo học viên trước";
    case "KHONG_GHI_DANH":
      return "Học viên của đơn chưa có ghi danh — xếp lớp trước";
    case "KHONG_KHOP":
      return "Không tìm thấy ghi danh khớp học viên + khoá trên dòng đơn — xếp lớp đúng khoá hoặc sửa dòng đơn";
    case "MO_HO":
      return `Bé ${ctx.tenBe ?? "trên đơn"} có ${ctx.soGhiDanh} ghi danh cùng khoá — hệ thống không đoán; báo Quản trị hệ thống`;
    case "NGOAI_TAM":
      return "Ghi danh ở cơ sở ngoài phạm vi kế toán của bạn — nhờ kế toán Hội sở";
    case "PHAI_TACH_DA_KHOA": {
      const hd = ctx.khoaHoaDon;
      const truoc = `Khoản phải chia cho ${ctx.soBe} bé nhưng`;
      if (hd?.trangThai === "DA_XAC_NHAN") {
        return `${truoc} đã nằm trong hoá đơn ${hd.so} (tờ hoá đơn đã chụp số tiền) — huỷ hoá đơn, gắn ghi danh rồi xuất lại`;
      }
      if (hd?.trangThai === "KHONG_XUAT") {
        return `${truoc} đang nằm trong lần thu đã đánh dấu không xuất — gỡ dấu, gắn ghi danh rồi đánh dấu lại`;
      }
      return `${truoc} đang nằm trong hoá đơn nháp${hd ? ` ${hd.so}` : ""} — gỡ bản nháp, gắn ghi danh rồi tải lại hoá đơn`;
    }
  }
}
