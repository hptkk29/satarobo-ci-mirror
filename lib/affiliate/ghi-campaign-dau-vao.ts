/**
 * lib/affiliate/ghi-campaign-dau-vao.ts — LUẬT GHI CAMPAIGN AFFILIATE, PHẦN THUẦN (AFF-P0b, docs/source-commission/12). Không `db`, không đồng hồ, không `"use server"`.
 *
 * Chia làm hai: tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC (kiểm đầu vào bằng Zod, bảng chuyển trạng thái, điều kiện KÍCH HOẠT, dựng đầu vào cho xem trước nguồn);
 * `ghi-campaign.ts` đọc DB rồi ghi. Tách để mọi nhánh luật test được không cần Postgres, để giao diện (client) import được mà không kéo mã máy chủ,
 * và để luật không có HAI bản (action · UI · hàm ghi cùng hỏi một chỗ — luật 12b).
 *
 * ── Luật ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · `code`: qua `chuanHoaMa`, rồi phải khớp `MA_DANH_MUC_RE` (CHECK `AffiliateCampaign_code_chk`). KHÔNG đổi sau khi tạo (không có trong schema sửa).
 *  · `cookieWindowDays` 1..365 · `protectWindowDays` 1..730 (CHECK của migration) · hiệu lực: hết hạn phải SAU bắt đầu (CHECK `_hieu_luc_chk`).
 *  · Tham số ẢNH HƯỞNG GHI NHẬN (mô hình · hai cửa sổ · tự giới thiệu · nguồn mặc định · quy tắc quy nguồn) CHỈ đổi được khi DRAFT hoặc PAUSED, và từ PAUSED trở đi
 *    phải ghi lý do ≥ 10 ký tự (đặc tả §29: không hồi tố âm thầm). Campaign ĐANG CHẠY chỉ sửa được tên · mô tả · ngày hết hiệu lực. ENDED không sửa nữa.
 *  · Kích hoạt (DRAFT→ACTIVE và PAUSED→ACTIVE): CÙNG MỘT hàm `kiemKichHoatCampaign` (AFF-L1: thêm «thưởng» · điều kiện đối tác · nhất quán `policyId`). Mô hình SPLIT không kích hoạt được ở P0.
 *  · Nguồn được chọn (mặc định + quy tắc) = nguồn mà ô chọn nguồn của lead mới cũng cho chọn: `nguonChonDuoc` (lib/nguon/hieu-luc-nguon.ts) — KHÔNG so mã nguồn nào,
 *    `UNKNOWN` rơi ra vì `selectable = false` chứ không vì bị gọi tên.
 */
import { z } from "zod";
import { MA_DANH_MUC_RE, chuanHoaMa } from "./chung";
import { giaiNguonCuaDoiTac, type DauVaoGiaiNguon, type KetQuaGiaiNguon, type QuyTacNguon } from "./giai-nguon";
import { kiemHieuLuc } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import { nguonChonDuoc } from "@/lib/nguon/hieu-luc-nguon";
import { nhanTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";

export const LY_DO_TOI_THIEU_CAMPAIGN = 10;

// ── Trạng thái ──────────────────────────────────────────────────────────────────────────────────────────────

export const TRANG_THAI_CAMPAIGN = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"] as const;
export type TrangThaiCampaign = (typeof TRANG_THAI_CAMPAIGN)[number];

export const NHAN_TRANG_THAI_CAMPAIGN: Readonly<Record<TrangThaiCampaign, string>> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang chạy",
  PAUSED: "Tạm dừng",
  ENDED: "Đã kết thúc",
};

// ── Mô hình ghi nhận ─────────────────────────────────────────────────────────────────────────────────────────

export const MO_HINH_GHI_NHAN = ["FIRST_VALID", "LAST_VALID", "MANUAL_REVIEW", "SPLIT"] as const;
export type MoHinhGhiNhan = (typeof MO_HINH_GHI_NHAN)[number];

export const NHAN_MO_HINH: Readonly<Record<MoHinhGhiNhan, string>> = {
  FIRST_VALID: "Người đầu tiên hợp lệ",
  LAST_VALID: "Người cuối cùng hợp lệ",
  MANUAL_REVIEW: "Xem tay từng trường hợp",
  SPLIT: "Chia giữa nhiều người",
};

export const MO_TA_MO_HINH: Readonly<Record<MoHinhGhiNhan, string>> = {
  FIRST_VALID: "Khách có nhiều người giới thiệu: người đầu tiên hợp lệ giữ công.",
  LAST_VALID: "Khách có nhiều người giới thiệu: người cuối cùng hợp lệ giữ công.",
  MANUAL_REVIEW: "Khách có nhiều người giới thiệu: để người có quyền xem tay và quyết.",
  SPLIT: "Cần chính sách riêng — chưa dùng được.",
};

/** Mô hình kích hoạt được ở P0. SPLIT lưu được ở bản nháp nhưng KHÔNG kích hoạt được (cần chính sách chia riêng — P2). */
export function moHinhKichHoatDuoc(m: MoHinhGhiNhan): boolean {
  return m !== "SPLIT";
}

// ── Tham số (mặc định + khoảng) ──────────────────────────────────────────────────────────────────────────────

/** Khoảng hợp lệ KHỚP CHECK của migration; `macDinh` là giá trị điền sẵn ở biểu mẫu — người tạo đổi được. */
export const COOKIE_NGAY = { toiThieu: 1, toiDa: 365, macDinh: 30 } as const;
export const BAO_VE_NGAY = { toiThieu: 1, toiDa: 730, macDinh: 90 } as const;

export const DO_DAI_TEN_TOI_DA = 120;
export const DO_DAI_MO_TA_TOI_DA = 1000;

// ── Zod ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ngay = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Ngày không hợp lệ.");

const idTuyChon = z
  .string()
  .trim()
  .max(64)
  .transform((v) => (v === "" ? null : v));

const moTa = z
  .string()
  .trim()
  .max(DO_DAI_MO_TA_TOI_DA, `Mô tả tối đa ${DO_DAI_MO_TA_TOI_DA} ký tự.`)
  .transform((v) => (v === "" ? null : v));

