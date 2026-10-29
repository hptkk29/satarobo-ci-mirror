/**
 * lib/affiliate/cua-toi.ts — LÕI THUẦN của trang `/portal/gioi-thieu` (AFF-P3 H3): nhãn dành cho ĐỐI TÁC (không phải nhãn vận hành) và hình dạng dữ liệu đưa xuống giao diện.
 *
 * ── Cái gì KHÔNG bao giờ có trong các kiểu dưới đây (đó là hợp đồng, không phải sơ suất) ───────────────────────
 *  · tên / SĐT / email của KHÁCH — và cũng KHÔNG mã phiếu rút gọn, KHÔNG trạng thái của lượt gửi (R10 · D1: mỗi thứ đó là một bit «SĐT này đã có trong CRM chưa»);
 *  · id nội bộ (đối tác, campaign, lead, đơn, học viên), `sourceSnapshot`, `resolutionReason` (mang tín hiệu chống gian lận / tự giới thiệu), nguồn / chính sách / tỉ lệ hoa hồng;
 *  · token của link người khác — `LinkCuaToi` chỉ mang địa chỉ dựng từ token CỦA CHÍNH đối tác.
 * Cổng đối tác cố ý KHÔNG có trạng thái / mã hồ sơ của lượt gửi biểu mẫu (xem `NHAN_LUOT_GUI_DOI_TAC`).
 */
import type { CommissionPayoutStatus } from "@prisma/client";

import type { ChuongTrinhChon } from "./doc-link";

/**
 * R10 · D1 (chủ dự án chốt 18/10/2026) — CỔNG ĐỐI TÁC KHÔNG BAO GIỜ NÓI «SĐT NÀY ĐÃ CÓ TRONG CRM HAY CHƯA», không chỉ che 7 ngày.
 * Trạng thái của MỘT lượt gửi biểu mẫu (hợp lệ · trùng · bị từ chối · xem tay · tranh chấp) và mã hồ sơ rút gọn đều là câu trả lời cho «số này đã có chưa»: đối tác gửi thử hàng loạt SĐT bằng token của mình
 * rồi đọc cổng là dò được danh sách khách của công ty (bản che 7 ngày chỉ đưa chi phí từ «tức thì» lên «mỗi vòng một tuần», kẻ kiên nhẫn vẫn đọc được). Nên đối tác CHỈ thấy: ngày, chương trình, và một nhãn
 * DUY NHẤT cho mọi lượt. Kết quả CÓ NGHĨA với họ (có được hoa hồng không) nằm ở KHỐI HOA HỒNG — phát sinh khi khách ghi danh và thanh toán, không phụ thuộc việc dò — và ở số «đã đăng ký học».
 * Người vận hành vẫn thấy trạng thái thật ở màn quản trị (`NHAN_TRANG_THAI_REFERRAL`). Đổi quyết định này là đổi quyết định bảo mật — ghi ở docs/source-commission/12 §11.8.
 */
export const NHAN_LUOT_GUI_DOI_TAC = "Đã nhận";

export const NHAN_CHI_DOI_TAC: Readonly<Record<CommissionPayoutStatus, string>> = {
  ON_HOLD: "Đang giữ — chờ đủ hồ sơ", // AFF-L2: hoa hồng của đối tác TỔ CHỨC chưa đủ hồ sơ pháp lý / ngân hàng / thuế; KHÔNG phải «chờ chi»
  PENDING: "Chờ chi",
  APPROVED: "Đã duyệt chi",
  EXPORTED: "Đã chuyển sang chi trả",
  PAID: "Đã chi",
};

/** Dòng sổ → «Hoa hồng» hay «Điều chỉnh» (hoàn tiền, đổi nguồn, khiếu nại). Không lộ loại kỹ thuật. */
export function nhanLoaiDong(entryKind: string): "Hoa hồng" | "Điều chỉnh" {
  return entryKind === "ORIGINAL" || entryKind === "LATE_ARRIVAL" || entryKind === "PERIOD_BONUS" ? "Hoa hồng" : "Điều chỉnh";
}

export type TrangThaiDoiTac = "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
export const NHAN_TRANG_THAI_DOI_TAC: Readonly<Record<TrangThaiDoiTac, string>> = {
  DRAFT: "Bản nháp",
  PENDING: "Chờ duyệt",
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm ngưng",
  ENDED: "Đã kết thúc",
};

// ── Hình dạng dữ liệu ─────────────────────────────────────────────────────────────────────────────

export type HoSoDoiTac = { ten: string; ma: string; trangThai: TrangThaiDoiTac };

