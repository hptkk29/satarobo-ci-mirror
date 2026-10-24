// lib/affiliate/lien-ket-hop-le.ts — MỘT LINK / MÃ GIỚI THIỆU CÓ ĐANG HỢP LỆ KHÔNG. THUẦN: không DB, không đồng hồ (`now` là tham số — luật 19).
//
// Đặc tả Affiliate §31 (điều kiện TẠO link), §43 (thu hồi), §50 (gian lận: link thu hồi · membership không hoạt động · campaign hết hạn · token giả), §74 (UAT link không hợp lệ).
// MỘT hàm cho CẢ BA nơi hỏi — tạo link (người dùng bấm «Tạo link»), ghi click, nhận biểu mẫu giới thiệu. Hỏi ba nơi bằng ba điều kiện viết tay là có ngày nút «Tạo link»
// vẽ ra mà lúc khách bấm link lại bị từ chối, hoặc ngược lại (luật 12b).
//
// Thứ tự kiểm cố định và là một phần của luật: lý do ĐẦU TIÊN là thứ người vận hành cần đọc (thu hồi trước hết — admin vừa bấm, phải thấy đúng lý do đó, không phải
// «campaign hết hạn» đến sau). `tatCa` giữ MỌI lý do đang vi phạm để màn chẩn đoán nói đủ.
//
// Biên thời gian theo nếp của repo: `from ≤ t < to` (biên dưới ĐÓNG, biên trên MỞ).
//
// Trạng thái viết dạng chuỗi (không import enum từ @prisma/client) để hàm thuần dùng được ở mọi runtime và không vỡ khi client chưa sinh lại.

export type TrangThaiTaiSan = "ACTIVE" | "REVOKED";
export type TrangThaiDoiTac = "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
export type TrangThaiThanhVien = "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
export type TrangThaiCampaign = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
export type TrangThaiWebsite = "ACTIVE" | "INACTIVE";

export type DauVaoKiemLienKet = {
  taiSan: { status: TrangThaiTaiSan };
  doiTac: { status: TrangThaiDoiTac };
  thanhVien: { status: TrangThaiThanhVien; effectiveFrom: Date; effectiveTo: Date | null };
  campaign: { status: TrangThaiCampaign; effectiveFrom: Date | null; effectiveTo: Date | null };
  website: { status: TrangThaiWebsite; trackingEnabled: boolean };
  /** Đường dẫn đích của link CÒN khớp một trang đích đang bật của website không (người quản trị có thể tắt trang đích SAU khi link đã phát). */
  trangDichConHieuLuc: boolean;
};

export type MaLienKetKhongHopLe =
  | "LINK_DA_THU_HOI"
  | "DOI_TAC_KHONG_HOAT_DONG"
  | "THANH_VIEN_KHONG_HOAT_DONG"
  | "THANH_VIEN_CHUA_HIEU_LUC"
  | "THANH_VIEN_HET_HAN"
  | "CAMPAIGN_KHONG_HOAT_DONG"
  | "CAMPAIGN_CHUA_HIEU_LUC"
  | "CAMPAIGN_HET_HAN"
  | "WEBSITE_KHONG_HOAT_DONG"
  | "THEO_DOI_DANG_TAT"
  | "TRANG_DICH_KHONG_CON";

/** Thứ tự kiểm = thứ tự khai ở đây. */
export const THU_TU_MA_LIEN_KET: readonly MaLienKetKhongHopLe[] = [
  "LINK_DA_THU_HOI",
  "DOI_TAC_KHONG_HOAT_DONG",
  "THANH_VIEN_KHONG_HOAT_DONG",
  "THANH_VIEN_CHUA_HIEU_LUC",
  "THANH_VIEN_HET_HAN",
  "CAMPAIGN_KHONG_HOAT_DONG",
  "CAMPAIGN_CHUA_HIEU_LUC",
  "CAMPAIGN_HET_HAN",
  "WEBSITE_KHONG_HOAT_DONG",
  "THEO_DOI_DANG_TAT",
  "TRANG_DICH_KHONG_CON",
];

