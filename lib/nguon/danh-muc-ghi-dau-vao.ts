/**
 * lib/nguon/danh-muc-ghi-dau-vao.ts — LUẬT GHI danh mục nguồn (`LeadSourceGroup`), PHẦN THUẦN (SPEC "nguồn động" 09/10/2026 §4). Không `db`, không đồng hồ.
 *
 * Chia làm hai: tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC (kiểm đầu vào bằng Zod, bảng trường sửa được, bảng chuyển trạng thái); `danh-muc-ghi.ts` đọc DB rồi
 * ghi. Tách để mọi nhánh luật test được không cần Postgres, và để luật không có HAI bản (action, UI, writer cùng hỏi một chỗ — luật 12b).
 *
 * ── Luật (mỗi dòng có ca ở `danh-muc-ghi-dau-vao.test.ts`) ──────────────────────────────────────────────
 *  · `code`: trim + HOA, chữ/số/gạch dưới, 3–40 ký tự; không bắt đầu bằng `MANUAL` ("MANUAL_REVIEW" là TRẠNG THÁI xem tay, không phải nguồn);
 *    không là `UNKNOWN` (nguồn hệ thống). Trùng tính SAU chuẩn hoá ⇒ "paid_ads" và " PAID_ADS " là cùng một mã.
 *  · `code` BẤT BIẾN khi nguồn đã được dùng và với MỌI nguồn hệ thống.
 *  · `referrerRequirement` / `requiresNote` không đổi khi nguồn đã được dùng (lead cũ mang hình dạng cũ: đổi là làm sai hồi tố).
 *  · Nguồn hệ thống chỉ sửa: tên · mô tả · sortOrder · cửa sổ · commissionEnabled · phụ trách. `UNKNOWN` (siết 09/10) CHỈ sửa tên · mô tả · sortOrder: khoá luôn `commissionEnabled`,
 *    cửa sổ ghi công và người/đơn vị phụ trách (engine không bao giờ trả hoa hồng theo nguồn cho UNKNOWN — `dau-vao-chinh-sach.ts` — nên mấy ô ấy mà sửa được là ô nói dối).
 *  · Không xoá cứng bao giờ; hệ thống không LƯU TRỮ; `UNKNOWN` luôn ACTIVE.
 *  · Lý do ≥ 10 ký tự cho mọi đổi NHẠY CẢM (đổi trạng thái trừ kích hoạt bản nháp · cửa sổ · commissionEnabled · phụ trách · hiệu lực · selectable · code).
 */
import { z } from "zod";

export const LY_DO_TOI_THIEU_NGUON = 10;
export const DO_DAI_CODE_TOI_THIEU = 3;
export const DO_DAI_CODE_TOI_DA = 40;
export const CUA_SO_NGAY_TOI_DA = 3650;

/** Nguồn hệ thống DUY NHẤT mà logic được phép so mã (03 T3). */
export const MA_NGUON_KHONG_RO = "UNKNOWN";

export const TIEN_TO_CAM = "MANUAL";

export const TRANG_THAI_NGUON = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type TrangThaiNguon = (typeof TRANG_THAI_NGUON)[number];

/** `SYSTEM` chỉ dành cho UNKNOWN: nguồn do admin tạo không được mang loại này. */
export const LOAI_NGUON_CHON = ["REFERRAL", "MARKETING", "ORGANIC", "OFFLINE", "EVENT", "PARTNER", "OTHER"] as const;
export type LoaiNguonChon = (typeof LOAI_NGUON_CHON)[number];
export type LoaiNguonTatCa = LoaiNguonChon | "SYSTEM";

export const YEU_CAU_NGUOI = ["NONE", "PARENT", "EMPLOYEE", "AFFILIATE_ORG", "EVENT"] as const;
export type YeuCauNguoi = (typeof YEU_CAU_NGUOI)[number];

// ── code ──────────────────────────────────────────────────────────────────────────────────────

/** trim + HOA. Cùng phép với mọi nơi so trùng. */
export function chuanHoaCode(raw: string): string {
  return raw.trim().toUpperCase();
}

const DANG_CODE = /^[A-Z0-9_]+$/;

/** Câu lỗi tiếng Việt cho `code` ĐÃ chuẩn hoá; `null` = hợp lệ. */
export function kiemCode(code: string): string | null {
  if (code.length < DO_DAI_CODE_TOI_THIEU || code.length > DO_DAI_CODE_TOI_DA) {
    return `Mã nguồn dài ${DO_DAI_CODE_TOI_THIEU}–${DO_DAI_CODE_TOI_DA} ký tự (hiện ${code.length}).`;
  }
  if (!DANG_CODE.test(code)) return "Mã nguồn chỉ gồm chữ HOA không dấu, chữ số và gạch dưới (A–Z, 0–9, _).";
  if (code.startsWith(TIEN_TO_CAM)) return `Mã nguồn không được bắt đầu bằng ${TIEN_TO_CAM}: «xem tay» là trạng thái của lead, không phải một nguồn.`;
  if (code === MA_NGUON_KHONG_RO) return "UNKNOWN là nguồn hệ thống — chọn mã khác.";
  return null;
}

