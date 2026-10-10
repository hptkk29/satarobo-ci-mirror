// lib/finance/hoa-don/phieu-thu-data.ts — dựng DỮ LIỆU một tờ phiếu thu. THUẦN.
//
// MỘT công thức cho CẢ HAI bản: bản chính thức (`payments/[id]/phieu-thu`, có số RCP) và bản CHỜ XÁC
// NHẬN (`payments/hoa-don/phieu-cho`, `maPhieu = null`). Kế toán làm hoá đơn ở MISA theo bản chờ;
// hai công thức thì tờ chính thức in ra sau có thể lệch tờ kế toán đã dựa vào — đúng lớp lỗi của
// sự cố nội dung CK trên QR (24/09: hai công thức cho cùng một chuỗi).

import type { PhieuThuPdfData } from "@/lib/pdf/phieu-thu";
import { thueChoLoaiDon, type CauHinhHoaDon, type PhapNhan } from "./phap-nhan";
import { nguoiMuaChoDon, type DonChoHoaDon } from "./nguoi-mua";
import { soTienBangChu } from "./so-tien-bang-chu";
import { tinhDongHoaDon, tongHoaDon } from "./tinh-hoa-don";
import { donCanGhiDanh } from "@/lib/finance/can-ghi-danh";

/** Dòng ĐƠN mà khoản này thu cho — chỉ các cột tờ phiếu cần. */
export type DongDonPhieuThu = {
  itemName: string;
  /** `OrderItemType` — quyết ĐƠN VỊ TÍNH (schema không có cột đơn vị). */
  type: string;
  quantity: number;
  /** Tạm tính của dòng (trước giảm) — xem `OrderItem.totalPrice`. */
  totalPrice: number;
  discountAmount: number;
};

/**
 * Đơn vị tính theo LOẠI DÒNG — `OrderItem` không có cột đơn vị, nên suy từ `type`:
 *   · `PRODUCT` (bộ kit / thiết bị) ⇒ "Bộ";
 *   · `EXAM_REGISTRATION` (lệ phí thi) ⇒ "Lần";
 *   · loại khác ⇒ "Lần" (một lần thu).
 * Thêm loại dòng mới cần đơn vị riêng thì thêm ở ĐÂY — một chỗ cho cả tờ chờ lẫn tờ chính thức.
 */
export function donViTinhTheoDong(type: string): string {
  return type === "PRODUCT" ? "Bộ" : "Lần";
}

/**
 * Tên + đơn vị + số lượng của dòng phiếu thu cho khoản của đơn KIT / THI (29/09/2026).
 *
 * Luật:
 *   · ĐÚNG MỘT dòng đơn ⇒ tên = `itemName` ("Bộ kit Sata 4", "Lệ phí thi RoboSim"), đơn vị theo loại
 *     dòng; số lượng = `quantity` CHỈ KHI khoản thu ĐÚNG thành tiền của dòng (trọn dòng) — thu một phần
 *     (đặt cọc / trả góp) thì số lượng 1, vì "2 Bộ" trên một tờ thu nửa tiền là nói sai;
 *   · NHIỀU dòng (khoản không gắn dòng nào, đơn nhiều món) ⇒ nối tên các dòng, đơn vị "Lần", số lượng 1;
 *   · KHÔNG dòng nào (dữ liệu cũ) ⇒ nhãn theo LOẠI ĐƠN: "Bộ kit" / "Lệ phí thi".
 */
export function dongPhieuThuKitThi(
  loaiDon: string,
  dongDon: readonly DongDonPhieuThu[],
  soTien: number,
): { ten: string; donViTinh: string; soLuong: number } {
  if (dongDon.length === 1) {
    const d = dongDon[0]!;
    const tronDong = d.quantity > 1 && soTien === d.totalPrice - d.discountAmount;
    return { ten: d.itemName.trim() || "Bộ kit", donViTinh: donViTinhTheoDong(d.type), soLuong: tronDong ? d.quantity : 1 };
  }
  if (dongDon.length > 1) {
    return { ten: dongDon.map((d) => d.itemName.trim()).filter(Boolean).join(", "), donViTinh: "Lần", soLuong: 1 };
  }
  return loaiDon === "EXAM" ? { ten: "Lệ phí thi", donViTinh: "Lần", soLuong: 1 } : { ten: "Bộ kit", donViTinh: "Bộ", soLuong: 1 };
}

