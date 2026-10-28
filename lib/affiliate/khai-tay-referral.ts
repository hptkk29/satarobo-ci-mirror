// lib/affiliate/khai-tay-referral.ts — KHAI TAY MỘT REFERRAL NGOÀI ĐỜI (AFF-L3b): đầu vào, cổng hợp lệ, khoá chống trùng. THUẦN: không DB, không đồng hồ (`now` là tham số — luật 19), client-safe.
//
// Người có `affiliate_referrals:manage` ghi một lượt giới thiệu không đi qua link/QR/mã (khách đứng quầy nói «chị A giới thiệu», sự kiện ngoài trời…). Khai tay KHÔNG phải đường tắt:
//   · chỉ nhận BỐN thứ — đối tác, campaign, khách, cách đến — cộng lý do và bằng chứng. KHÔNG có ô tiền, tỉ lệ, nguồn: schema `.strict()` từ chối mọi khoá lạ (`soTien`, `tiLe`, `sourceGroupId`…),
//     nguồn do `giaiNguonCuaDoiTac` giải từ cấu hình campaign, hoa hồng do engine giải từ chính sách;
//   · luôn vào MANUAL_REVIEW rồi cần DUYỆT (cùng đường với lượt tự động cần xem tay) — khai xong KHÔNG tự chiếm attribution của khách;
//   · cùng cổng với link: đối tác ACTIVE · thành viên ACTIVE và trong hiệu lực · campaign ACTIVE và trong hiệu lực · không tự giới thiệu (nếu campaign cấm).
import { z } from "zod";
import { kiemLienKet, NHAN_LIEN_KET_KHONG_HOP_LE, type MaLienKetKhongHopLe, type TrangThaiCampaign, type TrangThaiDoiTac, type TrangThaiThanhVien } from "./lien-ket-hop-le";
import { GHI_CHU_TOI_DA, LY_DO_TOI_DA, LY_DO_TOI_THIEU, chuaPiiKhach } from "./xu-ly-referral";

export const CACH_KHAI_TAY = ["MANUAL", "OFFLINE"] as const;
export type CachKhaiTay = (typeof CACH_KHAI_TAY)[number];

export const NHAN_CACH_KHAI_TAY: Readonly<Record<CachKhaiTay, string>> = {
  MANUAL: "Khai tay (nhận qua điện thoại, tin nhắn…)",
  OFFLINE: "Ngoại tuyến (gặp trực tiếp, sự kiện…)",
};

const id = (nhan: string) => z.string().trim().min(1, `Chọn ${nhan}.`).max(64);

const vanBan = (nhan: string, toiDa: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(LY_DO_TOI_THIEU, `${nhan} phải từ ${LY_DO_TOI_THIEU} ký tự.`)
        .max(toiDa, `${nhan} tối đa ${toiDa} ký tự.`)
        .refine((v) => !chuaPiiKhach(v), `${nhan} không được chứa số điện thoại hoặc email của khách — ghi mã phiếu / số biên nhận thay vào.`),
    );

/**
 * `.strict()` là một phần của luật: khoá lạ (`soTien`, `hoaHong`, `tiLe`, `sourceGroupId`, `status`…) bị TỪ CHỐI, không bị lặng lẽ bỏ qua.
 * Người gọi trực tiếp action với thứ tự ý «nhập số tiền hoa hồng» phải nhận lỗi, không phải một lượt khai tay trông như đã nhận.
 */
export const khaiTayReferralSchema = z
  .object({
    partyId: id("đối tác"),
    campaignId: id("campaign"),
    leadId: id("khách (phiếu)"),
    method: z.enum(CACH_KHAI_TAY, { message: "Chọn cách đến: khai tay hoặc ngoại tuyến." }),
    lyDo: vanBan("Lý do", LY_DO_TOI_DA),
    ghiChu: vanBan("Ghi chú bằng chứng", GHI_CHU_TOI_DA),
  })
  .strict();
export type DauVaoKhaiTayReferral = z.infer<typeof khaiTayReferralSchema>;

// ── Cổng ─────────────────────────────────────────────────────────────────────────────────────────

export type MaKhaiTayTuChoi =
  | MaLienKetKhongHopLe
  | "DOI_TAC_KHONG_TIM_THAY"
  | "CAMPAIGN_KHONG_TIM_THAY"
  | "PHIEU_KHONG_TIM_THAY"
  | "CHUA_LA_THANH_VIEN"
  | "TU_GIOI_THIEU"
  | "DA_CO_LUOT_DANG_SONG";

/** Mã của `kiemLienKet` mà đường khai tay có thể gặp (không có link/website ở đây). */
const MA_LIEN_KET_CUA_KHAI_TAY: readonly MaLienKetKhongHopLe[] = [
  "DOI_TAC_KHONG_HOAT_DONG",
  "THANH_VIEN_KHONG_HOAT_DONG",
  "THANH_VIEN_CHUA_HIEU_LUC",
  "THANH_VIEN_HET_HAN",
  "CAMPAIGN_KHONG_HOAT_DONG",
  "CAMPAIGN_CHUA_HIEU_LUC",
  "CAMPAIGN_HET_HAN",
];

