/**
 * lib/affiliate/ghi-doi-tac-dau-vao.ts — LUẬT GHI ĐỐI TÁC AFFILIATE, PHẦN THUẦN (AFF-P0b). Không `db`, không đồng hồ, không đọc `./index` (tệp đó kéo Prisma).
 *
 * Chia làm hai (khuôn `lib/nguon/danh-muc-ghi-dau-vao.ts`): tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC (Zod, bảng chuyển trạng thái, luật mã `?ref=`, quan hệ tổ chức);
 * `ghi-doi-tac.ts` đọc DB rồi ghi. Tách để mọi nhánh luật test được không cần Postgres, để component CLIENT dùng lại đúng bảng chuyển trạng thái mà máy chủ dùng (nút và cổng
 * ghi không thể lệch nhau — luật 12), và để luật không có HAI bản.
 *
 * ── Luật (mỗi dòng có ca ở `ghi-doi-tac-dau-vao.test.ts`) ──────────────────────────────────────────────────────
 *  · MÃ `?ref=`: A–Z, 0–9, 3–32 ký tự — KHÁC mã loại/nhãn (`chuanHoaMa`: có gạch dưới, 3–40). Người gõ `an-nguyen` ⇒ `ANNGUYEN` (giữ ngữ nghĩa của `normalizeAffiliateCode`
 *    cũ, vẫn đang chạy ở `resolveAffiliateByCode`). Khác bản cũ ở MỘT điểm: quá 32 ký tự thì TỪ CHỐI, không lặng lẽ cắt — mã bị cắt là một link khác với link người ta tưởng đã in.
 *  · Cá nhân/tổ chức: tổ chức KHÔNG có cha và KHÔNG gắn nhân viên; cha PHẢI là tổ chức, con PHẢI là cá nhân (CHECK của migration chỉ chặn được «tổ chức có cha» và «tự làm cha»).
 *  · Trạng thái: DRAFT→PENDING|ACTIVE(loại không cần duyệt)|ENDED · PENDING→ACTIVE|ENDED · ACTIVE↔SUSPENDED · →ENDED; ENDED là cuối. Lý do ≥ 10 ký tự khi SUSPENDED / ENDED.
 *  · `isActive` LUÔN = (status = ACTIVE): `laDangHoatDong` là nơi duy nhất định nghĩa; `ghi-doi-tac.ts` ghi cả hai qua đúng một hàm.
 *  · Đối tác mới KHÔNG bao giờ ra đời ở DRAFT: loại không cần duyệt ⇒ ACTIVE, ngược lại PENDING (`trangThaiKhiTao`). DRAFT chỉ còn cho dòng cũ/nhập từ ngoài.
 */
import { z } from "zod";

export const LY_DO_TOI_THIEU_DOI_TAC = 10;
export const MA_DOI_TAC_NGAN_NHAT = 3;
export const MA_DOI_TAC_DAI_NHAT = 32;
/** Trần số nhãn trên một đối tác — chặn payload phình, không phải luật nghiệp vụ. */
export const NHAN_TOI_DA_MOT_DOI_TAC = 20;

export const KIEU_DOI_TAC = ["PERSON", "ORGANIZATION"] as const;
export type KieuDoiTac = (typeof KIEU_DOI_TAC)[number];
export const NHAN_KIEU_DOI_TAC: Readonly<Record<KieuDoiTac, string>> = { PERSON: "Cá nhân", ORGANIZATION: "Tổ chức" };

export const TRANG_THAI_DOI_TAC = ["DRAFT", "PENDING", "ACTIVE", "SUSPENDED", "ENDED"] as const;
export type TrangThaiDoiTac = (typeof TRANG_THAI_DOI_TAC)[number];
export const NHAN_TRANG_THAI_DOI_TAC: Readonly<Record<TrangThaiDoiTac, string>> = {
  DRAFT: "Nháp",
  PENDING: "Chờ duyệt",
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm dừng",
  ENDED: "Đã kết thúc",
};