const tenCampaign = z.string().trim().min(2, "Tên campaign tối thiểu 2 ký tự.").max(DO_DAI_TEN_TOI_DA, `Tên campaign tối đa ${DO_DAI_TEN_TOI_DA} ký tự.`);

const cookieNgay = z
  .number("Cửa sổ cookie là số ngày.")
  .int("Cửa sổ cookie là số ngày nguyên.")
  .min(COOKIE_NGAY.toiThieu, `Cửa sổ cookie phải từ ${COOKIE_NGAY.toiThieu} đến ${COOKIE_NGAY.toiDa} ngày.`)
  .max(COOKIE_NGAY.toiDa, `Cửa sổ cookie phải từ ${COOKIE_NGAY.toiThieu} đến ${COOKIE_NGAY.toiDa} ngày.`);

const baoVeNgay = z
  .number("Thời gian bảo vệ là số ngày.")
  .int("Thời gian bảo vệ là số ngày nguyên.")
  .min(BAO_VE_NGAY.toiThieu, `Thời gian bảo vệ phải từ ${BAO_VE_NGAY.toiThieu} đến ${BAO_VE_NGAY.toiDa} ngày.`)
  .max(BAO_VE_NGAY.toiDa, `Thời gian bảo vệ phải từ ${BAO_VE_NGAY.toiThieu} đến ${BAO_VE_NGAY.toiDa} ngày.`);

/** Câu lỗi tiếng Việt cho mã ĐÃ chuẩn hoá; `null` = hợp lệ. */
export function kiemMaCampaign(code: string): string | null {
  if (!MA_DANH_MUC_RE.test(code)) {
    return "Mã campaign gồm chữ HOA không dấu, chữ số và gạch dưới (A–Z, 0–9, _), dài 3–40 ký tự.";
  }
  return null;
}

export const taoCampaignSchema = z
  .object({
    code: z.string().transform(chuanHoaMa),
    name: tenCampaign,
    description: moTa.nullable(),
    attributionModel: z.enum(MO_HINH_GHI_NHAN, "Chọn mô hình ghi nhận."),
    cookieWindowDays: cookieNgay,
    protectWindowDays: baoVeNgay,
    allowSelfReferral: z.boolean(),
    /** L3a — hiện số tiền hoa hồng ở cổng đối tác: null/không khai = theo LOẠI đối tác (rồi mặc định ẨN). Không khai = an toàn nhất (ẨN), nên được phép bỏ trống ở đây. */
    partnerCanViewAmount: z.boolean().nullable().optional(),
    defaultSourceGroupId: idTuyChon.nullable(),
    effectiveFrom: ngay.nullable(),
    effectiveTo: ngay.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const loiMa = kiemMaCampaign(v.code);
    if (loiMa) ctx.addIssue({ code: "custom", path: ["code"], message: loiMa });
    const loiHL = kiemHieuLuc(v.effectiveFrom, v.effectiveTo);
    if (loiHL) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: loiHL });
  });
export type DauVaoTaoCampaign = z.infer<typeof taoCampaignSchema>;

/** Trường sửa được. `undefined` = KHÔNG đổi; `null` = xoá (chỉ với trường cho phép trống). KHÔNG có `code`. */
export const suaCampaignSchema = z
  .object({
    name: tenCampaign.optional(),
    description: moTa.nullable().optional(),
    attributionModel: z.enum(MO_HINH_GHI_NHAN, "Chọn mô hình ghi nhận.").optional(),
    cookieWindowDays: cookieNgay.optional(),
    protectWindowDays: baoVeNgay.optional(),
    allowSelfReferral: z.boolean().optional(),
    partnerCanViewAmount: z.boolean().nullable().optional(),
    defaultSourceGroupId: idTuyChon.nullable().optional(),
    effectiveFrom: ngay.nullable().optional(),
    effectiveTo: ngay.nullable().optional(),
  })
  .strict();
export type VaSuaCampaign = z.infer<typeof suaCampaignSchema>;

/** Giá trị đang lưu của các trường sửa được. */
export type GiaTriCampaign = {
  name: string;
  description: string | null;
  attributionModel: MoHinhGhiNhan;
  cookieWindowDays: number;
  protectWindowDays: number;
  allowSelfReferral: boolean;
  partnerCanViewAmount: boolean | null;
  defaultSourceGroupId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};
export type TruongSuaCampaign = keyof GiaTriCampaign;

export const NHAN_TRUONG_CAMPAIGN: Readonly<Record<TruongSuaCampaign, string>> = {
  name: "Tên campaign",
  description: "Mô tả",
  attributionModel: "Mô hình ghi nhận",
  cookieWindowDays: "Cửa sổ cookie",
  protectWindowDays: "Thời gian bảo vệ",
  allowSelfReferral: "Cho phép tự giới thiệu",
  partnerCanViewAmount: "Hiện số tiền hoa hồng ở cổng đối tác",
  defaultSourceGroupId: "Nguồn mặc định",
  effectiveFrom: "Hiệu lực từ",
  effectiveTo: "Hiệu lực đến",
};

/** Tham số ảnh hưởng cách GHI NHẬN lead — đổi chúng là đổi cách tính công của mọi lead SAU này, nên chỉ ở DRAFT/PAUSED. */
export const TRUONG_ANH_HUONG_GHI_NHAN: ReadonlySet<TruongSuaCampaign> = new Set<TruongSuaCampaign>([
  "attributionModel",
  "cookieWindowDays",
  "protectWindowDays",
  "allowSelfReferral",
  "defaultSourceGroupId",
]);

/**
 * Campaign ĐANG CHẠY chỉ sửa được các trường này. `partnerCanViewAmount` (L3a) là cài đặt HIỂN THỊ ở cổng đối tác, không đổi cách tính công hay số tiền nào — nên sửa được khi đang chạy; mọi lần đổi vẫn vào nhật ký
 * (`changedFields`). Nó KHÔNG thuộc `TRUONG_ANH_HUONG_GHI_NHAN` nên cũng không đòi lý do.
 */
