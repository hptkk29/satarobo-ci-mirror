/**
 * lib/affiliate/ghi-membership-dau-vao.ts — LUẬT GHI MEMBERSHIP (đối tác × campaign), PHẦN THUẦN (AFF-P0b). Không `db`, không đồng hồ, không `"use server"`.
 *
 * Chia đôi như `ghi-campaign-dau-vao.ts`: tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC, `ghi-membership.ts` đọc DB rồi ghi.
 *
 * ── Luật ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · MỘT dòng cho mỗi (đối tác, campaign) — UNIQUE. Thêm lại đối tác đã ENDED = MỞ LẠI dòng cũ (PENDING, bỏ phê duyệt cũ), không tạo trùng.
 *  · Chỉ đối tác ACTIVE mới thêm / duyệt / cho tham gia lại được. Campaign ENDED không nhận thành viên mới.
 *  · Mới vào là PENDING; `affiliate_memberships:manage` duyệt → ACTIVE (ghi người duyệt + lúc duyệt). Tạm ngừng / kết thúc / từ chối phải ghi lý do ≥ 10 ký tự.
 *  · CHECK `AffiliateMembership_hieu_luc_chk`: `effectiveTo > effectiveFrom`. Kết thúc một dòng mà hiệu lực CHƯA bắt đầu (hoặc bắt đầu đúng lúc này) sẽ vi phạm CHECK —
 *    kiểm ở đây để trả câu tiếng Việt, không để người dùng nhận lỗi của Postgres.
 */
import { ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { z } from "zod";

export const LY_DO_TOI_THIEU_MEMBERSHIP = 10;
export const DO_DAI_NHAN_NHOM_TOI_DA = 80;

export const TRANG_THAI_MEMBERSHIP = ["PENDING", "ACTIVE", "SUSPENDED", "ENDED"] as const;
export type TrangThaiMembership = (typeof TRANG_THAI_MEMBERSHIP)[number];

export const NHAN_TRANG_THAI_MEMBERSHIP: Readonly<Record<TrangThaiMembership, string>> = {
  PENDING: "Chờ duyệt",
  ACTIVE: "Đang tham gia",
  SUSPENDED: "Tạm ngừng",
  ENDED: "Đã kết thúc",
};

export type ThaoTacMembership = { den: TrangThaiMembership; nhan: string; moTa: string; canLyDo: boolean; hanhDong: string };

/** Bảng chuyển — MỘT nơi: nút trên dòng vẽ từ đây, hàm ghi kiểm từ đây. ENDED là cuối (muốn quay lại thì «Thêm đối tác» mở lại dòng cũ). */
export const CHUYEN_MEMBERSHIP: Readonly<Record<TrangThaiMembership, readonly ThaoTacMembership[]>> = {
  PENDING: [
    { den: "ACTIVE", nhan: "Duyệt", moTa: "Cho đối tác này tham gia campaign.", canLyDo: false, hanhDong: "MEMBERSHIP_DUYET" },
    { den: "ENDED", nhan: "Từ chối", moTa: "Không nhận đối tác này vào campaign. Có thể thêm lại sau.", canLyDo: true, hanhDong: "MEMBERSHIP_TU_CHOI" },
  ],
  ACTIVE: [
    { den: "SUSPENDED", nhan: "Tạm ngừng", moTa: "Đối tác tạm thời không được ghi nhận khách. Cho tham gia lại được.", canLyDo: true, hanhDong: "MEMBERSHIP_TAM_NGUNG" },
    { den: "ENDED", nhan: "Kết thúc", moTa: "Đối tác rời campaign. Khách đã ghi nhận giữ nguyên. Có thể thêm lại sau.", canLyDo: true, hanhDong: "MEMBERSHIP_KET_THUC" },
  ],
  SUSPENDED: [
    { den: "ACTIVE", nhan: "Cho tham gia lại", moTa: "Đối tác được ghi nhận khách trở lại.", canLyDo: false, hanhDong: "MEMBERSHIP_TIEP_TUC" },
    { den: "ENDED", nhan: "Kết thúc", moTa: "Đối tác rời campaign. Khách đã ghi nhận giữ nguyên. Có thể thêm lại sau.", canLyDo: true, hanhDong: "MEMBERSHIP_KET_THUC" },
  ],
  ENDED: [],
};

// ── Zod ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ngay = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Ngày không hợp lệ.");

const nhanNhom = z
  .string()
  .trim()
  .max(DO_DAI_NHAN_NHOM_TOI_DA, `Nhãn nhóm tối đa ${DO_DAI_NHAN_NHOM_TOI_DA} ký tự.`)
  .transform((v) => (v === "" ? null : v));

function kiemThuTu(tu: Date | null | undefined, den: Date | null | undefined): string | null {
  if (tu && den && den.getTime() <= tu.getTime()) return "Ngày kết thúc phải SAU ngày bắt đầu.";
  return null;
}

export const themMembershipSchema = z
  .object({
    partyId: z.string().trim().min(1, "Chọn đối tác.").max(64),
    groupLabel: nhanNhom.nullable(),
    /** null = bắt đầu từ lúc thêm. */
    effectiveFrom: ngay.nullable(),
    /** null = không giới hạn. */
    effectiveTo: ngay.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const loi = kiemThuTu(v.effectiveFrom, v.effectiveTo);
    if (loi) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: loi });
  });