export const NHAN_KHAI_TAY_TU_CHOI: Readonly<Record<MaKhaiTayTuChoi, string>> = {
  ...NHAN_LIEN_KET_KHONG_HOP_LE,
  DOI_TAC_KHONG_TIM_THAY: "Không tìm thấy đối tác này.",
  CAMPAIGN_KHONG_TIM_THAY: "Không tìm thấy campaign này.",
  PHIEU_KHONG_TIM_THAY: "Không tìm thấy phiếu khách này (hoặc phiếu nằm ngoài cơ sở của bạn).",
  CHUA_LA_THANH_VIEN: "Đối tác này chưa là thành viên của campaign.",
  TU_GIOI_THIEU: "Người giới thiệu và khách là cùng một người, mà campaign không cho phép tự giới thiệu.",
  DA_CO_LUOT_DANG_SONG: "Khách này đã có một lượt giới thiệu của đối tác này trong campaign này đang chờ xử lý hoặc đã hợp lệ — xử lý lượt đó thay vì khai thêm.",
};

export type DauVaoKiemKhaiTay = {
  /** null ⇒ không có đối tác với id đó. */
  doiTac: { status: TrangThaiDoiTac } | null;
  /** null ⇒ không có campaign với id đó. */
  campaign: { status: TrangThaiCampaign; effectiveFrom: Date | null; effectiveTo: Date | null } | null;
  /** null ⇒ đối tác chưa có dòng thành viên trong campaign. */
  thanhVien: { status: TrangThaiThanhVien; effectiveFrom: Date; effectiveTo: Date | null } | null;
  /** Phiếu khách có thấy được (qua `scopedDb`) và chưa xoá mềm không. */
  phieuThayDuoc: boolean;
  tuGioiThieu: { chan: boolean };
  /** Đã có referral của (phiếu, đối tác, campaign) ở VALID / MANUAL_REVIEW / DISPUTED — mọi cách đến. */
  daCoLuotDangSong: boolean;
};

export type KetQuaKiemKhaiTay = { ok: true } | { ok: false; ma: MaKhaiTayTuChoi; loi: string };

/**
 * Thứ tự cố định (lý do ĐẦU TIÊN là thứ người vận hành đọc): tồn tại → phiếu → hợp lệ chuỗi (đối tác · thành viên · campaign) → tự giới thiệu → trùng.
 * Chuỗi hợp lệ dùng LẠI `kiemLienKet` (cùng cổng với phát link / nhận biểu mẫu — luật 12b) với phần link/website đặt ở giá trị trung tính: khai tay không có link nào để kiểm.
 */
export function kiemKhaiTay(v: DauVaoKiemKhaiTay, now: Date): KetQuaKiemKhaiTay {
  const tuChoi = (ma: MaKhaiTayTuChoi): KetQuaKiemKhaiTay => ({ ok: false, ma, loi: NHAN_KHAI_TAY_TU_CHOI[ma] });
  if (!v.doiTac) return tuChoi("DOI_TAC_KHONG_TIM_THAY");
  if (!v.campaign) return tuChoi("CAMPAIGN_KHONG_TIM_THAY");
  if (!v.phieuThayDuoc) return tuChoi("PHIEU_KHONG_TIM_THAY");
  if (!v.thanhVien) return tuChoi("CHUA_LA_THANH_VIEN");

  const kq = kiemLienKet(
    {
      taiSan: { status: "ACTIVE" },
      doiTac: { status: v.doiTac.status },
      thanhVien: v.thanhVien,
      campaign: v.campaign,
      website: { status: "ACTIVE", trackingEnabled: true },
      trangDichConHieuLuc: true,
    },
    now,
  );
  if (!kq.ok) {
    const ma = kq.tatCa.find((m) => MA_LIEN_KET_CUA_KHAI_TAY.includes(m));
    if (ma) return tuChoi(ma);
  }
  if (v.tuGioiThieu.chan) return tuChoi("TU_GIOI_THIEU");
  if (v.daCoLuotDangSong) return tuChoi("DA_CO_LUOT_DANG_SONG");
  return { ok: true };
}

/**
 * Khoá chống gửi lặp của lượt khai tay. `lan` = số lượt khai tay ĐÃ CÓ của cùng bộ ba (phiếu · đối tác · campaign) + 1, đếm DƯỚI khoá giao dịch.
 * Vì sao có `lan`: `idempotencyKey` là UNIQUE vĩnh viễn — khoá cố định theo bộ ba thì lượt khai tay đã bị TỪ CHỐI không bao giờ khai lại được dù khách thật sự được đối tác đó giới thiệu.
 * Hai lần bấm «Lưu» liền nhau: lần hai thấy lượt của lần một đang sống ⇒ `DA_CO_LUOT_DANG_SONG`, không đẻ dòng thứ hai. 8–128 ký tự (CHECK `AffiliateReferral_idem_chk`).
 */
export function khoaKhaiTay(p: { leadId: string; partyId: string; campaignId: string; lan: number }): string {
  return `kt:${p.leadId}:${p.partyId}:${p.campaignId}:${p.lan}`;
}

/** Khoá giao dịch (advisory) để hai lượt khai cùng bộ ba xếp hàng — đọc «đã có lượt sống chưa» rồi ghi phải là một bước không xen được. */
export function khoaGiaoDichKhaiTay(p: { leadId: string; partyId: string; campaignId: string }): string {
  return `affiliate-referral:${p.leadId}:${p.partyId}:${p.campaignId}`;
}
