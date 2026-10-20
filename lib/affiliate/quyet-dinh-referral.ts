// lib/affiliate/quyet-dinh-referral.ts — MỘT LƯỢT GỬI BIỂU MẪU QUA LINK GIỚI THIỆU: ghi nhận, từ chối hay chuyển xem tay. THUẦN: không DB, không đồng hồ (`now` là tham số — luật 19).
//
// Đặc tả Affiliate §19 (cửa sổ cookie), §50 (gian lận), §51–§52 (tự giới thiệu), §44–§46 (nguồn giải từ cấu hình, không bao giờ rơi âm thầm về UNKNOWN).
// Tầng gọi (`nhan-referral.ts`) lo ĐỌC — chuỗi link, đối tác, campaign, danh tính khách; ở đây chỉ QUYẾT. Thứ tự là một phần của luật, và lý do ĐẦU TIÊN là thứ người vận hành đọc:
//
//   1. chuỗi link không hợp lệ (thu hồi · đối tác/membership/campaign/website không hoạt động…)  ⇒ TỪ CHỐI
//   2. đã có click mà quá cửa sổ cookie của campaign                                               ⇒ TỪ CHỐI
//   3. tự giới thiệu (campaign không cho phép)                                                      ⇒ TỪ CHỐI
//   4. biểu mẫu gửi từ tên miền NGOÀI danh sách website của link (token bị mang sang trang lạ)       ⇒ XEM TAY (Origin chỉ là tín hiệu phụ: có thể vắng, có thể bị giả — nên không tự từ chối)
//   5. không giải được nguồn từ cấu hình                                                            ⇒ XEM TAY (không đoán nguồn)
//   6. còn lại                                                                                      ⇒ HỢP LỆ, mang nguồn đã giải
//
// Lead của khách LUÔN được tạo (T4: lỗi ở bước quy nguồn không được làm mất khách) — kết quả chỉ quyết có ghi người giới thiệu hay không.
// Click vắng (link trực tiếp / cookie bị chặn) KHÔNG bị coi là quá hạn: không có mốc để đo thì không có cớ từ chối.
import { trongCuaSoCookie } from "./lien-ket-hop-le";
import type { KetQuaKiemChuoi, MaChuoiLinkKhongHopLe } from "./ghi-link-dau-vao";
import type { KetQuaGiaiNguon, TuDauGiaiNguon } from "./giai-nguon";
import type { CanCuTuGioiThieu } from "./tu-gioi-thieu";

export type MaTuChoiReferral = "LINK_KHONG_HOP_LE" | "NGOAI_CUA_SO_COOKIE" | "TU_GIOI_THIEU";

export const NHAN_TU_CHOI_REFERRAL: Readonly<Record<MaTuChoiReferral, string>> = {
  LINK_KHONG_HOP_LE: "Link/mã giới thiệu không còn hợp lệ lúc gửi biểu mẫu.",
  NGOAI_CUA_SO_COOKIE: "Lần bấm link đã quá cửa sổ ghi nhận của campaign.",
  TU_GIOI_THIEU: "Người giới thiệu và khách là cùng một người (campaign không cho phép tự giới thiệu).",
};

export type DauVaoQuyetDinhReferral = {
  chuoi: KetQuaKiemChuoi;
  /** `clickAt` null ⇒ không có mốc bấm (link trực tiếp) — không đo cửa sổ cookie. */
  cookie: { clickAt: Date | null; cookieWindowDays: number };
  tuGioiThieu: { chan: boolean; canCu: readonly CanCuTuGioiThieu[] };
  nguon: KetQuaGiaiNguon;
  /**
   * Header Origin của lượt gửi so với `allowedDomains` của website: KHOP · LECH (có Origin nhưng ngoài danh sách) · VANG (không có — máy chủ-máy chủ, trình duyệt cũ…).
   * BẮT BUỘC khai (luật 7): quên truyền là `tsc` đỏ, không phải một cổng lặng lẽ không bao giờ chạy.
   */
  origin: "KHOP" | "LECH" | "VANG";
  now: Date;
};