export type DauVaoThemMembership = z.infer<typeof themMembershipSchema>;

export const suaMembershipSchema = z
  .object({
    groupLabel: nhanNhom.nullable().optional(),
    effectiveFrom: ngay.optional(),
    effectiveTo: ngay.nullable().optional(),
  })
  .strict();
export type VaSuaMembership = z.infer<typeof suaMembershipSchema>;

// ── Cổng ────────────────────────────────────────────────────────────────────────────────────────────────

type StatusDoiTac = "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
type StatusCampaign = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";

export type KetQuaKiemThem =
  | { ok: true; viec: "TAO" | "MO_LAI" }
  | { ok: false; truong: "partyId" | "campaign" | "effectiveTo"; loi: string };

/** Thêm đối tác vào campaign: TẠO dòng mới hay MỞ LẠI dòng ENDED cũ — hoặc từ chối kèm lý do. */
export function kiemThemMembership(p: {
  campaign: { status: StatusCampaign };
  doiTac: { status: StatusDoiTac } | null;
  hienCo: { status: TrangThaiMembership } | null;
}): KetQuaKiemThem {
  if (p.campaign.status === "ENDED") return { ok: false, truong: "campaign", loi: "Campaign đã kết thúc — không nhận thành viên mới." };
  if (!p.doiTac) return { ok: false, truong: "partyId", loi: "Không tìm thấy đối tác này." };
  if (p.doiTac.status !== "ACTIVE") {
    return { ok: false, truong: "partyId", loi: "Chỉ đối tác đang hoạt động mới thêm vào campaign được — duyệt hoặc mở lại đối tác ở tab Affiliate trước." };
  }
  if (p.hienCo && p.hienCo.status !== "ENDED") {
    return { ok: false, truong: "partyId", loi: `Đối tác này đã ở trong campaign (trạng thái «${NHAN_TRANG_THAI_MEMBERSHIP[p.hienCo.status]}»).` };
  }
  return { ok: true, viec: p.hienCo ? "MO_LAI" : "TAO" };
}

export type KetQuaKiemChuyenMembership =
  | { ok: true; thaoTac: ThaoTacMembership }
  | { ok: false; truong: "trangThai" | "lyDo" | "partyId" | "campaign"; loi: string };

/**
 * Vào / quay lại campaign (đích ACTIVE): campaign phải còn nhận, đối tác phải còn hoạt động. Rút lui (tạm ngừng / kết thúc) thì luôn được. MỘT định nghĩa: cổng ghi
 * (`kiemChuyenMembership`) và nút trên dòng (`thaoTacKhaDung`) cùng hỏi nó — nút «Duyệt» không được vẽ khi cổng chắc chắn từ chối.
 */
export function chanVaoCampaign(p: { campaign: { status: StatusCampaign }; doiTac: { status: StatusDoiTac } }): { truong: "campaign" | "partyId"; loi: string } | null {
  if (p.campaign.status === "ENDED") return { truong: "campaign", loi: "Campaign đã kết thúc — không duyệt thêm thành viên." };
  if (p.doiTac.status !== "ACTIVE") return { truong: "partyId", loi: "Đối tác này không còn hoạt động — mở lại đối tác ở tab Affiliate trước." };
  return null;
}

/** Các thao tác trên một dòng, mỗi cái kèm lý do bị chặn (null = làm được). Nút vẽ từ đây; thao tác bị chặn hiện CÂU LÝ DO thay vì nút. */
export function thaoTacKhaDung(p: { status: TrangThaiMembership; campaign: { status: StatusCampaign }; doiTac: { status: StatusDoiTac } }): { thaoTac: ThaoTacMembership; lyDoChan: string | null }[] {
  return CHUYEN_MEMBERSHIP[p.status].map((thaoTac) => ({ thaoTac, lyDoChan: thaoTac.den === "ACTIVE" ? (chanVaoCampaign(p)?.loi ?? null) : null }));
}

export function kiemChuyenMembership(p: {
  tu: TrangThaiMembership;
  den: TrangThaiMembership;
  lyDo: string | null;
  campaign: { status: StatusCampaign };
  doiTac: { status: StatusDoiTac };
}): KetQuaKiemChuyenMembership {
  const thaoTac = CHUYEN_MEMBERSHIP[p.tu].find((t) => t.den === p.den);
  if (!thaoTac) {
    return { ok: false, truong: "trangThai", loi: `Không chuyển được từ «${NHAN_TRANG_THAI_MEMBERSHIP[p.tu]}» sang «${NHAN_TRANG_THAI_MEMBERSHIP[p.den]}».` };
  }
  if (p.den === "ACTIVE") {
    const chan = chanVaoCampaign(p);
    if (chan) return { ok: false, truong: chan.truong, loi: chan.loi };
  }
  if (thaoTac.canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_MEMBERSHIP) {
    return { ok: false, truong: "lyDo", loi: `Ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_MEMBERSHIP} ký tự) khi ${thaoTac.nhan.toLowerCase()}.` };
  }
  return { ok: true, thaoTac };
}