/** Câu cho NGƯỜI VẬN HÀNH (màn chẩn đoán, nhật ký). KHÔNG hiện nguyên văn cho khách bấm link — khách chỉ nhận câu chung (xem `CAU_CHUNG_CHO_KHACH`). */
export const NHAN_LIEN_KET_KHONG_HOP_LE: Readonly<Record<MaLienKetKhongHopLe, string>> = {
  LINK_DA_THU_HOI: "Link đã bị thu hồi.",
  DOI_TAC_KHONG_HOAT_DONG: "Đối tác không còn ở trạng thái hoạt động.",
  THANH_VIEN_KHONG_HOAT_DONG: "Đối tác chưa/không còn là thành viên đang hoạt động của campaign.",
  THANH_VIEN_CHUA_HIEU_LUC: "Tư cách thành viên chưa tới ngày hiệu lực.",
  THANH_VIEN_HET_HAN: "Tư cách thành viên đã hết hạn.",
  CAMPAIGN_KHONG_HOAT_DONG: "Campaign không ở trạng thái đang chạy.",
  CAMPAIGN_CHUA_HIEU_LUC: "Campaign chưa tới ngày hiệu lực.",
  CAMPAIGN_HET_HAN: "Campaign đã hết hạn.",
  WEBSITE_KHONG_HOAT_DONG: "Website không còn ở trạng thái hoạt động.",
  THEO_DOI_DANG_TAT: "Website đang tắt theo dõi giới thiệu.",
  TRANG_DICH_KHONG_CON: "Trang đích của link không còn nằm trong danh sách trang được phép.",
};

/**
 * MỘT câu cho khách bấm link/gửi biểu mẫu bằng link không hợp lệ — KHÔNG phân biệt lý do (link giả, đã thu hồi, hết hạn trông giống nhau), để không lộ token nào
 * từng tồn tại. Lead của khách VẪN được tạo bình thường (chỉ không gắn người giới thiệu).
 */
export const CAU_CHUNG_CHO_KHACH = "Liên kết giới thiệu không còn hiệu lực.";

export type KetQuaKiemLienKet = { ok: true } | { ok: false; ma: MaLienKetKhongHopLe; tatCa: readonly MaLienKetKhongHopLe[] };

const trong = (tu: Date | null, den: Date | null, t: Date): "CHUA" | "TRONG" | "HET" => {
  if (tu !== null && t.getTime() < tu.getTime()) return "CHUA";
  if (den !== null && t.getTime() >= den.getTime()) return "HET";
  return "TRONG";
};

export function kiemLienKet(v: DauVaoKiemLienKet, now: Date): KetQuaKiemLienKet {
  const loi = new Set<MaLienKetKhongHopLe>();
  if (v.taiSan.status !== "ACTIVE") loi.add("LINK_DA_THU_HOI");
  if (v.doiTac.status !== "ACTIVE") loi.add("DOI_TAC_KHONG_HOAT_DONG");

  if (v.thanhVien.status !== "ACTIVE") loi.add("THANH_VIEN_KHONG_HOAT_DONG");
  const tv = trong(v.thanhVien.effectiveFrom, v.thanhVien.effectiveTo, now);
  if (tv === "CHUA") loi.add("THANH_VIEN_CHUA_HIEU_LUC");
  if (tv === "HET") loi.add("THANH_VIEN_HET_HAN");

  if (v.campaign.status !== "ACTIVE") loi.add("CAMPAIGN_KHONG_HOAT_DONG");
  const cp = trong(v.campaign.effectiveFrom, v.campaign.effectiveTo, now);
  if (cp === "CHUA") loi.add("CAMPAIGN_CHUA_HIEU_LUC");
  if (cp === "HET") loi.add("CAMPAIGN_HET_HAN");

  if (v.website.status !== "ACTIVE") loi.add("WEBSITE_KHONG_HOAT_DONG");
  if (!v.website.trackingEnabled) loi.add("THEO_DOI_DANG_TAT");
  if (!v.trangDichConHieuLuc) loi.add("TRANG_DICH_KHONG_CON");

  if (loi.size === 0) return { ok: true };
  const tatCa = THU_TU_MA_LIEN_KET.filter((m) => loi.has(m));
  return { ok: false, ma: tatCa[0]!, tatCa };
}

const NGAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lần BẤM link (`clickAt`, giờ MÁY CHỦ) còn trong cửa sổ cookie của campaign tại lúc gửi biểu mẫu không. Cookie chỉ là TÍN HIỆU phía khách; cửa sổ thật đo ở đây
 * (đặc tả §19: `cookieWindowDays` là tham số campaign, không phải hằng 30). `0 ≤ now − clickAt < ngày × 86 400 000`; mốc trong TƯƠNG LAI (đồng hồ lệch/giả) ⇒ không hợp lệ.
 */
export function trongCuaSoCookie(clickAt: Date, now: Date, cookieWindowDays: number): boolean {
  if (!Number.isFinite(cookieWindowDays) || cookieWindowDays < 1) return false;
  const tuoi = now.getTime() - clickAt.getTime();
  return tuoi >= 0 && tuoi < cookieWindowDays * NGAY_MS;
}