export type LinkCuaToi = {
  /** Id của CHÍNH link này — để xin QR (`taoQrCuaToiAction`); quyền sở hữu kiểm lại trong truy vấn, nên id của người khác không dùng được. */
  id: string;
  campaign: string;
  website: string;
  /** Đường dẫn trang đích (không token, không query). */
  trangDich: string;
  loai: "LINK" | "QR" | "CODE";
  nhan: string | null;
  hoatDong: boolean;
  /** Link đang ACTIVE nhưng chuỗi hiện không dùng được ⇒ câu cho đối tác. */
  lyDoKhongDung: string | null;
  soLuotBam: number;
  soLuotBamLoi: number;
  /** Referral HỢP LỆ đã gắn vào link này (khách để lại thông tin qua link). */
  soReferral: number;
  /** Chỉ khi link ACTIVE — dựng từ token CỦA CHÍNH đối tác. */
  lienKetNgan: string | null;
  lienKetTrucTiep: string | null;
  /** URL CUỐI — nơi khách thật sự đến (= `lienKetTrucTiep`: định nghĩa một lần ở `docDanhSachLink`). */
  urlCuoi: string | null;
};

/** Ô chọn «Tạo link»: chương trình CỦA CHÍNH đối tác → website → trang đích «đúng». null ⇒ không có gì để chọn (giao diện nói thẳng vì sao). */
export type TaoLinkCuaToi = { chuongTrinh: ChuongTrinhChon[]; coGocLinkNgan: boolean };

export type DongReferralCuaToi = {
  /** ISO thời điểm. */
  luc: string;
  campaign: string;
  // KHÔNG có `trangThai` / `maPhieu`: mỗi cái đều là một bit «SĐT này đã có trong CRM chưa» (R10 · D1). Lưới `[D1-W*]` ghim việc không thêm lại.
};

export type DongHoaHongCuaToi = {
  luc: string;
  ky: string;
  campaign: string | null;
  loai: "Hoa hồng" | "Điều chỉnh";
  soTien: number;
  trangThaiChi: CommissionPayoutStatus;
};

/** Khối tiền hoa hồng. CHỈ tồn tại khi ít nhất một chương trình của đối tác cho phép hiện số tiền (`quyen-xem-tien.ts`); không thì `GioiThieuCuaToi.hoaHong` là null và payload không có chỗ chứa số tiền. */
export type HoaHongCuaToi = {
  theoTrangThai: Record<CommissionPayoutStatus, { soDong: number; tien: number }>;
  /** Tổng mọi dòng đã ghi sổ (kể cả điều chỉnh âm). */
  daGhiSo: number;
  /** Đang trên đường chi = `PENDING` + `APPROVED` + `EXPORTED`. KHÔNG gồm `ON_HOLD` (đang giữ vì thiếu hồ sơ — tách riêng ở `dangGiu`, không hứa là «chờ chi»). */
  choChi: number;
  daChi: number;
  /** `ON_HOLD`: tiền của đối tác TỔ CHỨC chưa đủ hồ sơ để chi (AFF-L2, D-B). 0 với đối tác cá nhân. */
  dangGiu: number;
  gan: DongHoaHongCuaToi[];
};

export type GioiThieuCuaToi = {
  doiTac: HoSoDoiTac[];
  link: LinkCuaToi[];
  taoLink: TaoLinkCuaToi;
  luotBam: { hopLe: number; khongDung: number };
  /** `tong` = MỌI lượt gửi (không phân loại). `daDangKy` = khách đã ghi danh — kết quả kinh doanh, không phải trạng thái của lượt gửi. */
  referral: { tong: number; daDangKy: number; gan: DongReferralCuaToi[] };
  /** null = KHÔNG chương trình nào cho đối tác thấy số tiền (cấu hình `partnerCanViewAmount`) — khi đó cổng chỉ có trạng thái referral. */
  hoaHong: HoaHongCuaToi | null;
  /** true = `hoaHong` CHỈ gồm các chương trình được phép hiện tiền; còn chương trình khác có số tiền bị ẩn (không nói là bao nhiêu). Ngược lại luôn false. */
  hoaHongMotPhan: boolean;
};

/** Tổng «chờ chi» / «đã chi» / «đã ghi sổ» từ bảng theo trạng thái — MỘT định nghĩa cho cả trang và test. */
export function tomTatHoaHong(theo: Record<CommissionPayoutStatus, { soDong: number; tien: number }>): { daGhiSo: number; choChi: number; daChi: number; dangGiu: number } {
  const daChi = theo.PAID.tien;
  const choChi = theo.PENDING.tien + theo.APPROVED.tien + theo.EXPORTED.tien;
  const dangGiu = theo.ON_HOLD.tien;
  // «Đã ghi sổ» = MỌI dòng đã vào sổ, kể cả phần đang giữ — thiếu nó, đối tác tổ chức thấy tổng ghi sổ thấp hơn thật.
  return { daGhiSo: daChi + choChi + dangGiu, choChi, daChi, dangGiu };
}
