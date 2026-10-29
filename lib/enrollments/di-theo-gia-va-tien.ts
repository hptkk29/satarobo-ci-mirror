// lib/enrollments/di-theo-gia-va-tien.ts — LÕI THUẦN của «giá và khoản thu đi theo ghi danh mới khi chuyển lớp cùng khoá» (P7-G2, 27/10/2026). Phần DB: `di-theo-gia-va-tien-db.ts`.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// GIÁ VÀ KHOẢN THU ĐI THEO GHI DANH MỚI [P7-G2 · 27/10/2026]
//
// Sự cố gốc: chuyển lớp trơn tạo ghi danh MỚI với năm cột giá NULL, còn giá + `Payment.enrollmentId` ở lại ghi danh CŨ (TRANSFERRED).
// `getDebtRows` KHÔNG lọc trạng thái nên ghi danh cũ (đã đóng) vẫn nằm trong sổ công nợ với giá cũ, còn ghi danh mới đang học không có giá, không có khoản thu — màn công nợ,
// cổng phụ huynh, hoàn tiền và hoá đơn đọc sai chỗ; khi giá cũ lệch gói đã bán thì thành nợ ảo. Mỗi lượt chuyển lớp sinh thêm một ca cho lệnh P7-B dọn.
//
// LUẬT (cùng khoá — chuyển lớp cùng khoá là CÙNG MỘT hợp đồng học phí):
//   · năm cột giá: ghi danh cũ → ghi danh mới, ghi danh cũ về NULL (giá đi theo tiền, không nhân đôi, không mất);
//   · `Payment.enrollmentId`: MỌI khoản chưa xoá của ghi danh cũ → ghi danh mới (số tiền · trạng thái · ngày thu KHÔNG đổi);
//   · `OrderItem.enrollmentId`: dòng đơn trỏ ghi danh cũ → ghi danh mới (khoản thu SẮP TỚI của đơn gắn ghi danh theo dòng đơn — để nguyên là đợt sau rơi vào ghi danh đã đóng);
//   · KHÔNG tạo Payment / Order / hoá đơn; KHÔNG đổi Receipt; KHÔNG đổi hoa hồng.
// BIÊN LAI VÀ HOA HỒNG Ở NGUYÊN GHI DANH CŨ — cố ý: biên lai là chứng từ đã phát hành (số + nội dung bất biến), dòng hoa hồng đã nằm trong bảng kê kỳ;
// đổi chỗ trỏ của chúng là sửa chứng từ / bảng kê sau lưng kế toán. Truy ngược luôn được qua chuỗi `Enrollment.transferredToId`. Lệnh P7-B chỉ BÁO số biên lai / dòng hoa hồng còn trỏ ghi danh cũ.
// KHÁC KHOÁ ⇒ KHÔNG đi theo (đổi khoá F4 có học phí mới và tự chuyển tiền ở mức đơn).
// Dừng im (không đi theo, không ném) khi: ghi danh cũ có yêu cầu hoàn / bảo lưu (tiền đang thuộc một quy trình khác), hoặc ghi danh mới đã có giá. Lý do được ghi vào kết quả và AuditLog.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type GiaGhiDanhChuyenLop = {
  listPrice: number | null;
  discountType: string | null;
  discountAmount: number | null;
  tuition: number | null;
  finalPrice: number | null;
};

export const GIA_TRONG: GiaGhiDanhChuyenLop = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
export const giaTrong = (g: GiaGhiDanhChuyenLop) => Object.values(g).every((v) => v === null);
export const cungGia = (a: GiaGhiDanhChuyenLop, b: GiaGhiDanhChuyenLop) =>
  a.listPrice === b.listPrice && a.discountType === b.discountType && a.discountAmount === b.discountAmount && a.tuition === b.tuition && a.finalPrice === b.finalPrice;
export const SEL_GIA = { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } as const;

export type MaBoQuaDiTheo = "KHAC_KHOA" | "CO_HOAN_TIEN_HOAC_BAO_LUU" | "GHI_DANH_MOI_DA_CO_GIA" | "KHONG_CO_GI_DE_MANG";
export type QuyetDinhDiTheoGiaVaTien = { lam: true } | { lam: false; ma: MaBoQuaDiTheo };

/** THUẦN: có mang giá + khoản thu theo ghi danh mới không. Thứ tự ma = thứ tự kiểm. */
export function xetDiTheoGiaVaTien(i: {
  khoaCu: string;
  khoaMoi: string;
  giaCu: GiaGhiDanhChuyenLop;
  giaMoi: GiaGhiDanhChuyenLop;
  soKhoanCu: number;
  soHoanTienBaoLuuCu: number;
}): QuyetDinhDiTheoGiaVaTien {
  if (i.khoaCu !== i.khoaMoi) return { lam: false, ma: "KHAC_KHOA" };
  if (i.soHoanTienBaoLuuCu > 0) return { lam: false, ma: "CO_HOAN_TIEN_HOAC_BAO_LUU" };
  if (!giaTrong(i.giaMoi)) return { lam: false, ma: "GHI_DANH_MOI_DA_CO_GIA" };
  if (giaTrong(i.giaCu) && i.soKhoanCu === 0) return { lam: false, ma: "KHONG_CO_GI_DE_MANG" };
  return { lam: true };
}

export type KetQuaDiTheoGiaVaTien =
  | { daDoi: false; ma: MaBoQuaDiTheo }
  | { daDoi: true; soKhoan: number; tongTien: number; soDongDon: number; giaDiTheo: boolean };

/** Nợ của một ghi danh = giá − Σ khoản đã xác nhận (đúng công thức `debt.ts`); null khi chưa có giá. */
export const noCua = (gia: number | null, daThu: number) => (gia === null ? null : gia - daThu);