export type QuyetDinhReferral =
  | { loai: "HOP_LE"; sourceGroupId: string; tuDau: TuDauGiaiNguon; canCuTuGioiThieu: readonly CanCuTuGioiThieu[] }
  | { loai: "TU_CHOI"; ma: MaTuChoiReferral; chiTiet: string; maLink: MaChuoiLinkKhongHopLe | null; canCuTuGioiThieu: readonly CanCuTuGioiThieu[] }
  | { loai: "XEM_TAY"; lyDo: string; canCuTuGioiThieu: readonly CanCuTuGioiThieu[] };

export function quyetDinhReferral(v: DauVaoQuyetDinhReferral): QuyetDinhReferral {
  const canCu = v.tuGioiThieu.canCu;

  if (!v.chuoi.ok) {
    return { loai: "TU_CHOI", ma: "LINK_KHONG_HOP_LE", chiTiet: v.chuoi.ma, maLink: v.chuoi.ma, canCuTuGioiThieu: canCu };
  }
  if (v.cookie.clickAt !== null && !trongCuaSoCookie(v.cookie.clickAt, v.now, v.cookie.cookieWindowDays)) {
    return { loai: "TU_CHOI", ma: "NGOAI_CUA_SO_COOKIE", chiTiet: `Cửa sổ ${v.cookie.cookieWindowDays} ngày`, maLink: null, canCuTuGioiThieu: canCu };
  }
  if (v.tuGioiThieu.chan) {
    return { loai: "TU_CHOI", ma: "TU_GIOI_THIEU", chiTiet: canCu.join(", "), maLink: null, canCuTuGioiThieu: canCu };
  }
  if (v.origin === "LECH") {
    return { loai: "XEM_TAY", lyDo: "Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu.", canCuTuGioiThieu: canCu };
  }
  if (v.nguon.sourceGroupId === null) {
    return { loai: "XEM_TAY", lyDo: v.nguon.lyDo, canCuTuGioiThieu: canCu };
  }
  return { loai: "HOP_LE", sourceGroupId: v.nguon.sourceGroupId, tuDau: v.nguon.tu, canCuTuGioiThieu: canCu };
}

/** Trạng thái `AffiliateReferralStatus` ghi lúc TẠO từ quyết định (trước khi đối chiếu kết quả quy nguồn thật của lead). */
export function trangThaiTuQuyetDinh(q: QuyetDinhReferral): "VALID" | "REJECTED" | "MANUAL_REVIEW" {
  return q.loai === "HOP_LE" ? "VALID" : q.loai === "TU_CHOI" ? "REJECTED" : "MANUAL_REVIEW";
}

/**
 * Sau khi lead đã được quy nguồn: luật `AFFILIATE_REFERRAL` có THẬT SỰ thắng không. Hợp lệ ≠ thắng — khách đã có hồ sơ cũ thì nguồn gốc giữ nguyên (first-claim, D3),
 * nhóm đích có thể vừa bị ngừng giữa hai lần đọc, hoặc cờ con `referral` tắt. Hàm trả trạng thái CUỐI của dòng referral.
 */
export function trangThaiSauQuyNguon(p: {
  quyetDinh: QuyetDinhReferral;
  /** Kết quả đọc từ attribution của lead; null ⇒ không đọc được (nguồn bị tắt giữa chừng). */
  attribution: { matchedRule: string; referrerAffiliateId: string | null } | null;
  partyId: string;
}): { status: "VALID" | "REJECTED_DUPLICATE" | "REJECTED" | "MANUAL_REVIEW"; lyDo: string | null } {
  const q = p.quyetDinh;
  if (q.loai === "TU_CHOI") return { status: "REJECTED", lyDo: `${q.ma}:${q.chiTiet}` };
  if (q.loai === "XEM_TAY") return { status: "MANUAL_REVIEW", lyDo: q.lyDo };

  const a = p.attribution;
  if (a === null) return { status: "MANUAL_REVIEW", lyDo: "Không đọc được kết quả quy nguồn của lead." };
  if (a.matchedRule === "AFFILIATE_REFERRAL" && a.referrerAffiliateId === p.partyId) return { status: "VALID", lyDo: null };
  if (a.matchedRule === "KE_THUA_SDT") return { status: "REJECTED_DUPLICATE", lyDo: "Khách đã có nguồn gốc từ hồ sơ trước — giữ người ghi nhận đầu tiên." };
  return { status: "MANUAL_REVIEW", lyDo: `Luật quy nguồn của lead không chọn người giới thiệu này (luật thắng: ${a.matchedRule}).` };
}
