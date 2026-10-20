/**
 * lib/affiliate/ghi-link-dau-vao.ts — LUẬT PHÁT / THU HỒI / XOAY LINK-QR-MÃ GIỚI THIỆU, PHẦN THUẦN (AFF-P1, docs/source-commission/12 §2.3, §2.6). Không `db`, không đồng hồ (`now` là tham số), không `"use server"`.
 *
 * Tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC; `ghi-link.ts` đọc DB rồi ghi. Tách để mọi nhánh luật test được không cần Postgres và để giao diện import được mà không kéo mã máy chủ.
 *
 * ── MỘT chỗ dựng đầu vào của `kiemLienKet` (luật 12b) ───────────────────────────────────────────────────────────────────
 * `kiemChuoiLink` là CỔNG DUY NHẤT hỏi «chuỗi (link · đối tác · membership · campaign · website · trang đích) có hợp lệ không». Bốn nơi gọi — phát link, xoay mã, `GET /r/:token`, beacon —
 * đều đi qua nó; không nơi nào tự dựng `DauVaoKiemLienKet`. `trangDichConHieuLuc` luôn tính bằng `khopDuongDan` trên các trang đích ĐANG BẬT của website.
 *
 * AFF-L6: danh sách trang đích trong `ChuoiLink` đã được GIẢI HOST và THU HẸP THEO CAMPAIGN (`trang-dich-hieu-luc.ts`, MỘT hàm cho mọi nơi dựng chuỗi) — cổng này chỉ việc hỏi «link ở
 * (tên miền, đường dẫn) này còn khớp một trang đích đang bật không», nên campaign thu hẹp / trang đích tắt / tên miền bị gỡ khỏi website đều thành `TRANG_DICH_KHONG_CON` mà không cần mã mới.
 *
 * `kiemLienKet` (hàm dùng chung) KHÔNG có mã cho «website đã bị gỡ khỏi campaign sau khi link được phát». Không sửa tệp đó — kiểm thêm ở ĐÂY bằng mã cục bộ `SITE_KHONG_GAN_CAMPAIGN`
 * (xem báo cáo: câu hỏi mở). Mã này vẫn khớp `ReferralClick_outcome_chk` (`^[A-Z_]{2,40}$`).
 */
import { z } from "zod";
import { kiemLienKet, NHAN_LIEN_KET_KHONG_HOP_LE, type DauVaoKiemLienKet, type MaLienKetKhongHopLe, type TrangThaiCampaign, type TrangThaiDoiTac, type TrangThaiThanhVien } from "./lien-ket-hop-le";
import { trangDichKhopLink, type TrangDichChuoi } from "./trang-dich-hieu-luc";
import { hostCuaBaseUrl, hostTrongDanhSach, kiemUrlDuocPhep, nhanLyDo } from "./website-hop-le";

// ── Hằng có tên ─────────────────────────────────────────────────────────────────────────────────────────────

/** Mỗi (đối tác × campaign) tối đa N link ĐANG HOẠT ĐỘNG. Thu hồi thì không tính. (Đối tác × campaign ⇔ một membership: `@@unique([partyId, campaignId])`.) */
export const SO_LINK_HOAT_DONG_TOI_DA = 50;
/** Số lần thử lại khi sinh token đụng khoá duy nhất. KHÔNG vòng vô hạn. */
export const SO_LAN_THU_TOKEN = 5;
export const LY_DO_TOI_THIEU_LINK = 10;
export const DO_DAI_NHAN_LINK_TOI_DA = 120;
export const DO_DAI_DUONG_DAN_LINK_TOI_DA = 300;

export const LOAI_LINK = ["LINK", "QR", "CODE"] as const;
export type LoaiLink = (typeof LOAI_LINK)[number];
export const NHAN_LOAI_LINK: Readonly<Record<LoaiLink, string>> = { LINK: "Link", QR: "QR", CODE: "Mã" };