export const TRUONG_SUA_KHI_DANG_CHAY: ReadonlySet<TruongSuaCampaign> = new Set<TruongSuaCampaign>(["name", "description", "effectiveTo", "partnerCanViewAmount"]);

/** Vì sao một ô của biểu mẫu sửa bị KHOÁ ở trạng thái này (`null` = sửa được). Biểu mẫu vẽ `disabled` + câu này; cổng ghi (`kiemSuaCampaign`) chặn bằng cùng tập `TRUONG_SUA_KHI_DANG_CHAY`. */
export function lyDoKhoaTruong(trangThai: TrangThaiCampaign, k: TruongSuaCampaign): string | null {
  if (trangThai === "ENDED") return "Campaign đã kết thúc — không sửa được nữa.";
  if (trangThai === "ACTIVE" && !TRUONG_SUA_KHI_DANG_CHAY.has(k)) return "Đang chạy — tạm dừng campaign trước khi đổi ô này.";
  return null;
}

/**
 * Đổi các trường này từ PAUSED trở đi thì bắt lý do: tham số ghi nhận + ngày bắt đầu. Tên · mô tả · ngày HẾT hiệu lực thì không (gia hạn / rút hạn là việc thường ngày của campaign
 * đang chạy, và nó không đổi cách tính công của khách đã ghi nhận — chỉ đổi lúc campaign thôi nhận khách mới).
 */
export function laTruongNhayCamCampaign(k: TruongSuaCampaign): boolean {
  return TRUONG_ANH_HUONG_GHI_NHAN.has(k) || k === "effectiveFrom";
}

const THU_TU_TRUONG: readonly TruongSuaCampaign[] = [
  "name",
  "description",
  "attributionModel",
  "cookieWindowDays",
  "protectWindowDays",
  "allowSelfReferral",
  "partnerCanViewAmount",
  "defaultSourceGroupId",
  "effectiveFrom",
  "effectiveTo",
];

function khacNhau(k: TruongSuaCampaign, a: unknown, b: unknown): boolean {
  if (k === "effectiveFrom" || k === "effectiveTo") {
    const x = a instanceof Date ? a.getTime() : null;
    const y = b instanceof Date ? b.getTime() : null;
    return x !== y;
  }
  return a !== b;
}

export type KetQuaKiemSua =
  | { ok: true; truongDoi: TruongSuaCampaign[]; canLyDo: boolean }
  | { ok: false; truong: TruongSuaCampaign | "lyDo" | "trangThai" | "effectiveTo"; loi: string };

/**
 * Cổng sửa campaign. Thứ tự: ENDED chặn hết → mỗi trường đổi phải được phép ở trạng thái này → hiệu lực mới hợp lệ → lý do. Trả danh sách trường THẬT SỰ đổi
 * (form gửi lại mọi ô mỗi lần Lưu; ô không đổi không được đòi lý do hay bị chặn vì campaign đang chạy).
 */
export function kiemSuaCampaign(p: { trangThai: TrangThaiCampaign; hienTai: GiaTriCampaign; patch: VaSuaCampaign; lyDo: string | null }): KetQuaKiemSua {
  if (p.trangThai === "ENDED") return { ok: false, truong: "trangThai", loi: "Campaign đã kết thúc — không sửa được nữa." };

  const truongDoi: TruongSuaCampaign[] = [];
  for (const k of THU_TU_TRUONG) {
    const moi = (p.patch as Record<string, unknown>)[k];
    if (moi === undefined) continue;
    if (khacNhau(k, (p.hienTai as Record<string, unknown>)[k], moi)) truongDoi.push(k);
  }

  if (p.trangThai === "ACTIVE") {
    const bi = truongDoi.find((k) => !TRUONG_SUA_KHI_DANG_CHAY.has(k));
    if (bi) {
      return {
        ok: false,
        truong: bi,
        loi: `«${NHAN_TRUONG_CAMPAIGN[bi]}» không đổi được khi campaign đang chạy — tạm dừng campaign trước, đổi xong rồi chạy lại. Khi đang chạy chỉ sửa được tên, mô tả, ngày hết hiệu lực và cài đặt hiển thị số tiền ở cổng đối tác.`,
      };
    }
  }

  const tu = p.patch.effectiveFrom !== undefined ? p.patch.effectiveFrom : p.hienTai.effectiveFrom;
  const den = p.patch.effectiveTo !== undefined ? p.patch.effectiveTo : p.hienTai.effectiveTo;
  const loiHL = kiemHieuLuc(tu, den);
  if (loiHL && (truongDoi.includes("effectiveFrom") || truongDoi.includes("effectiveTo"))) {
    return { ok: false, truong: "effectiveTo", loi: loiHL };
  }

  const canLyDo = p.trangThai !== "DRAFT" && truongDoi.some(laTruongNhayCamCampaign);
  if (canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
    return { ok: false, truong: "lyDo", loi: `Ghi lý do đổi (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự) — campaign đã từng chạy, đổi tham số là đổi cách tính công về sau.` };
  }
  return { ok: true, truongDoi, canLyDo };
}

// ── Chuyển trạng thái ───────────────────────────────────────────────────────────────────────────────────────

export type ThaoTacChuyen = { den: TrangThaiCampaign; nhan: string; moTa: string; canLyDo: boolean };

/**
 * Bảng chuyển trạng thái — MỘT nơi: hộp thoại vẽ lựa chọn từ đây, hàm ghi kiểm từ đây. ENDED là cuối. Mọi bước dùng quyền `affiliate_campaigns:activate`.
 * Lý do bắt buộc khi tạm dừng / kết thúc (dừng việc ghi nhận là việc có hệ quả với đối tác); kích hoạt và tiếp tục không bắt.
 */