// ── Zod ───────────────────────────────────────────────────────────────────────────────────────

const chuoiGon = (toiDa: number) =>
  z
    .string()
    .trim()
    .max(toiDa)
    .transform((v) => (v === "" ? null : v));

const ngay = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Ngày không hợp lệ");
const idTuyChon = z
  .string()
  .trim()
  .max(64)
  .transform((v) => (v === "" ? null : v));

const cuaSo = z.number().int("Cửa sổ ghi công là số ngày nguyên.").min(1, "Cửa sổ ghi công phải ≥ 1 ngày.").max(CUA_SO_NGAY_TOI_DA, `Cửa sổ ghi công tối đa ${CUA_SO_NGAY_TOI_DA} ngày.`);

const ten = z.string().trim().min(2, "Tên nguồn tối thiểu 2 ký tự.").max(120, "Tên nguồn tối đa 120 ký tự.");

/** Hai đầu hiệu lực: thiếu một đầu = mở; có cả hai thì hết hạn phải SAU bắt đầu (cùng CHECK `LeadSourceGroup_hieu_luc_chk`). */
export function kiemHieuLuc(tu: Date | null | undefined, den: Date | null | undefined): string | null {
  if (tu && den && den.getTime() <= tu.getTime()) return "Hết hiệu lực phải SAU ngày bắt đầu.";
  return null;
}

export const taoNguonSchema = z
  .object({
    code: z.string().transform(chuanHoaCode),
    name: ten,
    description: chuoiGon(1000).nullable().default(null),
    sourceType: z.enum(LOAI_NGUON_CHON),
    referrerRequirement: z.enum(YEU_CAU_NGUOI),
    requiresNote: z.boolean(),
    selectable: z.boolean(),
    sortOrder: z.number().int().min(0).max(9998),
    /** Nguồn ra đời ở DRAFT (chưa chọn được) hoặc ACTIVE. KHÔNG mặc định — chỗ gọi phải chọn (nguồn ACTIVE là lead mới chọn được ngay). */
    trangThai: z.enum(["DRAFT", "ACTIVE"]),
    attributionWindowDays: cuaSo.nullable(),
    commissionEnabled: z.boolean(),
    ownerOrgUnitId: idTuyChon.nullable(),
    ownerEmployeeId: idTuyChon.nullable(),
    effectiveFrom: ngay.nullable(),
    effectiveTo: ngay.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const loiCode = kiemCode(v.code);
    if (loiCode) ctx.addIssue({ code: "custom", path: ["code"], message: loiCode });
    const loiHL = kiemHieuLuc(v.effectiveFrom, v.effectiveTo);
    if (loiHL) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: loiHL });
  });
export type DauVaoTaoNguon = z.infer<typeof taoNguonSchema>;

/** Trường sửa được. `undefined` = KHÔNG đổi; `null` = xoá (chỉ với trường cho phép trống). */
export const suaNguonSchema = z
  .object({
    code: z.string().transform(chuanHoaCode).optional(),
    name: ten.optional(),
    description: chuoiGon(1000).nullable().optional(),
    sourceType: z.enum(LOAI_NGUON_CHON).optional(),
    referrerRequirement: z.enum(YEU_CAU_NGUOI).optional(),
    requiresNote: z.boolean().optional(),
    selectable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9998).optional(),
    attributionWindowDays: cuaSo.nullable().optional(),
    commissionEnabled: z.boolean().optional(),
    ownerOrgUnitId: idTuyChon.nullable().optional(),
    ownerEmployeeId: idTuyChon.nullable().optional(),
    effectiveFrom: ngay.nullable().optional(),
    effectiveTo: ngay.nullable().optional(),
  })
  .strict();
export type VaSuaNguon = z.infer<typeof suaNguonSchema>;
export type TruongSua = keyof VaSuaNguon;

// ── Sửa: trường nào được, trường nào cần lý do ─────────────────────────────────────────────────

/** Trường mà nguồn HỆ THỐNG được sửa (SPEC §1.3). */
const TRUONG_HE_THONG: ReadonlySet<TruongSua> = new Set<TruongSua>([
  "name",
  "description",
  "sortOrder",
  "attributionWindowDays",
  "commissionEnabled",
  "ownerOrgUnitId",
  "ownerEmployeeId",
]);

/**
 * Trường mà `UNKNOWN` KHÔNG sửa được dù là nguồn hệ thống: mọi thứ liên quan hoa hồng theo nguồn. UNKNOWN là nhãn «không xác định được nguồn» do HỆ THỐNG gán — không có chủ, không có cửa sổ,
 * không có hoa hồng theo nguồn; cho sửa là cho gắn người phụ trách vào một nguồn không trả tiền cho ai (và FK Restrict còn chặn xoá nhân sự đó).
 */