/** `Affiliate.isActive` (cột cũ, `resolveAffiliateByCode` còn đọc) suy từ trạng thái. NƠI DUY NHẤT định nghĩa — đừng viết `status === "ACTIVE"` ở chỗ khác để gán `isActive`. */
export function laDangHoatDong(trangThai: TrangThaiDoiTac): boolean {
  return trangThai === "ACTIVE";
}

/** Trạng thái lúc TẠO: loại không cần duyệt ⇒ ACTIVE ngay; còn lại PENDING. Loại chưa rõ (null) ⇒ PENDING — đóng, không mở. */
export function trangThaiKhiTao(loaiCanDuyet: boolean | null): TrangThaiDoiTac {
  return loaiCanDuyet === false ? "ACTIVE" : "PENDING";
}

// ── Mã ?ref= ──────────────────────────────────────────────────────────────────────────────────────

/** Bỏ dấu, `đ → D`, chữ HOA, chỉ giữ A–Z/0–9. KHÔNG cắt, KHÔNG kiểm độ dài. */
function bongMa(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export type KetQuaMa = { ok: true; ma: string } | { ok: false; loi: string };

/** Mã người gõ → mã lưu. Cùng phép với `normalizeAffiliateCode` (lib/affiliate/index.ts) trừ việc quá dài thì TỪ CHỐI thay vì cắt. */
export function chuanHoaMaDoiTac(raw: string | null | undefined): KetQuaMa {
  const ma = bongMa(raw ?? "");
  if (ma.length < MA_DOI_TAC_NGAN_NHAT) {
    return { ok: false, loi: `Mã giới thiệu cần ${MA_DOI_TAC_NGAN_NHAT}–${MA_DOI_TAC_DAI_NHAT} ký tự gồm chữ và số (hiện ${ma.length}).` };
  }
  if (ma.length > MA_DOI_TAC_DAI_NHAT) {
    return { ok: false, loi: `Mã giới thiệu tối đa ${MA_DOI_TAC_DAI_NHAT} ký tự (hiện ${ma.length}).` };
  }
  return { ok: true, ma };
}

// ⚠️ Đã GỠ hằng «gốc link công khai» và hàm dựng «link mẫu» (AFF-WEB): mã này không còn được quảng bá như một LINK. Cơ chế `?ref=<mã>` cũ vẫn gắn lead trên site công khai, nhưng link giới thiệu
// nay tạo ở tab «Link / QR / Mã» (địa chỉ đích lấy từ website đã khai); gốc link ngắn `/r/<token>` ở `goc-cong-khai.ts`. Lưới ghim: `khong-ten-mien-cung.test.ts` [AFF-WEB-10].

/** Gợi ý mã từ tên (≤ 16 ký tự). Rỗng khi tên quá ngắn — người dùng tự gõ. Chỉ là GỢI Ý: trùng mã vẫn do máy chủ chặn. */
export function goiYMaTuTen(ten: string): string {
  const ma = bongMa(ten).slice(0, 16);
  return ma.length >= MA_DOI_TAC_NGAN_NHAT ? ma : "";
}

// ── Trạng thái ─────────────────────────────────────────────────────────────────────────────────────

export type ThaoTacDoiTac = {
  den: TrangThaiDoiTac;
  /** Chữ nút / dòng chọn. */
  nhan: string;
  /** Một câu nói việc này làm gì. */
  moTa: string;
  /** Đòi lý do ≥ 10 ký tự. */
  canLyDo: boolean;
};

const CAN_LY_DO: ReadonlySet<TrangThaiDoiTac> = new Set(["SUSPENDED", "ENDED"]);

/**
 * Danh sách thao tác ĐƯỢC từ một trạng thái — cho giao diện vẽ nút VÀ cho `kiemDoiTrangThai` cùng dùng. `loaiCanDuyet` chỉ ảnh hưởng DRAFT: loại cần duyệt thì không nhảy thẳng sang ACTIVE.
 * Loại chưa rõ (null) coi như CẦN duyệt (đóng, không mở).
 */
export function thaoTacDoiTac(tu: TrangThaiDoiTac, loaiCanDuyet: boolean | null): ThaoTacDoiTac[] {
  const t = (den: TrangThaiDoiTac, nhan: string, moTa: string): ThaoTacDoiTac => ({ den, nhan, moTa, canLyDo: CAN_LY_DO.has(den) });
  switch (tu) {
    case "DRAFT":
      return [
        t("PENDING", "Gửi duyệt", "Chuyển sang chờ duyệt."),
        ...(loaiCanDuyet === false ? [t("ACTIVE", "Kích hoạt", "Cho đối tác hoạt động ngay (loại này không cần duyệt).")] : []),
        t("ENDED", "Kết thúc", "Đóng hẳn đối tác. Không mở lại được; lead, nguồn và sổ đã ghi vẫn giữ nguyên."),
      ];
    case "PENDING":
      return [
        t("ACTIVE", "Duyệt", "Cho đối tác hoạt động; ghi lại người duyệt và thời điểm."),
        t("ENDED", "Từ chối", "Đóng hẳn đối tác chưa được duyệt. Không mở lại được."),
      ];
    case "ACTIVE":
      return [
        t("SUSPENDED", "Tạm dừng", "Mã giới thiệu của đối tác ngừng gắn lead mới; lead đã gắn vẫn giữ. Có thể kích hoạt lại."),
        t("ENDED", "Kết thúc", "Đóng hẳn đối tác. Không mở lại được; lead, nguồn và sổ đã ghi vẫn giữ nguyên."),
      ];
    case "SUSPENDED":
      return [
        t("ACTIVE", "Kích hoạt lại", "Cho đối tác hoạt động trở lại."),
        t("ENDED", "Kết thúc", "Đóng hẳn đối tác. Không mở lại được; lead, nguồn và sổ đã ghi vẫn giữ nguyên."),
      ];
    case "ENDED":
      return [];
  }
}

export type KetQuaKiemTrangThai = { ok: true; canLyDo: boolean } | { ok: false; loi: string; truong: "trangThai" | "lyDo" };

/** Cổng đổi trạng thái — máy chủ chạy trong transaction, nút chạy trước khi gửi. Lý do được trim trước khi đếm. */
export function kiemDoiTrangThaiDoiTac(p: { tu: TrangThaiDoiTac; den: TrangThaiDoiTac; lyDo: string | null; loaiCanDuyet: boolean | null }): KetQuaKiemTrangThai {
  if (p.tu === "ENDED") return { ok: false, loi: "Đối tác đã kết thúc — không mở lại được.", truong: "trangThai" };
  const thaoTac = thaoTacDoiTac(p.tu, p.loaiCanDuyet).find((x) => x.den === p.den);
  if (!thaoTac) {
    return { ok: false, loi: `Không chuyển được từ «${NHAN_TRANG_THAI_DOI_TAC[p.tu]}» sang «${NHAN_TRANG_THAI_DOI_TAC[p.den]}».`, truong: "trangThai" };
  }
  if (thaoTac.canLyDo && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_DOI_TAC) {
    return { ok: false, loi: `Nhập lý do từ ${LY_DO_TOI_THIEU_DOI_TAC} ký tự.`, truong: "lyDo" };
  }
  return { ok: true, canLyDo: thaoTac.canLyDo };
}

// ── Quan hệ tổ chức ────────────────────────────────────────────────────────────────────────────────

/**
 * Luật THUẦN về cá nhân/tổ chức (phần không cần đọc DB). `null` = hợp lệ.
 *  · tổ chức không thuộc tổ chức khác (cùng CHECK `Affiliate_org_khong_co_cha_chk`, nhưng đây trả câu tiếng Việt);
 *  · tổ chức không phải nhân viên.
 */
export function kiemQuanHeToChuc(p: { kieu: KieuDoiTac; parentPartyId: string | null; employeeId: string | null }): { truong: "parentPartyId" | "employeeId"; loi: string } | null {
  if (p.kieu === "ORGANIZATION" && p.parentPartyId) return { truong: "parentPartyId", loi: "Tổ chức không thuộc một tổ chức khác." };
  if (p.kieu === "ORGANIZATION" && p.employeeId) return { truong: "employeeId", loi: "Tổ chức không thể là nhân viên — chỉ cá nhân mới liên kết với nhân viên." };
  return null;
}

// ── Zod ────────────────────────────────────────────────────────────────────────────────────────────

const tuyChon = (toiDa: number, thongBao: string) =>
  z
    .string()
    .trim()
    .max(toiDa, thongBao)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const idTuyChon = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const dienThoai = z
  .string()
  .trim()
  .max(20, "Số điện thoại tối đa 20 ký tự.")
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v))
  .refine((v) => v === null || (/^[0-9+().\s-]+$/.test(v) && v.replace(/\D/g, "").length >= 8 && v.replace(/\D/g, "").length <= 15), "Số điện thoại không hợp lệ.");