export const CHUYEN_TRANG_THAI: Readonly<Record<TrangThaiCampaign, readonly ThaoTacChuyen[]>> = {
  DRAFT: [
    { den: "ACTIVE", nhan: "Kích hoạt", moTa: "Cho đối tác bắt đầu được ghi nhận khách giới thiệu theo cấu hình này.", canLyDo: false },
    { den: "ENDED", nhan: "Huỷ nháp", moTa: "Bỏ campaign này. Không mở lại được.", canLyDo: true },
  ],
  ACTIVE: [
    { den: "PAUSED", nhan: "Tạm dừng", moTa: "Dừng ghi nhận khách mới. Khách đã ghi nhận giữ nguyên. Chạy lại được.", canLyDo: true },
    { den: "ENDED", nhan: "Kết thúc", moTa: "Kết thúc hẳn, không chạy lại được. Không xoá đối tác hay khách đã ghi nhận.", canLyDo: true },
  ],
  PAUSED: [
    { den: "ACTIVE", nhan: "Chạy lại", moTa: "Kiểm lại toàn bộ điều kiện như lúc kích hoạt rồi cho ghi nhận tiếp.", canLyDo: false },
    { den: "ENDED", nhan: "Kết thúc", moTa: "Kết thúc hẳn, không chạy lại được. Không xoá đối tác hay khách đã ghi nhận.", canLyDo: true },
  ],
  ENDED: [],
};

export type KetQuaKiemChuyen = { ok: true; thaoTac: ThaoTacChuyen } | { ok: false; truong: "trangThai" | "lyDo"; loi: string };

export function kiemChuyenTrangThai(p: { tu: TrangThaiCampaign; den: TrangThaiCampaign; lyDo: string | null }): KetQuaKiemChuyen {
  if (p.tu === "ENDED") return { ok: false, truong: "trangThai", loi: "Campaign đã kết thúc — không chuyển trạng thái được nữa." };
  const thaoTac = CHUYEN_TRANG_THAI[p.tu].find((t) => t.den === p.den);
  if (!thaoTac) {
    return { ok: false, truong: "trangThai", loi: `Không chuyển được từ «${NHAN_TRANG_THAI_CAMPAIGN[p.tu]}» sang «${NHAN_TRANG_THAI_CAMPAIGN[p.den]}».` };
  }
  if (thaoTac.canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
    return { ok: false, truong: "lyDo", loi: `Ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự) khi ${thaoTac.nhan.toLowerCase()} campaign.` };
  }
  return { ok: true, thaoTac };
}

/** Tên hành động trong nhật ký: phân biệt kích hoạt lần đầu và chạy lại sau tạm dừng. */
export function tenHanhDongTrangThai(tu: TrangThaiCampaign, den: TrangThaiCampaign): string {
  if (den === "ACTIVE") return tu === "PAUSED" ? "CAMPAIGN_CHAY_LAI" : "CAMPAIGN_KICH_HOAT";
  if (den === "PAUSED") return "CAMPAIGN_TAM_DUNG";
  return tu === "DRAFT" ? "CAMPAIGN_HUY_NHAP" : "CAMPAIGN_KET_THUC";
}

// ── Điều kiện KÍCH HOẠT ─────────────────────────────────────────────────────────────────────────────────────

export type NguonDeKiem = { ten: string; status: string; selectable: boolean; effectiveFrom: Date | null; effectiveTo: Date | null };

/** Lựa chọn «thưởng» của campaign (cột `AffiliateCampaign.rewardMode`). `null` = CHƯA CHỌN — khác hẳn «Không thưởng». */
export const CHE_DO_THUONG = ["NONE", "POLICY"] as const;
export type CheDoThuong = (typeof CHE_DO_THUONG)[number];

export const NHAN_CHE_DO_THUONG: Readonly<Record<CheDoThuong, string>> = {
  NONE: "Không có mức riêng cho campaign",
  POLICY: "Có thưởng theo chính sách riêng của campaign",
};

/** Chỗ trên trang chi tiết mà MỘT điều kiện chặn được sửa — trang dựng đường dẫn từ đây (một nơi, không chuỗi gõ tay ở UI). */
export const MUC_SUA_CAMPAIGN = ["thong-tin", "quy-tac", "website", "hoa-hong"] as const;
export type MucSuaCampaign = (typeof MUC_SUA_CAMPAIGN)[number];

/**
 * Một điều kiện CHẶN kích hoạt. `ma` ổn định (test + nhật ký); `muc` = nơi sửa. Giao diện liệt kê TẤT CẢ, mỗi cái kèm đường tới `muc`:
 *   · `thong-tin` → trang sửa campaign (`/sua`) · `quy-tac`, `website`, `hoa-hong` → mục cùng tên trên trang chi tiết.
 */
export type ChanKichHoat = { ma: string; thongBao: string; muc: MucSuaCampaign };

/** Một quy tắc quy nguồn, kèm những gì cổng cần biết về nó. */
export type QuyTacChoCong = {
  sourceGroupId: string;
  /** Loại đối tác của quy tắc còn bật không; `null` = quy tắc không xét loại. Quy tắc trỏ loại/nhãn đã tắt thì KHÔNG BAO GIỜ khớp ai. */
  loaiConDung: boolean | null;
  nhanConDung: boolean | null;
  /** `AffiliateCampaignRule.policyId` — không ai ghi nó từ UI (xem notes closeout L1); nếu DB mang giá trị thì phải nhất quán. */
  policyId: string | null;
  /** Chính sách đó có (ít nhất) một phiên bản KHÔNG bị huỷ mà `scopeCampaignId` = campaign này không. Chỉ có nghĩa khi `policyId` ≠ null. */
  policyCoPhienBanCuaCampaign: boolean;
};

/** Một phiên bản chính sách phạm vi CAMPAIGN của campaign này (mọi trạng thái trừ huỷ). */
export type PhienBanCuaCampaign = { status: string; effectiveFrom: Date; effectiveTo: Date | null };