const TRUONG_UNKNOWN_KHOA: ReadonlySet<TruongSua> = new Set<TruongSua>(["commissionEnabled", "attributionWindowDays", "ownerEmployeeId", "ownerOrgUnitId"]);

/** Trường BẤT BIẾN khi nguồn đã được dùng. */
const TRUONG_KHOA_KHI_DA_DUNG: ReadonlySet<TruongSua> = new Set<TruongSua>(["code", "referrerRequirement", "requiresNote"]);

/** Đổi các trường này là đổi NHẠY CẢM ⇒ bắt lý do ≥ 10 ký tự. Tên · mô tả · thứ tự hiển thị thì không. */
const TRUONG_NHAY_CAM: ReadonlySet<TruongSua> = new Set<TruongSua>([
  "code",
  "sourceType",
  "referrerRequirement",
  "requiresNote",
  "selectable",
  "attributionWindowDays",
  "commissionEnabled",
  "ownerOrgUnitId",
  "ownerEmployeeId",
  "effectiveFrom",
  "effectiveTo",
]);

/**
 * Trường này có phải đổi NHẠY CẢM (bắt lý do ≥ 10 ký tự) không. Giao diện hỏi hàm này để hiện ô «Lý do» NGAY khi người dùng chạm vào trường nhạy cảm — kể cả khi trường còn lỗi định dạng
 * (cổng `kiemSuaNguon` chỉ nói «cần lý do» sau khi mọi lỗi khác hết). MỘT định nghĩa: không bản sao ở giao diện.
 */
export function laTruongNhayCam(k: TruongSua): boolean {
  return TRUONG_NHAY_CAM.has(k);
}

/** Mọi trường của biểu mẫu sửa nguồn — thứ tự hiển thị. */
export const TAT_CA_TRUONG_SUA: readonly TruongSua[] = [
  "name",
  "description",
  "sortOrder",
  "code",
  "sourceType",
  "referrerRequirement",
  "requiresNote",
  "selectable",
  "attributionWindowDays",
  "commissionEnabled",
  "ownerEmployeeId",
  "ownerOrgUnitId",
  "effectiveFrom",
  "effectiveTo",
];

/** Tên TIẾNG VIỆT của từng trường sửa được — dùng trong câu lý do khoá (người dùng không đọc được «sourceType»). */
export const NHAN_TRUONG_SUA: Readonly<Record<TruongSua, string>> = {
  name: "Tên nguồn",
  description: "Mô tả",
  sortOrder: "Thứ tự",
  code: "Mã nguồn",
  sourceType: "Nhóm nguồn",
  referrerRequirement: "Cách xác định nguồn",
  requiresNote: "Bắt buộc giải trình",
  selectable: "Chọn được ở ô nhập",
  attributionWindowDays: "Cửa sổ ghi công",
  commissionEnabled: "Hoa hồng nguồn",
  ownerEmployeeId: "Người phụ trách",
  ownerOrgUnitId: "Phạm vi đơn vị",
  effectiveFrom: "Ngày hiệu lực",
  effectiveTo: "Ngày kết thúc",
};

export type NguonDeSua = {
  code: string;
  isSystem: boolean;
  /** Đã được dùng (attribution / touchpoint / phiên bản chính sách / sổ / Page mapping)? */
  daDung: boolean;
  status: TrangThaiNguon;
};

/**
 * Trường `k` của nguồn này có đang BỊ KHOÁ không — trả câu lý do, hoặc `null` nếu sửa được. MỘT hàm cho CẢ cổng ghi (`kiemSuaNguon`) lẫn giao diện (ô `disabled`
 * kèm lý do): hai nơi tự viết điều kiện là một ô vẽ sửa được mà bấm Lưu mới bị từ chối, hoặc ngược lại — chính cái bẫy affordance nói dối (luật 12).
 */
export function lyDoKhoaTruong(nguon: Pick<NguonDeSua, "code" | "isSystem" | "daDung">, k: TruongSua): string | null {
  if (nguon.isSystem && !TRUONG_HE_THONG.has(k)) {
    return `Nguồn hệ thống — không đổi được «${NHAN_TRUONG_SUA[k]}».`;
  }
  if (nguon.daDung && TRUONG_KHOA_KHI_DA_DUNG.has(k)) {
    return k === "code"
      ? "Nguồn đã có lead, chính sách, sổ hoa hồng hoặc Page tham chiếu — không đổi được mã. Muốn dùng mã khác: tạo nguồn mới và ngừng nguồn này."
      : `Nguồn đã được dùng — không đổi «${k === "referrerRequirement" ? "yêu cầu người giới thiệu" : "bắt buộc giải trình"}» được (lead cũ mang hình dạng cũ).`;
  }
  if (nguon.code === MA_NGUON_KHONG_RO && TRUONG_UNKNOWN_KHOA.has(k)) {
    return k === "commissionEnabled"
      ? "UNKNOWN không bao giờ có hoa hồng theo nguồn — không bật được."
      : `UNKNOWN là nhãn hệ thống tự gán — không có «${NHAN_TRUONG_SUA[k]}».`;
  }
  return null;
}