export const TRANG_THAI_LINK = ["ACTIVE", "REVOKED"] as const;
export type TrangThaiLink = (typeof TRANG_THAI_LINK)[number];
export const NHAN_TRANG_THAI_LINK: Readonly<Record<TrangThaiLink, string>> = { ACTIVE: "Đang hoạt động", REVOKED: "Đã thu hồi" };

// ── Chuỗi quan hệ của một link + cổng hợp lệ duy nhất ──────────────────────────────────────────────────────────

export type ChuoiLink = {
  /** `landingHost`: tên miền ĐÍCH đã giải của link (ảnh chụp lúc phát; link cũ chưa có ⇒ tên miền của `baseUrl`). */
  taiSan: { status: TrangThaiLink; landingPath: string; landingHost: string };
  doiTac: { status: TrangThaiDoiTac };
  thanhVien: { status: TrangThaiThanhVien; effectiveFrom: Date; effectiveTo: Date | null };
  campaign: { code: string; status: TrangThaiCampaign; effectiveFrom: Date | null; effectiveTo: Date | null; cookieWindowDays: number };
  /** Website có còn được GẮN với campaign không (`AffiliateCampaignSite`). */
  campaignGanSite: boolean;
  site: { baseUrl: string; allowedDomains: readonly string[]; status: "ACTIVE" | "INACTIVE"; trackingEnabled: boolean };
  /** Các trang đích của website đã giải host và thu hẹp theo campaign (`trangDichHieuLuc`) — kể cả đang tắt; cổng tự lọc bật/tắt + theo dõi. */
  trangDich: readonly TrangDichChuoi[];
};

export const MA_SITE_KHONG_GAN_CAMPAIGN = "SITE_KHONG_GAN_CAMPAIGN" as const;
export type MaChuoiLinkKhongHopLe = MaLienKetKhongHopLe | typeof MA_SITE_KHONG_GAN_CAMPAIGN;

export const NHAN_CHUOI_LINK_KHONG_HOP_LE: Readonly<Record<MaChuoiLinkKhongHopLe, string>> = {
  ...NHAN_LIEN_KET_KHONG_HOP_LE,
  SITE_KHONG_GAN_CAMPAIGN: "Website này không còn được gắn vào campaign.",
};

/** Dựng đầu vào của `kiemLienKet` từ chuỗi. MỌI nơi dùng hàm này — không nơi nào tự dựng. */
export function dungDauVaoKiemLienKet(c: ChuoiLink): DauVaoKiemLienKet {
  return {
    taiSan: { status: c.taiSan.status },
    doiTac: { status: c.doiTac.status },
    thanhVien: c.thanhVien,
    campaign: { status: c.campaign.status, effectiveFrom: c.campaign.effectiveFrom, effectiveTo: c.campaign.effectiveTo },
    website: { status: c.site.status, trackingEnabled: c.site.trackingEnabled },
    // Tên miền đích còn nằm trong danh sách của website (Admin có thể gỡ một tên miền SAU khi link đã phát) ∧ còn khớp một trang đích đang bật CÓ ĐÚNG tên miền đó.
    trangDichConHieuLuc: hostTrongDanhSach(c.site.allowedDomains, c.taiSan.landingHost) && trangDichKhopLink(c.trangDich, c.taiSan.landingHost, c.taiSan.landingPath),
  };
}

export type KetQuaKiemChuoi = { ok: true } | { ok: false; ma: MaChuoiLinkKhongHopLe; tatCa: readonly MaChuoiLinkKhongHopLe[] };

/** Chuỗi có hợp lệ không: `kiemLienKet` (mã dùng chung, thứ tự cố định) rồi «website còn gắn campaign». */
export function kiemChuoiLink(c: ChuoiLink, now: Date): KetQuaKiemChuoi {
  const kq = kiemLienKet(dungDauVaoKiemLienKet(c), now);
  const tatCa: MaChuoiLinkKhongHopLe[] = kq.ok ? [] : [...kq.tatCa];
  if (!c.campaignGanSite) tatCa.push(MA_SITE_KHONG_GAN_CAMPAIGN);
  if (tatCa.length === 0) return { ok: true };
  return { ok: false, ma: tatCa[0]!, tatCa };
}