export type DuLieuKichHoat = {
  attributionModel: MoHinhGhiNhan;
  defaultSourceGroupId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  quyTac: readonly QuyTacChoCong[];
  website: readonly { ten: string; status: "ACTIVE" | "INACTIVE" }[];
  /** Mọi nguồn mà campaign trỏ tới (mặc định + quy tắc), theo id. Id không có trong bảng = nguồn đã biến mất. */
  nguon: ReadonlyMap<string, NguonDeKiem>;
  /** BẮT BUỘC khai (luật 7): quên là cổng thiếu hẳn vế «thưởng». */
  cheDoThuong: CheDoThuong | null;
  phienBanChinhSach: readonly PhienBanCuaCampaign[];
  now: Date;
};

function ngayVN(d: Date): string {
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Vì sao MỘT nguồn không còn chọn được — nói đúng nguyên nhân, kèm đường sửa. */
export function lyDoNguonKhongDung(n: NguonDeKiem, now: Date): string | null {
  if (nguonChonDuoc(n, now)) return null;
  if (n.status !== "ACTIVE") {
    return `Nguồn «${n.ten}» đang ở trạng thái «${nhanTrangThaiNguon(n.status)}» — kích hoạt lại nguồn đó (tab Nguồn), hoặc đổi nguồn mặc định / quy tắc đang trỏ tới nó.`;
  }
  if (!n.selectable) {
    return `Nguồn «${n.ten}» đang tắt «chọn được ở ô nhập» — bật lại ở tab Nguồn, hoặc đổi nguồn mặc định / quy tắc đang trỏ tới nó.`;
  }
  if (n.effectiveFrom && now.getTime() < n.effectiveFrom.getTime()) {
    return `Nguồn «${n.ten}» chỉ có hiệu lực từ ${ngayVN(n.effectiveFrom)} — chưa tới ngày.`;
  }
  return `Nguồn «${n.ten}» đã hết hiệu lực${n.effectiveTo ? ` từ ${ngayVN(n.effectiveTo)}` : ""} — gia hạn ở tab Nguồn, hoặc đổi nguồn mặc định / quy tắc đang trỏ tới nó.`;
}

/**
 * Phiên bản chính sách CAMPAIGN đang ÁP (hoặc đã lên lịch áp): `ACTIVE` và chưa hết hạn tại `now`. Nháp / đã thay / đã hết / đã huỷ không tính.
 * MỘT định nghĩa cho cả hai chiều của cổng «thưởng» (có thưởng mà không có chính sách · không thưởng mà vẫn có chính sách).
 */
export function phienBanDangAp(v: readonly PhienBanCuaCampaign[], now: Date): PhienBanCuaCampaign[] {
  return v.filter((x) => x.status === "ACTIVE" && (x.effectiveTo === null || x.effectiveTo.getTime() > now.getTime()));
}

/**
 * MỌI điều kiện để campaign được ACTIVE — kích hoạt lần đầu VÀ chạy lại sau tạm dừng đều đi qua đây (chạy lại mà chỉ lật cờ thì đặt SPLIT / ngừng nguồn lúc đang tạm dừng
 * rồi chạy lại là lách mọi cổng). Trả DANH SÁCH điều kiện chặn (rỗng = được), mỗi cái có `muc` để giao diện chỉ đường sửa. Hàm ghi gọi nó TRONG transaction sau khi đã khoá hàng campaign
 * (`FOR UPDATE`) và các hàng nguồn (`FOR SHARE`) — kiểm ngoài rồi ghi là hở cửa cho người xoá quy tắc / ngừng nguồn xen vào giữa.
 *
 * Campaign ĐANG chạy KHÔNG bị cổng này kéo xuống: cổng chỉ hỏi ở lần kích hoạt / chạy lại (xem `doiTrangThaiCampaign`).
 *
 * «Điều kiện đối tác đủ» (AFF-L1) = có CÁCH QUY NGUỒN ÁP ĐƯỢC cho đối tác: nguồn mặc định của campaign, HOẶC ít nhất một quy tắc theo loại/nhãn mà loại/nhãn đó còn bật
 * (quy tắc tạo xong rồi loại bị tắt thì không khớp ai — vẫn nằm trong bảng nhưng là quy tắc chết). Ai được vào campaign do danh sách thành viên quyết, không phải điều kiện này.
 */
export function kiemKichHoatCampaign(d: DuLieuKichHoat): ChanKichHoat[] {
  const loi: ChanKichHoat[] = [];
  const chan = (ma: string, thongBao: string, muc: MucSuaCampaign) => loi.push({ ma, thongBao, muc });

  if (!moHinhKichHoatDuoc(d.attributionModel)) {
    chan("MO_HINH", `Mô hình «${NHAN_MO_HINH[d.attributionModel]}» cần chính sách riêng và chưa dùng được — đổi mô hình khi campaign đang nháp hoặc tạm dừng.`, "thong-tin");
  }

  // ── Điều kiện đối tác + ánh xạ nguồn ──
  const idNguon = new Set<string>(d.quyTac.map((r) => r.sourceGroupId));
  if (d.defaultSourceGroupId) idNguon.add(d.defaultSourceGroupId);
  const quyTacAp = d.quyTac.filter((r) => r.loaiConDung !== false && r.nhanConDung !== false);
  if (!d.defaultSourceGroupId && quyTacAp.length === 0) {
    if (d.quyTac.length === 0) {
      chan("DOI_TAC_NGUON", "Chưa có nguồn mặc định và chưa có quy tắc quy nguồn nào — thêm ít nhất một trong hai, nếu không khách do đối tác giới thiệu sẽ không biết ghi vào nguồn nào.", "quy-tac");
    } else {
      chan("DOI_TAC_NGUON", "Mọi quy tắc quy nguồn đều trỏ tới loại hoặc nhãn đối tác đã tắt nên không khớp ai, và campaign chưa có nguồn mặc định — bật lại loại/nhãn đó, thêm quy tắc mới hoặc đặt nguồn mặc định.", "quy-tac");
    }
  }

  // ── Website ──
  if (d.website.length === 0) {
    chan("WEBSITE", "Chưa gắn website nào — gắn ít nhất một website đang bật để đối tác có chỗ đặt link.", "website");
  } else if (!d.website.some((w) => w.status === "ACTIVE")) {
    chan("WEBSITE", `Các website đã gắn đều đang tắt (${d.website.map((w) => w.ten).join(", ")}) — bật lại ở tab Website hoặc gắn website khác.`, "website");
  }

  // ── Hiệu lực ──
  if (d.effectiveFrom && d.effectiveTo && d.effectiveTo.getTime() <= d.effectiveFrom.getTime()) {
    chan("HIEU_LUC", "Hiệu lực không hợp lệ: ngày hết hiệu lực phải SAU ngày bắt đầu.", "thong-tin");
  } else if (d.effectiveTo && d.effectiveTo.getTime() <= d.now.getTime()) {
    chan("HIEU_LUC", `Campaign đã hết hiệu lực từ ${ngayVN(d.effectiveTo)} — gia hạn ngày hết hiệu lực trước khi chạy.`, "thong-tin");
  }

  // ── Nguồn mà campaign trỏ tới còn dùng được không ──
  for (const id of idNguon) {
    const n = d.nguon.get(id);
    if (!n) {
      chan("NGUON_MAT", "Có quy tắc hoặc nguồn mặc định đang trỏ tới một nguồn không còn tồn tại — đổi sang nguồn khác.", "quy-tac");
      continue;
    }
    const ly = lyDoNguonKhongDung(n, d.now);
    if (ly) chan("NGUON_KHONG_DUNG", ly, "quy-tac");
  }

  // ── Thưởng: lựa chọn RÕ, và lựa chọn không được trái với chính sách đang áp ──
  const dangAp = phienBanDangAp(d.phienBanChinhSach, d.now);
  if (d.cheDoThuong === null) {
    chan("THUONG_CHUA_CHON", "Chưa chọn «có thưởng» hay «không có mức riêng cho campaign» — chọn một ở mục Hoa hồng (ô trống không phải là «không thưởng»).", "hoa-hong");
  } else if (d.cheDoThuong === "POLICY" && dangAp.length === 0) {
    chan("THUONG_THIEU_CHINH_SACH", "Đã chọn «có thưởng» nhưng chưa có chính sách hoa hồng riêng của campaign nào đang hiệu lực — soạn và kích hoạt chính sách, hoặc chọn «không có mức riêng».", "hoa-hong");
  } else if (d.cheDoThuong === "NONE" && dangAp.length > 0) {
    chan("THUONG_MAU_THUAN", `Đã chọn «không có mức riêng» nhưng campaign đang có ${dangAp.length} chính sách hoa hồng riêng còn hiệu lực — engine vẫn trả theo chúng. Cho chúng hết hiệu lực, hoặc chọn «có thưởng».`, "hoa-hong");
  }

  // ── `AffiliateCampaignRule.policyId` (cột không còn đường ghi): nếu có giá trị thì phải trỏ đúng ──
  const lech = d.quyTac.filter((r) => r.policyId !== null && !r.policyCoPhienBanCuaCampaign);
  if (lech.length > 0) {
    chan(
      "POLICY_RULE_LECH",
      `${lech.length} quy tắc quy nguồn mang liên kết chính sách (policyId) không khớp campaign này — engine chỉ đọc phạm vi của chính sách, không đọc liên kết đó. Xoá quy tắc rồi thêm lại để bỏ liên kết.`,
      "quy-tac",
    );
  }
  return loi;
}

/** Đường tới chỗ sửa một điều kiện chặn. `goc` = đường trang chi tiết (`/nguon-hoa-hong/campaign/<mã>`); mục `thong-tin` sửa ở trang riêng. MỘT nơi dựng. */
export function hrefMucSua(goc: string, muc: MucSuaCampaign): string {
  return muc === "thong-tin" ? `${goc}/sua` : `${goc}#${muc}`;
}

// ── Quy tắc quy nguồn ───────────────────────────────────────────────────────────────────────────────────────

/** `ruleKey` KHỚP CHECK `AffiliateCampaignRule_rule_key_chk`: 'T:<typeId|*>|G:<tagId|*>'. MỘT nơi dựng. */
export function dungRuleKey(typeId: string | null, tagId: string | null): string {
  return `T:${typeId ?? "*"}|G:${tagId ?? "*"}`;
}

export const taoQuyTacSchema = z
  .object({
    typeId: idTuyChon.nullable(),
    tagId: idTuyChon.nullable(),
    sourceGroupId: z.string().trim().min(1, "Chọn nguồn cho quy tắc này.").max(64),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.typeId === null && v.tagId === null) {
      ctx.addIssue({ code: "custom", path: ["typeId"], message: "Chọn loại đối tác, nhãn đối tác, hoặc cả hai. (Muốn áp cho mọi đối tác thì đặt «Nguồn mặc định» của campaign.)" });
    }
  });