/** Ngày giờ theo lịch VN — hàm CHUNG của module (không `toLocaleString`: ICU khác nhau theo runtime). */
const chuNgayGio = ngayGioVN;

/**
 * Hiệu lực-đến khi KẾT THÚC một dòng lúc `now`. Đã có hạn trong quá khứ thì giữ hạn đó (không kéo dài thêm); không thì chốt ở `now`. Phải SAU hiệu lực-từ (CHECK):
 * dòng chưa bắt đầu hiệu lực, hoặc vừa bắt đầu đúng lúc này, không kết thúc được — nói rõ vì sao thay vì để Postgres từ chối.
 */
export function tinhHieuLucKhiKetThuc(p: { effectiveFrom: Date; effectiveTo: Date | null; now: Date }): { ok: true; effectiveTo: Date } | { ok: false; loi: string } {
  const den = p.effectiveTo && p.effectiveTo.getTime() < p.now.getTime() ? p.effectiveTo : p.now;
  if (den.getTime() <= p.effectiveFrom.getTime()) {
    return {
      ok: false,
      loi: `Chưa kết thúc được: hiệu lực của dòng này bắt đầu từ ${chuNgayGio(p.effectiveFrom)}, chưa tới lúc để kết thúc. Sửa ngày bắt đầu về sớm hơn, hoặc đợi tới thời điểm đó.`,
    };
  }
  return { ok: true, effectiveTo: den };
}

export type KetQuaKiemSuaMembership =
  | { ok: true; truongDoi: ("groupLabel" | "effectiveFrom" | "effectiveTo")[]; canLyDo: boolean }
  | { ok: false; truong: "trangThai" | "effectiveFrom" | "effectiveTo" | "lyDo"; loi: string };

/** Sửa nhãn nhóm / hiệu lực của một dòng. ENDED không sửa. Ngày bắt đầu chỉ đổi khi còn PENDING. Đổi ngày trên dòng đang tham gia / tạm ngừng phải ghi lý do. */
export function kiemSuaMembership(p: {
  status: TrangThaiMembership;
  hienTai: { groupLabel: string | null; effectiveFrom: Date; effectiveTo: Date | null };
  patch: VaSuaMembership;
  lyDo: string | null;
}): KetQuaKiemSuaMembership {
  if (p.status === "ENDED") return { ok: false, truong: "trangThai", loi: "Dòng đã kết thúc — không sửa được. Muốn đối tác quay lại thì thêm lại đối tác." };
  const truongDoi: ("groupLabel" | "effectiveFrom" | "effectiveTo")[] = [];
  if (p.patch.groupLabel !== undefined && p.patch.groupLabel !== p.hienTai.groupLabel) truongDoi.push("groupLabel");
  if (p.patch.effectiveFrom !== undefined && p.patch.effectiveFrom.getTime() !== p.hienTai.effectiveFrom.getTime()) {
    if (p.status !== "PENDING") {
      return { ok: false, truong: "effectiveFrom", loi: "Ngày bắt đầu chỉ đổi được khi dòng còn «Chờ duyệt». Đã tham gia rồi thì kết thúc dòng này và thêm lại." };
    }
    truongDoi.push("effectiveFrom");
  }
  if (p.patch.effectiveTo !== undefined) {
    const a = p.patch.effectiveTo?.getTime() ?? null;
    const b = p.hienTai.effectiveTo?.getTime() ?? null;
    if (a !== b) truongDoi.push("effectiveTo");
  }
  const tu = p.patch.effectiveFrom ?? p.hienTai.effectiveFrom;
  const den = p.patch.effectiveTo !== undefined ? p.patch.effectiveTo : p.hienTai.effectiveTo;
  const loiTT = kiemThuTu(tu, den);
  if (loiTT && (truongDoi.includes("effectiveFrom") || truongDoi.includes("effectiveTo"))) return { ok: false, truong: "effectiveTo", loi: loiTT };
  const canLyDo = p.status !== "PENDING" && (truongDoi.includes("effectiveFrom") || truongDoi.includes("effectiveTo"));
  if (canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_MEMBERSHIP) {
    return { ok: false, truong: "lyDo", loi: `Ghi lý do đổi hiệu lực (tối thiểu ${LY_DO_TOI_THIEU_MEMBERSHIP} ký tự).` };
  }
  return { ok: true, truongDoi, canLyDo };
}

// ── Kết quả hàm ghi / action (kiểu thuần) ───────────────────────────────────────────────────────────────────

export type KetQuaThemMembership = { ok: true; id: string; viec: "TAO" | "MO_LAI" } | { ok: false; loi: string; truong?: string };
export type KetQuaDoiMembership = { ok: true; tu: TrangThaiMembership; den: TrangThaiMembership; updatedAt: string } | { ok: false; loi: string; truong?: string };
export type KetQuaSuaMembership = { ok: true; doi: boolean; updatedAt: string } | { ok: false; loi: string; truong?: string };