export function dungPhieuThuData(input: {
  /** `null` ⇒ bản CHỜ XÁC NHẬN (dấu nền, ô số trống). */
  maPhieu: string | null;
  /** dd/mm/yyyy. */
  ngayLap: string;
  phapNhan: PhapNhan;
  cauHinh: CauHinhHoaDon;
  don: DonChoHoaDon & { code: string | null; type: string | null };
  /** Số tiền của khoản — bản chờ truyền số RÒNG (`soTienRong`). */
  soTien: number;
  /** Nhãn hình thức đã tra từ danh mục; rỗng thì PDF tự rơi về bảng nhãn dự phòng. */
  hinhThucThanhToan: string;
  tenKhoa: string | null;
  tenHocVien: string | null;
  tenLop: string | null;
  nguoiThu: string | null;
  /**
   * Dòng ĐƠN khoản này thu cho: dòng khoản đã gắn (`Payment.orderItem`), không có thì MỌI dòng của đơn.
   * Chỉ đơn KIT / THI đọc (tên dòng + đơn vị); đơn COURSE vẫn in "Khoá học … / Học phí". BẮT BUỘC (luật 7).
   */
  dongDon: readonly DongDonPhieuThu[];
}): PhieuThuPdfData {
  const { thueSuat, kieuGia } = thueChoLoaiDon(input.don.type ?? "TAT_CA", input.cauHinh);
  // Đơn KIT / THI (không có ghi danh — `can-ghi-danh.ts`) ⇒ tên dòng lấy từ DÒNG ĐƠN; trước bản này
  // tờ của đơn kit in "Học phí".
  const kitThi = input.don.type != null && !donCanGhiDanh(input.don.type);
  const hv = input.tenHocVien ? `HV ${input.tenHocVien}` : null;
  const noiDung = kitThi
    ? (() => {
        const k = dongPhieuThuKitThi(input.don.type!, input.dongDon, input.soTien);
        return { ...k, ten: [k.ten, hv].filter(Boolean).join(" — ") };
      })()
    : {
        // Nội dung thu viết như mẫu VIN: "Khoá học <khoá> — HV <tên bé>".
        ten:
          [input.tenKhoa ? `Khoá học ${input.tenKhoa}` : "Học phí", hv].filter(Boolean).join(" — ") +
          (input.tenLop ? ` (lớp ${input.tenLop})` : ""),
        donViTinh: input.tenKhoa ? "Khoá" : "Lần",
        soLuong: 1,
      };
  const dong = [
    tinhDongHoaDon({
      ...noiDung,
      soTien: input.soTien,
      thueSuat,
      kieuGia,
    }),
  ];
  const tong = tongHoaDon(dong);
  return {
    maPhieu: input.maPhieu,
    ngayLap: input.ngayLap,
    phapNhan: input.phapNhan,
    nguoiMua: nguoiMuaChoDon(input.don),
    hinhThucThanhToan: input.hinhThucThanhToan,
    dong,
    tong,
    soTienBangChu: soTienBangChu(tong.congTienThanhToan),
    maDon: input.don.code,
    nguoiThu: input.nguoiThu,
  };
}

/**
 * Tên học viên in trên tờ của MỘT khoản — ghi danh → con trên đơn → học viên của đơn.
 *
 * Đơn hai con: `Order.student` chỉ là MỘT bé, nên in theo nó là tờ của bé thứ hai mang tên bé thứ
 * nhất. Bản chính thức và bản chờ cùng gọi hàm này — một chuỗi ưu tiên, không phải hai.
 */
export function tenHocVienChoKhoan(
  khoan: {
    enrollment: { student: { name: string } | null } | null;
    orderItem: { student: { name: string } | null } | null;
  },
  hocVienCuaDon: { name: string } | null | undefined,
): string | null {
  return khoan.enrollment?.student?.name ?? khoan.orderItem?.student?.name ?? hocVienCuaDon?.name ?? null;
}

/**
 * Dòng đơn của MỘT khoản — dòng khoản đã gắn (`Payment.orderItem`), không gắn thì mọi dòng của đơn.
 * Bản chính thức và bản chờ cùng gọi hàm này (luật như `tenHocVienChoKhoan`: một chuỗi ưu tiên, không hai).
 */
export function dongDonCuaKhoan(
  khoan: { orderItem: DongDonPhieuThu | null },
  dongCuaDon: readonly DongDonPhieuThu[] | null | undefined,
): readonly DongDonPhieuThu[] {
  return khoan.orderItem ? [khoan.orderItem] : (dongCuaDon ?? []);
}