export type DauVaoTaoQuyTac = z.infer<typeof taoQuyTacSchema>;

export type KetQuaCong = { ok: true } | { ok: false; truong: string; loi: string };

/**
 * Trạng thái nào được THÊM / XOÁ quy tắc quy nguồn, và có đòi lý do không. MỘT định nghĩa: `kiemDoiQuyTac` (cổng ghi) và khối quy tắc trên trang (vẽ hay không vẽ nút) cùng hỏi nó.
 * Quy tắc quyết nguồn của khách do đối tác giới thiệu, nên đổi nó là đổi cách tính công về sau — cùng luật với tham số ghi nhận: chỉ khi DRAFT hoặc PAUSED, và từ PAUSED phải ghi lý do
 * ≥ 10 ký tự. Đang chạy thì phải tạm dừng trước (cũng nhờ vậy campaign ACTIVE không bao giờ mất hết quy tắc + nguồn mặc định: không có đường nào gỡ chúng khi đang chạy).
 */
export function trangThaiDoiQuyTac(t: TrangThaiCampaign): { duoc: true; canLyDo: boolean } | { duoc: false; lyDo: string } {
  if (t === "ENDED") return { duoc: false, lyDo: "Campaign đã kết thúc — không đổi quy tắc được nữa." };
  if (t === "ACTIVE") {
    return { duoc: false, lyDo: "Campaign đang chạy — tạm dừng campaign trước khi đổi quy tắc quy nguồn (đổi lúc đang chạy là đổi nguồn của khách giới thiệu ngay lập tức)." };
  }
  return { duoc: true, canLyDo: t === "PAUSED" };
}

