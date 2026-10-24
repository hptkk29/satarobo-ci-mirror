// lib/finance/hoa-don/canh-bao-sua-nguoi-mua.ts — câu CẢNH BÁO khi sale sửa khối "Người mua trên hoá
// đơn" của một đơn đang có hoá đơn còn hiệu lực (GĐ 8 bước 12). THUẦN.
//
// Sửa ô trên đơn KHÔNG đổi tờ hoá đơn đã có: bản NHÁP / ĐÃ XÁC NHẬN chụp người mua lúc tạo. Không nói
// ra thì sale tưởng "sửa xong là hoá đơn đúng" — lời hứa suông của nút Lưu (luật 12). Riêng EMAIL thì
// khác: bước chốt đọc email HIỆN TẠI của đơn (GĐ 8), nên với bản nháp email mới SẼ được dùng.

export type CotNguoiMua = "invoiceBuyerName" | "invoiceCompanyName" | "invoiceTaxCode" | "invoiceEmail";

export type HoaDonConHieuLuc = { trangThai: string; kyHieu: string | null; soHoaDon: string | null };

const soCua = (h: HoaDonConHieuLuc) => [h.kyHieu, h.soHoaDon].filter(Boolean).join("-") || "chưa ghi số";

export function canhBaoSuaNguoiMua(input: {
  doi: readonly CotNguoiMua[];
  con: readonly HoaDonConHieuLuc[];
  /** Email nhận hoá đơn SAU khi lưu (`null` = đơn không còn email). */
  emailMoi: string | null;
}): string | null {
  const nhap = input.con.filter((h) => h.trangThai === "NHAP");
  const daXuat = input.con.filter((h) => h.trangThai === "DA_XAC_NHAN");
  if (input.doi.length === 0 || nhap.length + daXuat.length === 0) return null;

  const doiNguoiMua = input.doi.some((k) => k !== "invoiceEmail");
  if (doiNguoiMua) {
    const ds = [...nhap.map((h) => `${soCua(h)} (nháp)`), ...daXuat.map((h) => `${soCua(h)} (đã xuất)`)].join(", ");
    const viec = [nhap.length > 0 && "gỡ bản nháp rồi tải lại", daXuat.length > 0 && "huỷ hoá đơn rồi xuất lại"]
      .filter(Boolean)
      .join(" / ");
    return `Đơn đang có hoá đơn ${ds} in người mua cũ — tờ hoá đơn không tự đổi; báo kế toán ${viec} nếu cần`;
  }

  // Chỉ đổi EMAIL.
  const cau: string[] = [];
  if (nhap.length > 0) {
    cau.push(
      input.emailMoi
        ? "Hoá đơn nháp sẽ gửi tới email mới khi kế toán xác nhận"
        : "Đơn không còn email — hoá đơn nháp sẽ không gửi email khi kế toán xác nhận",
    );
  }
  if (daXuat.length > 0 && input.emailMoi) {
    cau.push("Hoá đơn đã gửi tới email cũ — nhờ kế toán 'Gửi lại email' tới email hiện tại nếu cần");
  }
  return cau.length > 0 ? cau.join(". ") : null;
}