const thuDienTu = z
  .string()
  .trim()
  .max(120, "Email tối đa 120 ký tự.")
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v.toLowerCase()))
  .refine((v) => v === null || z.email().safeParse(v).success, "Email không hợp lệ.");

const tiLe = z
  .number("Tỉ lệ tham chiếu là một số.")
  .min(0, "Tỉ lệ tham chiếu từ 0 đến 100.")
  .max(100, "Tỉ lệ tham chiếu từ 0 đến 100.")
  .nullish()
  .transform((v) => v ?? null);

/** Các ô của biểu mẫu đối tác — dùng chung cho tạo và sửa (sửa gửi lại mọi ô; máy chủ tự so với bản hiện tại). */
const truongDoiTac = {
  partyKind: z.enum(KIEU_DOI_TAC, "Chọn cá nhân hoặc tổ chức."),
  name: z.string().trim().min(2, "Tên tối thiểu 2 ký tự.").max(120, "Tên tối đa 120 ký tự."),
  typeId: z.string("Chọn loại đối tác.").trim().min(1, "Chọn loại đối tác.").max(64),
  tagIds: z
    .array(z.string().trim().min(1).max(64))
    .max(NHAN_TOI_DA_MOT_DOI_TAC, `Tối đa ${NHAN_TOI_DA_MOT_DOI_TAC} nhãn.`)
    .default([])
    .transform((v) => [...new Set(v)]),
  code: z.string("Nhập mã giới thiệu."),
  phone: dienThoai,
  email: thuDienTu,
  note: tuyChon(1000, "Ghi chú tối đa 1000 ký tự."),
  centerId: idTuyChon,
  commissionPercent: tiLe,
  employeeId: idTuyChon,
  parentPartyId: idTuyChon,
};

