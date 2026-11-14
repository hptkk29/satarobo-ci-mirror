// lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung.ts — luật THUẦN của bước «áp dụng thông tin người mua ĐÃ XÁC NHẬN vào đơn» (Invoice Hub S11). Không DB, không đồng hồ.
//
// Dịch vụ yêu cầu (`yeu-cau-nguoi-mua-db.ts`) cố ý KHÔNG ghi `Order`; chép sang đơn là việc của đường gọi, trong CÙNG giao dịch với xác nhận (xem `yeu-cau-nguoi-mua-ap-dung-db.ts`).
// Ở đây chỉ hai quyết định kiểm được không cần DB: ánh xạ người mua → cột của đơn, và «đơn có bị sửa SAU khi yêu cầu được tạo không» (xung đột theo cột).
import { nationalPhone } from "@/lib/phone";
import { parseVnYmd, vnDateOnly } from "@/lib/time/vn";
import type { NguoiMuaToiGian } from "./yeu-cau-nguoi-mua";
import { COT_GOC, giaTriGocHash, type CotGoc } from "./yeu-cau-nguoi-mua-token";

/** Các cột của `Order` mà bước áp dụng được phép ghi. Khoá VẮNG MẶT = không đụng (khác với `null` = xoá). */
export type CotDonGhi = Partial<{
  invoiceBuyerName: string | null;
  invoiceCompanyName: string | null;
  invoiceTaxCode: string | null;
  invoiceEmail: string | null;
  customerAddress: string | null;
  customerWard: string | null;
  customerCity: string | null;
  /** CCCD ba/mẹ — cùng cột hộp thoại «Người mua trên hoá đơn» ghi (`cotDonTuForm`). */
  customerCccd: string | null;
  /** SĐT ba/mẹ — cột RIÊNG, TUYỆT ĐỐI không ghi vào `customerPhone` (chìa đối khớp tiền theo SĐT của `payos-ingest`). */
  invoiceParentPhone: string | null;
  invoiceStudentName: string | null;
  invoiceStudentDob: Date | null;
  invoiceStudentCccd: string | null;
}>;

/**
 * Người mua → cột của đơn. Cùng ngữ nghĩa cột với hộp thoại «Người mua trên hoá đơn» (`form-nguoi-mua.ts`) để hai đường ghi không lệch nhau.
 *  · Cá nhân: tên + CCCD + SĐT ba/mẹ; XOÁ tên đơn vị + MST (người mua nay là cá nhân — để lại MST cũ là in hoá đơn cá nhân mang MST công ty).
 *    Khối học viên (tên · ngày sinh · CCCD): CHỈ ghi ô phụ huynh có điền (bỏ trống KHÔNG xoá giá trị đơn đã có).
 *  · Doanh nghiệp: tên đơn vị + MST + email (bắt buộc); KHÔNG đụng tên / CCCD / SĐT ba/mẹ và khối học viên (người liên hệ vẫn là người cũ).
 *  · Email: có ⇒ ghi; trống ⇒ KHÔNG đụng (cá nhân bỏ trống không có nghĩa là xoá email kế toán đã khai).
 *  · Địa chỉ: một ô đầy đủ ⇒ ghi vào `customerAddress`, xoá phường / thành phố để `nguoiMuaChoDon` không ghép trùng. (Đơn chưa có cột địa chỉ hoá đơn riêng; thêm cột là migration — quyết định của lead / owner.)
 */
export function anhXaNguoiMuaSangDon(nm: NguoiMuaToiGian): CotDonGhi {
  const dia = { customerAddress: nm.diaChi, customerWard: null, customerCity: null } as const;
  const email = nm.email ? { invoiceEmail: nm.email } : {};
  if (nm.loai === "CA_NHAN") {
    const ngay = nm.ngaySinhHocVien ? parseVnYmd(nm.ngaySinhHocVien) : null;
    return {
      invoiceBuyerName: nm.ten,
      invoiceCompanyName: null,
      invoiceTaxCode: null,
      ...(nm.cccd ? { customerCccd: nm.cccd } : {}),
      ...(nm.sdt ? { invoiceParentPhone: nationalPhone(nm.sdt) ?? nm.sdt } : {}),
      ...(nm.tenHocVien ? { invoiceStudentName: nm.tenHocVien } : {}),
      ...(ngay ? { invoiceStudentDob: vnDateOnly(ngay) } : {}),
      ...(nm.cccdHocVien ? { invoiceStudentCccd: nm.cccdHocVien } : {}),
      ...email,
      ...dia,
    };
  }
  return { invoiceCompanyName: nm.ten, invoiceTaxCode: nm.maSoThue, ...email, ...dia };
}

/**
 * Cột `invoice*` sắp bị ghi mà giá trị hiện tại KHÁC lúc yêu cầu được tạo (so băm có muối theo id yêu cầu). Băm lưu hỏng / thiếu cột ⇒ coi là đã đổi — không bao giờ im lặng ghi đè.
 * Cột địa chỉ không nằm trong băm gốc nên không xét ở đây.
 */
export function cotDonDaDoi(
  idYeuCau: string,
  hashLuu: unknown,
  donHienTai: Readonly<Record<CotGoc, string | null | undefined>>,
  cotSeGhi: CotDonGhi,
): CotGoc[] {
  const luu = typeof hashLuu === "object" && hashLuu !== null && !Array.isArray(hashLuu) ? (hashLuu as Record<string, unknown>) : {};
  const nay = giaTriGocHash(idYeuCau, donHienTai);
  return COT_GOC.filter((c) => c in cotSeGhi).filter((c) => !(c in luu) || luu[c] !== nay[c]);
}