/**
 * Đổi lựa chọn «thưởng» (AFF-L1). Luật:
 *  · ENDED không đổi nữa. Campaign ĐANG CHẠY đổi được (ví dụ chọn «có thưởng» để rồi soạn chính sách) nhưng phải ghi lý do ≥ 10 ký tự — đó là đổi cách trả tiền của một campaign sống.
 *  · «Không có mức riêng» bị CHẶN khi campaign còn chính sách riêng đang áp: engine áp chính sách CAMPAIGN bất kể lựa chọn này, nên cho lưu là để màn hình nói «không thưởng»
 *    trong khi sổ vẫn ghi tiền. (Chiều ngược lại — kích hoạt chính sách khi đang «không thưởng» — chặn ở `kichHoat` của dịch vụ chính sách.)
 */
export function kiemDoiCheDoThuong(p: { trangThai: TrangThaiCampaign; den: CheDoThuong; lyDo: string | null; phienBanChinhSach: readonly PhienBanCuaCampaign[]; now: Date }): KetQuaCong {
  if (p.trangThai === "ENDED") return { ok: false, truong: "trangThai", loi: "Campaign đã kết thúc — không đổi lựa chọn thưởng nữa." };
  if (p.trangThai === "ACTIVE" && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
    return { ok: false, truong: "lyDo", loi: `Campaign đang chạy: ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự) khi đổi lựa chọn thưởng.` };
  }
  if (p.den === "NONE") {
    const ap = phienBanDangAp(p.phienBanChinhSach, p.now);
    if (ap.length > 0) {
      return { ok: false, truong: "cheDoThuong", loi: `Không chọn được «${NHAN_CHE_DO_THUONG.NONE}»: campaign còn ${ap.length} chính sách hoa hồng riêng đang hiệu lực và engine vẫn trả theo chúng. Cho chúng hết hiệu lực trước (tab Chính sách).` };
    }
  }
  return { ok: true };
}

export function kiemDoiQuyTac(p: { trangThai: TrangThaiCampaign; lyDo: string | null }): KetQuaCong {
  const t = trangThaiDoiQuyTac(p.trangThai);
  if (!t.duoc) return { ok: false, truong: "trangThai", loi: t.lyDo };
  if (t.canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
    return { ok: false, truong: "lyDo", loi: `Ghi lý do đổi quy tắc (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự) — campaign đã từng chạy.` };
  }
  return { ok: true };
}

/** Gắn một website vào campaign. Site TẮT hiện ở danh sách nhưng không gắn mới được. Gắn thêm website khi đang chạy được (mở rộng chỗ đặt link, không đổi cách tính công). */
export function kiemGanWebsite(p: { trangThai: TrangThaiCampaign; site: { status: string } | null; daGan: boolean }): KetQuaCong {
  if (p.trangThai === "ENDED") return { ok: false, truong: "trangThai", loi: "Campaign đã kết thúc — không gắn thêm website được." };
  if (!p.site) return { ok: false, truong: "siteId", loi: "Không tìm thấy website này." };
  if (p.daGan) return { ok: false, truong: "siteId", loi: "Website này đã gắn vào campaign." };
  if (p.site.status !== "ACTIVE") return { ok: false, truong: "siteId", loi: "Website đang tắt — bật lại ở tab Website trước khi gắn vào campaign." };
  return { ok: true };
}

/** Gỡ website. Campaign ĐANG CHẠY phải còn ít nhất một website đang bật sau khi gỡ (cổng kích hoạt đòi điều đó; gỡ nốt cái cuối là phá nó một giây sau). */
export function kiemGoWebsite(p: { trangThai: TrangThaiCampaign; daGan: boolean; soWebsiteBatConLai: number }): KetQuaCong {
  if (p.trangThai === "ENDED") return { ok: false, truong: "trangThai", loi: "Campaign đã kết thúc — không đổi website được nữa." };
  if (!p.daGan) return { ok: false, truong: "siteId", loi: "Website này chưa gắn vào campaign." };
  if (p.trangThai === "ACTIVE" && p.soWebsiteBatConLai < 1) {
    return { ok: false, truong: "siteId", loi: "Campaign đang chạy phải còn ít nhất một website đang bật — gắn website khác trước, hoặc tạm dừng campaign rồi gỡ." };
  }
  return { ok: true };
}

// ── Xem trước nguồn ─────────────────────────────────────────────────────────────────────────────────────────

export type NguonXemTruoc = { id: string; code: string; ten: string; status: string };

/**
 * Dựng ĐẦU VÀO của `giaiNguonCuaDoiTac` (hàm thật của P1) từ dữ liệu đã đọc. MỘT nơi: xem trước và (về sau) đường ghi attribution cùng một phép nối, nên màn xem trước
 * không thể nói một đằng còn P1 làm một nẻo vì nối nhầm trường. Không tự viết lại thứ tự ưu tiên — thứ tự nằm trong `giai-nguon.ts`.
 */
export function dungDauVaoXemTruoc(p: {
  quyTac: readonly QuyTacNguon[];
  campaignMacDinh: string | null;
  doiTac: { loaiId: string | null; nhanIds: readonly string[] };
  loaiMacDinh: string | null;
}): DauVaoGiaiNguon {
  return {
    quyTac: p.quyTac,
    campaignMacDinh: p.campaignMacDinh,
    doiTacLoaiId: p.doiTac.loaiId,
    doiTacNhanIds: p.doiTac.nhanIds,
    loaiMacDinh: p.loaiMacDinh,
  };
}

export type KetQuaXemTruoc =
  | { loai: "NGUON"; nguon: NguonXemTruoc | null; sourceGroupId: string; tu: Exclude<KetQuaGiaiNguon["tu"], "XEM_TAY">; canhBao: string | null }
  | { loai: "XEM_TAY"; lyDo: string };