/** Danh sách trường đang bị khoá kèm lý do — giao diện vẽ ô `disabled` từ đây. */
export function truongBiKhoa(nguon: Pick<NguonDeSua, "code" | "isSystem" | "daDung">): { truong: TruongSua; lyDo: string }[] {
  return TAT_CA_TRUONG_SUA.flatMap((k) => {
    const lyDo = lyDoKhoaTruong(nguon, k);
    return lyDo ? [{ truong: k, lyDo }] : [];
  });
}

export type KetQuaKiemSua = { ok: true; truongDoi: TruongSua[]; nhayCam: boolean } | { ok: false; loi: string; truong: TruongSua | "lyDo" | "trangThai" };

/** Giá trị HIỆN TẠI để biết trường nào THẬT SỰ đổi (gửi lại nguyên giá trị cũ không phải là đổi — biểu mẫu gửi lại mọi ô mỗi lần Lưu). */
export type GiaTriNguon = {
  code: string;
  name: string;
  description: string | null;
  sourceType: LoaiNguonTatCa;
  referrerRequirement: YeuCauNguoi;
  requiresNote: boolean;
  selectable: boolean;
  sortOrder: number;
  attributionWindowDays: number | null;
  commissionEnabled: boolean;
  ownerOrgUnitId: string | null;
  ownerEmployeeId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

const bang = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return a === b;
};

/** Trường nào của `patch` KHÁC giá trị hiện tại. */
export function truongThatSuDoi(hienTai: GiaTriNguon, patch: VaSuaNguon): TruongSua[] {
  const ra: TruongSua[] = [];
  for (const k of Object.keys(patch) as TruongSua[]) {
    const moi = patch[k];
    if (moi === undefined) continue;
    if (!bang(hienTai[k], moi)) ra.push(k);
  }
  return ra;
}

/**
 * Cổng sửa. THUẦN. `hienTai` + `nguon` do nơi gọi đọc TRONG transaction (sau khoá hàng).
 * Lý do được truyền để cổng này là nơi DUY NHẤT quyết "đổi nhạy cảm cần lý do".
 */
export function kiemSuaNguon(p: { nguon: NguonDeSua; hienTai: GiaTriNguon; patch: VaSuaNguon; lyDo: string | null }): KetQuaKiemSua {
  const { nguon, hienTai, patch } = p;
  const truongDoi = truongThatSuDoi(hienTai, patch);
  if (truongDoi.length === 0) return { ok: true, truongDoi, nhayCam: false };

  for (const k of truongDoi) {
    const khoa = lyDoKhoaTruong(nguon, k);
    if (khoa) return { ok: false, loi: khoa, truong: k };
  }
  if (patch.code !== undefined) {
    const loiCode = kiemCode(patch.code);
    if (loiCode) return { ok: false, loi: loiCode, truong: "code" };
  }
  if (patch.sourceType !== undefined && truongDoi.includes("sourceType") && !nguon.isSystem && (patch.sourceType as string) === "SYSTEM") {
    return { ok: false, loi: "Loại SYSTEM chỉ dành cho nguồn hệ thống.", truong: "sourceType" };
  }
  const tu = patch.effectiveFrom !== undefined ? patch.effectiveFrom : hienTai.effectiveFrom;
  const den = patch.effectiveTo !== undefined ? patch.effectiveTo : hienTai.effectiveTo;
  const loiHL = kiemHieuLuc(tu, den);
  if (loiHL) return { ok: false, loi: loiHL, truong: "effectiveTo" };

  const nhayCam = truongDoi.some((k) => TRUONG_NHAY_CAM.has(k));
  if (nhayCam && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_NGUON) {
    return { ok: false, loi: `Đổi thông tin này cần lý do từ ${LY_DO_TOI_THIEU_NGUON} ký tự.`, truong: "lyDo" };
  }
  return { ok: true, truongDoi, nhayCam };
}

// ── Đổi trạng thái ────────────────────────────────────────────────────────────────────────────

/** Bảng chuyển trạng thái. DRAFT chỉ đi ra, không quay lại. Lưu trữ khôi phục về INACTIVE (không thẳng ACTIVE: phải kích hoạt có chủ đích). */
const CHUYEN: Readonly<Record<TrangThaiNguon, readonly TrangThaiNguon[]>> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["INACTIVE"],
};

export type KetQuaKiemTrangThai = { ok: true; nhayCam: boolean } | { ok: false; loi: string; truong: "trangThai" | "lyDo" };