// ── Token: che cho người chỉ XEM ────────────────────────────────────────────────────────────────────────────

/** 4 ký tự đầu + «…». Dùng ở TẦNG ĐỌC cho người không có `affiliate_links:manage`: payload không bao giờ mang token đầy đủ. */
export function anToken(token: string): string {
  return `${token.slice(0, 4)}…`;
}

// ── Zod ─────────────────────────────────────────────────────────────────────────────────────────────────────

const idChuoi = (nhan: string) => z.string().trim().min(1, `Chọn ${nhan}.`).max(64);

export const phatLinkSchema = z
  .object({
    partyId: idChuoi("đối tác"),
    membershipId: idChuoi("chương trình (campaign) của đối tác"),
    siteId: idChuoi("website"),
    landingPath: z.string().max(DO_DAI_DUONG_DAN_LINK_TOI_DA, "Đường dẫn quá dài."),
    /** Trang đích đã chọn (tên miền suy từ DÒNG này ở máy chủ — KHÔNG nhận tên miền từ client). Vắng ⇒ tên miền của website. */
    landingPageId: z.string().trim().min(1).max(64).nullable().optional(),
    type: z.enum(LOAI_LINK, { message: "Chọn loại: Link, QR hoặc Mã." }),
    label: z
      .string()
      .trim()
      .max(DO_DAI_NHAN_LINK_TOI_DA, `Nhãn tối đa ${DO_DAI_NHAN_LINK_TOI_DA} ký tự.`)
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  })
  .strict();
export type DauVaoPhatLink = z.infer<typeof phatLinkSchema>;

export type LoiTruong = { ok: false; loi: string; truong: string };

/**
 * Đường dẫn đích người dùng chọn/nhập: bắt đầu `/`, không `?`/`#` (tham số do hệ thống gắn). Chuẩn hoá thật (host, trang đích khớp) do `kiemPhatLink` — qua `kiemUrlDuocPhep`.
 */
export function kiemDuongDanLink(raw: string): { ok: true; duongDan: string } | LoiTruong {
  const d = raw.trim();
  if (d === "") return { ok: false, loi: "Chọn hoặc nhập đường dẫn trang đích.", truong: "landingPath" };
  if (!d.startsWith("/")) return { ok: false, loi: "Đường dẫn phải bắt đầu bằng dấu / (ví dụ /khoa-robotics).", truong: "landingPath" };
  if (d.includes("?") || d.includes("#")) return { ok: false, loi: "Đường dẫn không kèm dấu ? hoặc # — tham số theo dõi do hệ thống gắn.", truong: "landingPath" };
  return { ok: true, duongDan: d };
}

export type TruTinPhatLink = {
  /** `partyId` mà người phát chọn. */
  partyId: string;
  /** Đối tác thật của membership đọc từ DB. */
  membershipPartyId: string;
  chuoi: Omit<ChuoiLink, "taiSan">;
  duongDan: string;
  /** Trang đích người phát chọn, hoặc null ⇒ tự tìm trang đích khớp trên tên miền của website. BẮT BUỘC khai (luật 7). */
  landingPageId: string | null;
  /** Số link ĐANG HOẠT ĐỘNG hiện có của membership (đếm SAU khoá hàng membership). */
  soLinkDangChay: number;
  /** Xoay mã: thu hồi một + tạo một ⇒ không tăng số link, không bị cổng số lượng chặn. */
  laXoay: boolean;
};

export type KetQuaKiemPhat = { ok: true; landingPath: string; landingHost: string; landingPageId: string } | LoiTruong;