/** Chạy hàm giải nguồn THẬT rồi gắn tên nguồn + cảnh báo nếu nguồn đó hiện không dùng được. Thiếu cấu hình ⇒ «Cần xem tay» kèm lý do, KHÔNG BAO GIỜ «Không rõ». */
export function xemTruocNguon(p: { dauVao: DauVaoGiaiNguon; nguon: ReadonlyMap<string, NguonXemTruoc & NguonDeKiem>; now: Date }): KetQuaXemTruoc {
  const kq = giaiNguonCuaDoiTac(p.dauVao);
  if (kq.sourceGroupId === null) return { loai: "XEM_TAY", lyDo: kq.lyDo };
  const n = p.nguon.get(kq.sourceGroupId) ?? null;
  return {
    loai: "NGUON",
    nguon: n ? { id: n.id, code: n.code, ten: n.ten, status: n.status } : null,
    sourceGroupId: kq.sourceGroupId,
    tu: kq.tu,
    canhBao: n ? lyDoNguonKhongDung(n, p.now) : "Nguồn này không còn tồn tại — sửa cấu hình campaign.",
  };
}

// ── Kết quả của hàm ghi / action (kiểu thuần — tệp "use server" chỉ được export hàm async) ─────────────────────

export type KetQuaTaoCampaign = { ok: true; id: string; code: string; updatedAt: string } | { ok: false; loi: string; truong?: string };
export type KetQuaSuaCampaign = { ok: true; doi: boolean; truongDoi: TruongSuaCampaign[]; updatedAt: string } | { ok: false; loi: string; truong?: string };
export type KetQuaDoiTrangThaiCampaign = { ok: true; tu: TrangThaiCampaign; den: TrangThaiCampaign; updatedAt: string } | { ok: false; loi: string; truong?: string; lyDoChan?: ChanKichHoat[] };
export type KetQuaViecCon = { ok: true } | { ok: false; loi: string; truong?: string };
export type KetQuaDoiCheDoThuong = { ok: true; doi: boolean; updatedAt: string } | { ok: false; loi: string; truong?: string };

// ── KIỂU DỮ LIỆU GIAO DIỆN NHẬN (dựng ở `doc-campaign.ts`; để ở đây cho thành phần client import mà không kéo `db`) ─────────────────────────────────

export type DongCampaignView = {
  id: string;
  code: string;
  name: string;
  status: TrangThaiCampaign;
  attributionModel: MoHinhGhiNhan;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  soDoiTacHoatDong: number;
  soWebsite: number;
  capNhatLuc: string;
};

export type NguonChonView = { id: string; code: string; ten: string; moTa: string | null };

export type QuyTacView = {
  id: string;
  typeId: string | null;
  tagId: string | null;
  loai: { code: string; ten: string } | null;
  nhan: { code: string; ten: string } | null;
  nguon: { id: string; code: string; ten: string; status: string; chonDuoc: boolean };
};

export type WebsiteView = { id: string; code: string; ten: string; baseUrl: string; status: "ACTIVE" | "INACTIVE" };

/** Trang đích của một website gắn campaign (AFF-L6): `host` là tên miền ĐÃ GIẢI. */
export type TrangDichCuaCampaignView = { id: string; host: string; pathPattern: string; label: string | null; isActive: boolean; trackingEnabled: boolean };
/**
 * Website ĐÃ GẮN vào campaign + các trang đích của nó + trang campaign đã chọn (AFF-L6). `trangDaChon` rỗng = KHÔNG hạn chế (mọi trang đích đang bật của website dùng được); có phần tử = CHỈ các trang đó.
 */
export type WebsiteGanView = WebsiteView & { trangDich: TrangDichCuaCampaignView[]; trangDaChon: string[] };

export type KetQuaDatTrangDich =
  | { ok: true; soLinkAnhHuong: number }
  | { ok: false; loi: string; truong?: string; canXacNhan?: boolean; soLinkAnhHuong?: number };

export type ChiTietCampaignView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: TrangThaiCampaign;
  attributionModel: MoHinhGhiNhan;
  cookieWindowDays: number;
  protectWindowDays: number;
  allowSelfReferral: boolean;
  /** L3a — null = theo loại đối tác. */
  partnerCanViewAmount: boolean | null;
  defaultSourceGroupId: string | null;
  nguonMacDinh: { id: string; code: string; ten: string; status: string; chonDuoc: boolean } | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  activatedAt: string | null;
  capNhatLuc: string;
  quyTac: QuyTacView[];
  website: WebsiteGanView[];
  /** Điều kiện kích hoạt còn thiếu — tính bằng CHÍNH `kiemKichHoatCampaign` mà hàm ghi dùng (nút nói thật, luật 12). Rỗng = kích hoạt được. */
  chanKichHoat: ChanKichHoat[];
  /** Lựa chọn «thưởng» (AFF-L1). `null` = chưa chọn. */
  cheDoThuong: CheDoThuong | null;
  demMembership: Record<"PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED", number>;
};

export type LuaChonCampaignView = {
  nguon: NguonChonView[];
  loai: { id: string; code: string; ten: string }[];
  nhan: { id: string; code: string; ten: string }[];
  website: WebsiteView[];
};

export type DoiTacChonView = {
  id: string;
  code: string;
  ten: string;
  kind: "PERSON" | "ORGANIZATION";
  loai: string | null;
  /** Trạng thái dòng thành viên trong campaign đang xem; null = chưa có dòng. */
  trongCampaign: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" | null;
};

export type DongMembershipView = {
  id: string;
  doiTac: { id: string; code: string; ten: string; kind: "PERSON" | "ORGANIZATION"; loai: string | null; status: string };
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
  groupLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedAt: string | null;
  capNhatLuc: string;
};

export type XemTruocView = {
  doiTac: { id: string; code: string; ten: string; loai: string | null; nhan: string[]; trongCampaign: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" | null };
  ketQua: KetQuaXemTruoc;
};