export function kiemDoiTrangThai(p: { nguon: Pick<NguonDeSua, "code" | "isSystem" | "status">; den: TrangThaiNguon; lyDo: string | null }): KetQuaKiemTrangThai {
  const { nguon, den } = p;
  if (nguon.status === den) return { ok: false, loi: "Nguồn đã ở trạng thái này.", truong: "trangThai" };
  if (nguon.code === MA_NGUON_KHONG_RO) return { ok: false, loi: "UNKNOWN luôn ở trạng thái hoạt động — hệ thống dùng nó khi không xác định được nguồn.", truong: "trangThai" };
  if (nguon.isSystem && den === "ARCHIVED") return { ok: false, loi: "Nguồn hệ thống không lưu trữ được.", truong: "trangThai" };
  if (!CHUYEN[nguon.status].includes(den)) return { ok: false, loi: `Không chuyển được từ «${nguon.status}» sang «${den}».`, truong: "trangThai" };
  // Kích hoạt BẢN NHÁP là việc đương nhiên của người tạo; mọi chuyển khác (ngừng · mở lại · lưu trữ · khôi phục) đổi cái lead mới chọn được ⇒ cần lý do.
  const nhayCam = !(nguon.status === "DRAFT" && den === "ACTIVE");
  if (nhayCam && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_NGUON) {
    return { ok: false, loi: `Đổi trạng thái nguồn cần lý do từ ${LY_DO_TOI_THIEU_NGUON} ký tự.`, truong: "lyDo" };
  }
  return { ok: true, nhayCam };
}

/**
 * Các trạng thái mà nguồn này CHUYỂN SANG được THEO BẢNG CHUYỂN (bỏ qua lý do). Đi qua CHÍNH `kiemDoiTrangThai`, nhưng đó mới là MỘT trong các cổng của `doiTrangThaiNguon`: đích mặc định, nguồn chưa có
 * người phụ trách khi rule chủ-nguồn chạy, và quyền «đụng tiền» là ba cổng nữa. Muốn biết NÚT nào vẽ được thì dùng `thaoTacTrangThai` (lib/nguon/form-nguon.ts), hàm chạy lại cả bốn — dùng hàm này để vẽ nút
 * là vẽ lời hứa suông (W2, res2 R2-M1; bản cũ ghi «nút và cổng ghi không thể lệch nhau» và nói quá).
 */
export function chuyenTrangThaiDuoc(nguon: Pick<NguonDeSua, "code" | "isSystem" | "status">): TrangThaiNguon[] {
  return TRANG_THAI_NGUON.filter((den) => kiemDoiTrangThai({ nguon, den, lyDo: "x".repeat(LY_DO_TOI_THIEU_NGUON) }).ok);
}

/**
 * Nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn (`maDichMacDinh`: `DICH_MAC_DINH` · `DUONG_VAO_MAC_DINH` · bảng Page→nguồn · setting `nguon.nhomNhanSuMacDinh`) mà bị làm cho
 * KHÔNG CHỌN ĐƯỢC cho lead MỚI ⇒ luật tương ứng gãy IM LẶNG và lead rơi xuống UNKNOWN (res3 MEDIUM-5 · res4 LOW-2). "Không chọn được" gồm: rời ACTIVE, tắt `selectable`, và MỌI
 * cửa sổ hiệu lực có giới hạn — kể cả hạn ở TƯƠNG LAI: `effectiveTo` đặt hôm nay là quả bom hẹn giờ (đúng ngày đó mọi lead mới rớt UNKNOWN mà không ai bấm gì), và
 * `effectiveFrom` ở tương lai là nguồn chưa mở. Đích mặc định là hạ tầng của quy nguồn: muốn ngừng nó phải trỏ cấu hình sang nguồn khác TRƯỚC.
 *
 * Trả `null` = được; không thì câu lỗi + ô gắn lỗi. `den` / `selectableMoi` / `hieuLucMoi` = giá trị SAU khi sửa; vắng = không đổi.
 */
export function lamHongDichMacDinh(p: {
  code: string;
  dichMacDinh: ReadonlySet<string>;
  /** Đồng hồ — BẮT BUỘC (luật 19). */
  now: Date;
  den?: TrangThaiNguon;
  selectableMoi?: boolean;
  hieuLucMoi?: { effectiveFrom: Date | null; effectiveTo: Date | null };
}): { truong: "trangThai" | "selectable" | "effectiveFrom" | "effectiveTo"; loi: string } | null {
  if (!p.dichMacDinh.has(p.code)) return null;
  const goi = "đang là nguồn MẶC ĐỊNH của quy nguồn (đích của luật quảng cáo / phụ huynh / nhân sự / đường vào / Page)";
  if (p.den !== undefined && p.den !== "ACTIVE") {
    return { truong: "trangThai", loi: `Nguồn này ${goi} — trỏ cấu hình sang nguồn khác trước (Cấu hình vận hành · bảng nguồn theo Page), rồi mới ngừng.` };
  }
  if (p.selectableMoi === false) {
    return { truong: "selectable", loi: `Nguồn này ${goi} — trỏ cấu hình sang nguồn khác trước, rồi mới tắt chọn.` };
  }
  const hl = p.hieuLucMoi;
  if (hl && hl.effectiveTo !== null) {
    return { truong: "effectiveTo", loi: `Nguồn này ${goi} nên không đặt được ngày hết hiệu lực (kể cả ngày ở tương lai: đúng ngày đó mọi lead mới rơi về «không rõ nguồn»). Trỏ cấu hình sang nguồn khác trước.` };
  }
  if (hl && hl.effectiveFrom !== null && hl.effectiveFrom.getTime() > p.now.getTime()) {
    return { truong: "effectiveFrom", loi: `Nguồn này ${goi} nên không đặt được ngày bắt đầu ở tương lai (nguồn chưa mở thì lead mới rơi về «không rõ nguồn»).` };
  }
  return null;
}

