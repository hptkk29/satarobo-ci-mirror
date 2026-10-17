/**
 * lib/affiliate/cua-toi.ts — LÕI THUẦN của trang `/portal/gioi-thieu` (AFF-P3 H3): nhãn dành cho ĐỐI TÁC (không phải nhãn vận hành) và hình dạng dữ liệu đưa xuống giao diện.
 *
 * ── Cái gì KHÔNG bao giờ có trong các kiểu dưới đây (đó là hợp đồng, không phải sơ suất) ───────────────────────
 *  · tên / SĐT / email của KHÁCH — referral chỉ có mã rút gọn của phiếu (và chỉ khi lượt đó HỢP LỆ, tức phiếu là của chính đối tác);
 *  · id nội bộ (đối tác, campaign, lead, đơn, học viên), `sourceSnapshot`, `resolutionReason` (mang tín hiệu chống gian lận / tự giới thiệu), nguồn / chính sách / tỉ lệ hoa hồng;
 *  · token của link người khác — `LinkCuaToi` chỉ mang địa chỉ dựng từ token CỦA CHÍNH đối tác.
 * Nhãn trạng thái referral cố ý KHÁC `NHAN_TRANG_THAI_REFERRAL` (nhãn của người vận hành, nói cả lý do kỹ thuật).
 */
import type { CommissionPayoutStatus } from "@prisma/client";

import type { ChuongTrinhChon } from "./doc-link";
import { TRANG_THAI_REFERRAL, type DemTheoTrangThaiReferral, type TrangThaiReferral } from "./ghi-referral-dau-vao";

export { TRANG_THAI_REFERRAL };

/** Nhãn cho ĐỐI TÁC: nói điều họ cần biết, không nói vì sao hệ thống chặn (tránh dạy cách lách). */
export const NHAN_REFERRAL_DOI_TAC: Readonly<Record<TrangThaiReferral, string>> = {
  VALID: "Đã ghi nhận",
  MANUAL_REVIEW: "Đang chờ xem xét",
  REJECTED: "Không được ghi nhận",
  // Cùng nhãn với REJECTED (reviewer Affiliate 14/10/2026, HIGH): nhãn riêng cho «trùng» làm cổng đối tác thành BỘ DÒ — gửi SĐT bằng token của mình rồi xem dòng nào
  // «đã có người giới thiệu» là biết số đó ĐÃ có trong CRM, và số nào còn «trống» để khoá trước. Đối tác chỉ cần biết «không được ghi nhận».
  REJECTED_DUPLICATE: "Không được ghi nhận",
  DISPUTED: "Đang xem xét khiếu nại",
};

/**
 * R9 · N1 — số ngày KẾT QUẢ của một lượt gửi biểu mẫu chưa được báo cho đối tác. Trong thời gian này MỌI lượt (hợp lệ · trùng · bị từ chối · xem tay) cùng hiện «Đang chờ xem xét» và không có mã hồ sơ.
 * Lý do: «đã ghi nhận» hay «không được ghi nhận» cho một SĐT đối tác tự gửi bằng token của mình chính là câu trả lời cho «số này ĐÃ CÓ trong CRM chưa» — gửi thử hàng loạt số rồi đọc cổng là dò được
 * danh sách khách của công ty. Chờ N ngày không đóng kênh (kẻ kiên nhẫn vẫn đọc được) mà đưa chi phí từ «tức thì» lên «mỗi vòng một tuần», đủ để việc dò hàng loạt hết giá trị; kết quả CÓ NGHĨA với
 * đối tác (có được hoa hồng không) vẫn hiện đầy đủ sau đó. Đổi con số này là đổi quyết định bảo mật — ghi ở docs/source-commission/12 §11.8.
 */
import { MS_AN_KET_QUA_REFERRAL, NGAY_AN_KET_QUA_REFERRAL } from "./an-ket-qua";

export { MS_AN_KET_QUA_REFERRAL, NGAY_AN_KET_QUA_REFERRAL };

/** Lượt gửi `taoLuc` còn trong thời gian che kết quả không. `now` BẮT BUỘC (luật 19). */
export function conDangAnKetQua(taoLuc: Date, now: Date): boolean {
  return now.getTime() - taoLuc.getTime() < MS_AN_KET_QUA_REFERRAL;
}

/**
 * Trạng thái hiển thị cho ĐỐI TÁC: `REJECTED_DUPLICATE` gộp vào `REJECTED` (không lộ lý do «trùng» — xem nhãn ở trên); lượt gửi còn MỚI (`dangAn` — `conDangAnKetQua`) gộp mọi kết quả vào
 * `MANUAL_REVIEW` («Đang chờ xem xét»). `DISPUTED` do chính đối tác khởi tạo nên không che. `dangAn` BẮT BUỘC (luật 7): quên truyền là `tsc` đỏ, không phải một cổng che lặng lẽ không bao giờ chạy.
 * Dùng cho MỌI nơi cổng đối tác đếm hoặc liệt kê trạng thái.
 */
export function trangThaiHienChoDoiTac(t: TrangThaiReferral, dangAn: boolean): TrangThaiReferral {
  if (t === "DISPUTED") return t;
  if (dangAn) return "MANUAL_REVIEW";
  return t === "REJECTED_DUPLICATE" ? "REJECTED" : t;
}

/** Các trạng thái có «ô đếm» riêng ở cổng đối tác — không gồm `REJECTED_DUPLICATE` (đã gộp). */
export const TRANG_THAI_DEM_CHO_DOI_TAC: readonly TrangThaiReferral[] = TRANG_THAI_REFERRAL.filter((t) => t !== "REJECTED_DUPLICATE");

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
  trangThai: TrangThaiReferral;
  /** Mã rút gọn của phiếu khách — CHỈ khi lượt HỢP LỆ (phiếu là của chính đối tác). Khác ⇒ null (REJECTED_DUPLICATE trỏ phiếu của người KHÁC). */
  maPhieu: string | null;
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
  referral: { theoTrangThai: DemTheoTrangThaiReferral; tong: number; daDangKy: number; gan: DongReferralCuaToi[] };
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