function kiemCheoNhau(v: { partyKind: KieuDoiTac; parentPartyId: string | null; employeeId: string | null; code: string }, ctx: z.RefinementCtx): void {
  const m = chuanHoaMaDoiTac(v.code);
  if (!m.ok) ctx.addIssue({ code: "custom", path: ["code"], message: m.loi });
  const q = kiemQuanHeToChuc({ kieu: v.partyKind, parentPartyId: v.parentPartyId, employeeId: v.employeeId });
  if (q) ctx.addIssue({ code: "custom", path: [q.truong], message: q.loi });
}

export const taoDoiTacSchema = z.object(truongDoiTac).strict().superRefine(kiemCheoNhau);
export type DauVaoTaoDoiTac = z.infer<typeof taoDoiTacSchema>;

export const suaDoiTacSchema = z.object(truongDoiTac).strict().superRefine(kiemCheoNhau);
export type DauVaoSuaDoiTac = z.infer<typeof suaDoiTacSchema>;

/** Tên các ô có thể mang lỗi — giao diện gắn câu lỗi vào đúng ô; `chung` = không thuộc ô nào. */
export type TruongLoiDoiTac = keyof typeof truongDoiTac | "lyDo" | "trangThai" | "vuaDoi" | "khongTimThay" | "quyen" | "chung";