/**
 * MỘT CỔNG «ĐỤNG TIỀN» cho MỌI đường ghi vào danh mục nguồn (sửa · tạo · đổi trạng thái · gán Page) — W2, 10/10/2026 (res3 R3-M2/M3). Luật: đổi thứ quyết định AI NHẬN TIỀN của một nguồn
 * đang dính tiền là việc của người có quyền kích hoạt chính sách (`commission_policies:activate`), không chỉ `sources:manage`. Hai tầng, cùng một hàm:
 *
 *  1. NGƯỜI NHẬN TIỀN / CÓ TRẢ HAY KHÔNG (`TRUONG_DOI_NGUOI_NHAN_TIEN`): người phụ trách · tham gia hoa hồng · cửa sổ ghi công. Đòi quyền khi nguồn có chính sách chạy HOẶC đã có dòng sổ
 *     (res4 HIGH-1, 09/10/2026).
 *  2. KHẢ NĂNG NHẬN LEAD (`TRUONG_DOI_KHA_NANG_NHAN_LEAD`): trạng thái · chọn được · hiệu lực. Ngừng/lưu trữ/hạn một nguồn đang có chính sách ACTIVE (hoặc có chủ hưởng theo rule SOURCE_OWNER) là
 *     đổi mọi lead MỚI sẽ được trả theo chính sách nào — cũng đụng tiền. Tầng này CHỈ đòi quyền khi `dangDinhTienTheoRule` (`nguonDangDinhTienTheoRule`); `daCoDongSo` không kéo theo vì sổ cũ
 *     không đổi khi lead mới chọn nguồn khác.
 *
 * Tên · mô tả · thứ tự hiển thị · nhóm nguồn thì không. QUYẾT ĐỊNH về chỗ đặt cổng (10/10/2026): cổng đứng ở nơi tiền BẮT ĐẦU chảy — tạo/kích hoạt/mở lại một nguồn ACTIVE có chủ khi rule chủ-nguồn
 * đang chạy, hay rời ACTIVE khi có chính sách — chứ KHÔNG ở lúc «tạo bản nháp»: nếu chỉ chặn tạo ACTIVE thì «tạo Nháp rồi Kích hoạt» đi vòng qua cổng.
 */
export const TRUONG_DOI_NGUOI_NHAN_TIEN: readonly TruongSua[] = ["ownerEmployeeId", "commissionEnabled", "attributionWindowDays"];

/** Trạng thái không phải trường của biểu mẫu sửa nhưng là một «trường đụng tiền» của cổng. */
export type TruongDungTien = TruongSua | "status";

export const TRUONG_DOI_KHA_NANG_NHAN_LEAD: readonly TruongDungTien[] = ["status", "selectable", "effectiveFrom", "effectiveTo"];

/**
 * Nguồn này có «đang dính tiền theo rule» không: có chính sách RIÊNG đang ACTIVE, hoặc nguồn CÓ CHỦ mà rule vai SOURCE_OWNER đang chạy trên nó (rule của chính nguồn hoặc rule không gắn nguồn nào).
 * `ruleChuChay` = `ruleChuChayChoNguon` ở `dinh-tien-nguon.ts`.
 */
export function nguonDangDinhTienTheoRule(p: { chinhSachRieng: boolean; coChu: boolean; ruleChuChay: boolean }): boolean {
  return p.chinhSachRieng || (p.coChu && p.ruleChuChay);
}

/**
 * Lượt ghi này có đòi thêm quyền kích hoạt không. THUẦN: các cờ «nguồn đang dính tiền» do tầng ghi đọc DB rồi đưa vào.
 *  · `chinhSachDangChay` — chính sách RIÊNG ACTIVE, hoặc (đổi chủ ∧ có rule chủ-nguồn ở bất kỳ phạm vi) — tầng 1;
 *  · `daCoDongSo` — nguồn đã có dòng sổ — tầng 1;
 *  · `dangDinhTienTheoRule` — `nguonDangDinhTienTheoRule` — tầng 2.
 * Tạo nguồn / đổi trạng thái đi qua cùng hàm với `truongDoi: ["status"]` (hoặc `[]` khi tạo bản nháp).
 */
export function canQuyenKichHoat(p: { truongDoi: readonly TruongDungTien[]; chinhSachDangChay: boolean; daCoDongSo: boolean; dangDinhTienTheoRule: boolean }): boolean {
  const doiNguoiNhan = p.truongDoi.some((k) => (TRUONG_DOI_NGUOI_NHAN_TIEN as readonly TruongDungTien[]).includes(k)) && (p.chinhSachDangChay || p.daCoDongSo);
  const doiKhaNangNhan = p.truongDoi.some((k) => TRUONG_DOI_KHA_NANG_NHAN_LEAD.includes(k)) && p.dangDinhTienTheoRule;
  return doiNguoiNhan || doiKhaNangNhan;
}