/**
 * Cổng PHÁT link (và dựng link mới khi xoay). Thứ tự: membership thuộc đúng đối tác → website gắn campaign → URL dựng ra qua `kiemUrlDuocPhep` (host ∈ tên miền, trang đích khớp)
 * → `kiemChuoiLink` (CÙNG hàm với lúc khách bấm) → hạn mức. Trả `landingPath` đã chuẩn hoá để ghi.
 */
export function kiemPhatLink(p: TruTinPhatLink, now: Date): KetQuaKiemPhat {
  if (p.partyId !== p.membershipPartyId) {
    return { ok: false, loi: "Chương trình này không thuộc đối tác đã chọn.", truong: "membershipId" };
  }
  if (!p.chuoi.campaignGanSite) {
    return { ok: false, loi: "Website này không được gắn vào campaign của chương trình đã chọn — gắn website vào campaign ở tab Campaign trước.", truong: "siteId" };
  }
  // Tên miền đích: của TRANG ĐÍCH đã chọn (suy từ dòng DB, không từ client); không chọn ⇒ tên miền của website.
  let host: string | null;
  let ungVien: readonly TrangDichChuoi[];
  if (p.landingPageId !== null) {
    const t = p.chuoi.trangDich.find((x) => x.id === p.landingPageId);
    if (!t) {
      return { ok: false, loi: "Trang đích đã chọn không thuộc website này hoặc campaign không cho dùng trang đó.", truong: "landingPageId" };
    }
    host = t.host === "" ? null : t.host;
    ungVien = [t];
  } else {
    host = hostCuaBaseUrl(p.chuoi.site.baseUrl);
    ungVien = p.chuoi.trangDich;
  }
  if (host === null) return { ok: false, loi: "Gốc URL của website không đọc được — sửa website trước.", truong: "siteId" };
  const url = kiemUrlDuocPhep(`https://${host}${p.duongDan}`, p.chuoi.site, ungVien);
  if (!url.ok) {
    return { ok: false, loi: url.lyDo === "KHONG_CO_TRANG_DICH" ? "Đường dẫn này chưa có trang đích nào đang bật khớp với nó — thêm trang đích ở tab Website." : nhanLyDo(url.lyDo), truong: "landingPath" };
  }
  const chuoi: ChuoiLink = { ...p.chuoi, taiSan: { status: "ACTIVE", landingPath: url.path, landingHost: url.host } };
  const kq = kiemChuoiLink(chuoi, now);
  if (!kq.ok) return { ok: false, loi: NHAN_CHUOI_LINK_KHONG_HOP_LE[kq.ma], truong: kq.ma === "DOI_TAC_KHONG_HOAT_DONG" ? "partyId" : kq.ma.startsWith("THANH_VIEN") ? "membershipId" : "chung" };
  if (!p.laXoay && p.soLinkDangChay >= SO_LINK_HOAT_DONG_TOI_DA) {
    return {
      ok: false,
      loi: `Đối tác này đã có ${p.soLinkDangChay} link đang hoạt động trong campaign (tối đa ${SO_LINK_HOAT_DONG_TOI_DA}). Thu hồi bớt link không dùng rồi phát tiếp.`,
      truong: "chung",
    };
  }
  return { ok: true, landingPath: url.path, landingHost: url.host, landingPageId: url.trang.id };
}

export type KetQuaKiemThuHoi = { ok: true } | LoiTruong;

/** Cổng THU HỒI / XOAY: link phải còn ACTIVE; lý do ≥ 10 ký tự. */
export function kiemThuHoi(p: { status: TrangThaiLink; lyDo: string | null }): KetQuaKiemThuHoi {
  if (p.status === "REVOKED") return { ok: false, loi: "Link này đã được thu hồi rồi.", truong: "trangThai" };
  if ((p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_LINK) {
    return { ok: false, loi: `Ghi lý do thu hồi (tối thiểu ${LY_DO_TOI_THIEU_LINK} ký tự).`, truong: "lyDo" };
  }
  return { ok: true };
}