/** Gán / dời / gỡ nguồn của một Page: đòi quyền khi nguồn CŨ hoặc nguồn MỚI dính tiền theo rule — dời Page là đổi người nhận tiền của MỌI lead tương lai của Page đó. */
export function canQuyenKichHoatGanPage(p: { nguonCu: boolean; nguonMoi: boolean }): boolean {
  return canQuyenKichHoat({ truongDoi: ["status"], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: p.nguonCu || p.nguonMoi });
}

/** Câu lỗi nếu lý do đổi Page → nguồn quá ngắn; `null` = đủ. Mọi lượt ĐỔI Page đều đổi người nhận tiền nên lý do luôn bắt buộc (khác sửa nguồn: tên/mô tả không cần). */
export function loiLyDoGanPage(lyDo: string | null): string | null {
  return (lyDo ?? "").trim().length >= LY_DO_TOI_THIEU_NGUON ? null : `Đổi nguồn của Page cần lý do từ ${LY_DO_TOI_THIEU_NGUON} ký tự — nó đổi người nhận hoa hồng của mọi lead tương lai từ Page này.`;
}

/**
 * MỘT câu cho «thiếu quyền kích hoạt chính sách» — máy chủ (`danh-muc-ghi.ts`) và biểu mẫu (`form-nguon.ts` · nút trạng thái · hộp thoại Page) cùng dùng: người đọc thấy một câu trước hay sau khi bấm.
 * Nêu ĐỦ các việc đụng tiền (người phụ trách · hoa hồng · cửa sổ · trạng thái · chọn được/hiệu lực); bản cũ liệt kê ba việc nên nói thiếu khi cổng đòi cho việc thứ tư.
 */
export const CAU_THIEU_QUYEN_KICH_HOAT =
  "Nguồn này đang có chính sách hoa hồng hoạt động (hoặc đã có dòng sổ, hoặc có người phụ trách đang được trả theo chính sách) — đổi người phụ trách, «tham gia hoa hồng», cửa sổ ghi công, trạng thái hay khả năng chọn được của nguồn là đổi ai nhận tiền, cần thêm quyền kích hoạt chính sách (commission_policies:activate). Nhờ Quản trị hệ thống hoặc Giám đốc.";

/** «Thiếu quyền kích hoạt» nói theo việc ĐỔI NGUỒN CỦA PAGE (câu chung nói về các trường của nguồn — nói vậy ở hộp thoại Page là lạc đề). Máy chủ và hộp thoại cùng dùng. */
export const CAU_THIEU_QUYEN_GAN_PAGE =
  "Một trong hai nguồn (cũ hoặc mới) đang có chính sách hoa hồng hoạt động hoặc có người phụ trách đang được trả theo chính sách — đổi nguồn của Page là đổi ai nhận hoa hồng của mọi lead mới từ Page này, cần thêm quyền kích hoạt chính sách (commission_policies:activate). Nhờ Quản trị hệ thống hoặc Giám đốc.";

/**
 * TẮT `commissionEnabled` của nguồn có chính sách RIÊNG đang ACTIVE chứa dòng THU HÚT (mọi dòng trừ EXCLUDE — đúng vị từ `laDongThuHut` của engine) ⇒ CHẶN, kể cả người có đủ quyền: cờ tắt khiến
 * engine bỏ qua các dòng đó IM LẶNG (vd 1% Marketing của nguồn quảng cáo biến mất, dòng EXCLUDE vẫn chạy nên không có hold nào báo) — res1 R1-M1. Chính sách chỉ gồm EXCLUDE thì tắt được
 * (engine cho dòng EXCLUDE chạy ở nguồn tắt cờ). Đường lui nằm TRONG câu lỗi: ngừng/chuyển chính sách trước. THUẦN: cờ do tầng ghi đọc DB trong transaction.
 */
export function chanTatHoaHongNguon(p: { truongDoi: readonly TruongSua[]; commissionEnabledMoi: boolean | undefined; coDongThuHutRieng: boolean }): { truong: "commissionEnabled"; loi: string } | null {
  if (!p.truongDoi.includes("commissionEnabled") || p.commissionEnabledMoi !== false || !p.coDongThuHutRieng) return null;
  return {
    truong: "commissionEnabled",
    loi: "Nguồn này có chính sách riêng với dòng thu hút (vd 1% Marketing): tắt «tham gia hoa hồng» làm các dòng đó ngừng chạy mà không báo — tiền biến mất khỏi mọi khoản thu mới. Ngừng hoặc chuyển chính sách riêng này sang phạm vi chung (mục Chính sách hoa hồng) trước, rồi mới tắt.",
  };
}

/**
 * Bỏ trống người phụ trách của nguồn mà đang có rule vai `SOURCE_OWNER` chạy (rule của CHÍNH nguồn, hoặc rule phạm vi chung) ⇒ mọi khoản thu của nguồn thành hold
 * `NGUON_CHUA_CO_NGUOI_PHU_TRACH` và không ai gỡ được trừ khi khai lại người — chặn ngay ở nơi sửa thay vì để hold chất lên (chính guardrail kích hoạt cũng chặn đúng ca này
 * lúc kích hoạt; hàm này khoá nốt đường ĐI SAU kích hoạt). THUẦN: cờ rule do tầng ghi đọc DB trong transaction. Chuyển sang NGƯỜI KHÁC thì không chặn ở đây
 * (người đã nghỉ bị `kiemNguoiPhuTrach` từ chối riêng).
 */
export function chanBoChuNguon(p: { truongDoi: readonly TruongSua[]; ownerMoi: string | null; ruleChuNguonDangChay: boolean }): { truong: "ownerEmployeeId"; loi: string } | null {
  if (!p.truongDoi.includes("ownerEmployeeId") || p.ownerMoi !== null || !p.ruleChuNguonDangChay) return null;
  return {
    truong: "ownerEmployeeId",
    loi: "Nguồn này đang có chính sách hoa hồng trả cho người phụ trách nguồn — không bỏ trống người phụ trách được (mọi khoản thu của nguồn sẽ vào hàng chờ và không ai nhận). Chọn người phụ trách khác thay vì xoá, hoặc ngừng chính sách đó trước.",
  };
}

/**
 * Nguồn ĐANG HOẠT ĐỘNG mà không có người phụ trách khi rule vai `SOURCE_OWNER` đang chạy ⇒ cùng hold vĩnh viễn như `chanBoChuNguon`, nhưng sinh từ hai đường khác: TẠO nguồn Hoạt động
 * không khai người, và KÍCH HOẠT một nguồn nháp/đã ngừng chưa có người. (Guardrail kích hoạt chính sách chỉ canh MỘT chiều — chính sách mới vào khi đã có nguồn thiếu người; chiều
 * ngược — nguồn mới vào khi chính sách đã chạy — chỉ canh được ở nơi ghi nguồn.) Nháp / không hoạt động thì không có lead nào chọn được nên chưa sinh hold. THUẦN: cờ rule do tầng ghi đọc DB.
 */
export function chanNguonHoatDongKhongChu(p: {
  viec: "tao" | "kich-hoat";
  trangThaiSau: TrangThaiNguon;
  ownerSau: string | null;
  ruleChuNguonDangChay: boolean;
}): { truong: "ownerEmployeeId" | "trangThai"; loi: string } | null {
  if (p.trangThaiSau !== "ACTIVE" || p.ownerSau !== null || !p.ruleChuNguonDangChay) return null;
  const nguyenNhan =
    "Đang có chính sách hoa hồng trả cho người phụ trách nguồn — nguồn Hoạt động mà chưa có người phụ trách thì mọi khoản thu của nguồn sẽ vào hàng chờ và không ai nhận.";
  return p.viec === "tao"
    ? { truong: "ownerEmployeeId", loi: `${nguyenNhan} Khai người phụ trách, hoặc tạo ở trạng thái Nháp rồi khai sau.` }
    : { truong: "trangThai", loi: `${nguyenNhan} Khai người phụ trách (Sửa nguồn) trước khi kích hoạt.` };
}

/** Tên hành động audit cho một lượt SỬA — gọi đúng việc người ta quan tâm khi đọc nhật ký («đổi cửa sổ», «đổi người phụ trách»). */
export function tenHanhDongSua(truongDoi: readonly TruongSua[]): string {
  const chi = (...ok: TruongSua[]) => truongDoi.length > 0 && truongDoi.every((k) => ok.includes(k));
  if (chi("attributionWindowDays")) return "NGUON_DOI_CUA_SO";
  if (chi("ownerEmployeeId", "ownerOrgUnitId")) return "NGUON_DOI_PHU_TRACH";
  if (chi("commissionEnabled")) return "NGUON_DOI_HOA_HONG";
  return "NGUON_SUA";
}

/** Tên hành động audit cho một lượt ĐỔI TRẠNG THÁI. */
export function tenHanhDongTrangThai(tu: TrangThaiNguon, den: TrangThaiNguon): string {
  if (den === "ARCHIVED") return "NGUON_LUU_TRU";
  if (tu === "ARCHIVED") return "NGUON_KHOI_PHUC";
  if (den === "INACTIVE") return "NGUON_NGUNG";
  return tu === "DRAFT" ? "NGUON_KICH_HOAT" : "NGUON_MO_LAI";
}

// ── Chọn được hay không: MỘT định nghĩa ở `hieu-luc-nguon.ts` (không kéo Zod vào trình duyệt) ───────────────

export { nguonChonDuoc, trongKhoangHieuLuc, type NguonChonDuocTho } from "./hieu-luc-nguon";
