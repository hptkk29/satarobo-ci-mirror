/**
 * lib/affiliate/ghi-website-dau-vao.ts — LUẬT GHI WEBSITE + TRANG ĐÍCH AFFILIATE, PHẦN THUẦN (AFF-P0b, docs/source-commission/12). Không `db`, không đồng hồ, không `"use server"`.
 *
 * Chia làm hai: tệp này quyết ĐƯỢC / KHÔNG ĐƯỢC (Zod, chuẩn hoá tên miền + gốc URL + đường dẫn mẫu, bảng chuyển trạng thái, điều kiện xoá); `ghi-website.ts` đọc DB rồi ghi.
 * Tách để mọi nhánh luật test được không cần Postgres, giao diện (client) import được mà không kéo mã máy chủ, và luật không có HAI bản (luật 12b).
 *
 * Phép so tên miền / đường dẫn KHÔNG nằm ở đây — nó nằm ở `website-hop-le.ts` (hợp đồng bảo mật dùng chung với P1). Tệp này chỉ GỌI nó.
 *
 * ── Luật ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · `code`: qua `chuanHoaMa`, phải khớp `MA_DANH_MUC_RE` (CHECK `AffiliateSite_code_chk`). KHÔNG đổi sau khi tạo (không có trong schema sửa).
 *  · `allowedDomains` ≥ 1, mỗi mục qua `kiemTenMien` (chữ thường · hợp lệ · không scheme/đường dẫn/dấu cách/ký tự đại diện). Trùng bị gộp. Khớp CHÍNH XÁC, không wildcard ở P0.
 *  · `baseUrl` qua `kiemBaseUrl`: chỉ https, bỏ dấu `/` cuối, host PHẢI ∈ `allowedDomains`. Kiểm lại khi baseUrl HOẶC danh sách tên miền đổi (gỡ mất tên miền của gốc URL là sai).
 *  · Ngừng website (→ INACTIVE) cần lý do ≥ 10 ký tự; bật lại thì lý do tuỳ chọn.
 *  · Xoá website chỉ khi CHƯA gắn campaign nào và CHƯA có trang đích nào (đã có thì chỉ ngừng được); cần lý do ≥ 10 ký tự.
 *  · Trang đích: `pathPattern` qua `chuanHoaDuongDanMau`; (website, mẫu) trùng ⇒ «đã có». Không xoá trang đích — chỉ bật/tắt (link đã phát có thể đang trỏ vào nó).
 */
import { z } from "zod";
import { MA_DANH_MUC_RE, chuanHoaMa } from "./chung";
import { chuanHoaDuongDanMau, hostCuaBaseUrl, hostTrongDanhSach, kiemBaseUrl, kiemTenMien, nhanLyDo } from "./website-hop-le";

export const LY_DO_TOI_THIEU_WEBSITE = 10;
export const DO_DAI_TEN_TOI_DA = 120;
export const DO_DAI_NHAN_TOI_DA = 120;
export const SO_TEN_MIEN_TOI_DA = 20;

// ── Trạng thái ──────────────────────────────────────────────────────────────────────────────────────────────

export const TRANG_THAI_WEBSITE = ["ACTIVE", "INACTIVE"] as const;
export type TrangThaiWebsite = (typeof TRANG_THAI_WEBSITE)[number];

export const NHAN_TRANG_THAI_WEBSITE: Readonly<Record<TrangThaiWebsite, string>> = {
  ACTIVE: "Đang hoạt động",
  INACTIVE: "Đã ngừng",
};

// ── Chuẩn hoá nội dung ──────────────────────────────────────────────────────────────────────────────────────

export type LoiTruong = { ok: false; loi: string; truong: string };

export type NoiDungWebsite = { baseUrl: string; allowedDomains: string[] };

/**
 * Kiểm + chuẩn hoá cặp (gốc URL, tên miền được phép). Dùng cho tạo, sửa và (client) xem trước — CÙNG một hàm.
 * Tên miền: chuẩn hoá từng mục, báo mục hỏng đầu tiên KÈM chính mục đó; bỏ trùng giữ thứ tự. Gốc URL: host phải ∈ danh sách.
 */
export function chuanHoaNoiDungWebsite(vao: { baseUrl: string; allowedDomains: readonly string[] }): ({ ok: true } & NoiDungWebsite) | LoiTruong {
  const ds: string[] = [];
  if (vao.allowedDomains.length === 0) return { ok: false, loi: "Khai ít nhất một tên miền được phép.", truong: "allowedDomains" };
  if (vao.allowedDomains.length > SO_TEN_MIEN_TOI_DA) {
    return { ok: false, loi: `Tối đa ${SO_TEN_MIEN_TOI_DA} tên miền cho một website.`, truong: "allowedDomains" };
  }
  for (const raw of vao.allowedDomains) {
    const kq = kiemTenMien(raw);
    if (!kq.ok) return { ok: false, loi: `«${raw.trim().slice(0, 80)}»: ${kq.loi}`, truong: "allowedDomains" };
    if (!ds.includes(kq.tenMien)) ds.push(kq.tenMien);
  }
  if (vao.baseUrl.trim() === "") return { ok: false, loi: "Nhập gốc URL của website (ví dụ https://quatang.edu.vn).", truong: "baseUrl" };
  const b = kiemBaseUrl(vao.baseUrl.trim(), ds);
  if (!b.ok) {
    return {
      ok: false,
      loi: b.lyDo === "HOST_KHONG_DUOC_PHEP" ? "Tên miền của gốc URL phải nằm trong danh sách tên miền được phép — thêm nó vào danh sách." : nhanLyDo(b.lyDo),
      truong: "baseUrl",
    };
  }
  return { ok: true, baseUrl: b.baseUrl, allowedDomains: ds };
}

/** Câu lỗi tiếng Việt cho mã ĐÃ chuẩn hoá; `null` = hợp lệ. */
export function kiemMaWebsite(code: string): string | null {
  if (!MA_DANH_MUC_RE.test(code)) return "Mã website gồm chữ HOA không dấu, chữ số và gạch dưới (A–Z, 0–9, _), dài 3–40 ký tự.";
  return null;
}

// ── Zod ─────────────────────────────────────────────────────────────────────────────────────────────────────

const tenWebsite = z.string().trim().min(2, "Tên website tối thiểu 2 ký tự.").max(DO_DAI_TEN_TOI_DA, `Tên website tối đa ${DO_DAI_TEN_TOI_DA} ký tự.`);
const idTuyChon = z
  .string()
  .trim()
  .max(64)
  .transform((v) => (v === "" ? null : v));
const chuoiTenMien = z.string().max(300, "Tên miền quá dài.");

export const taoWebsiteSchema = z
  .object({
    code: z.string().transform(chuanHoaMa),
    name: tenWebsite,
    baseUrl: z.string().max(300, "Gốc URL quá dài."),
    allowedDomains: z.array(chuoiTenMien).max(SO_TEN_MIEN_TOI_DA, `Tối đa ${SO_TEN_MIEN_TOI_DA} tên miền cho một website.`),
    trackingEnabled: z.boolean(),
    defaultCampaignId: idTuyChon.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const loiMa = kiemMaWebsite(v.code);
    if (loiMa) ctx.addIssue({ code: "custom", path: ["code"], message: loiMa });
  });
export type DauVaoTaoWebsite = z.infer<typeof taoWebsiteSchema>;

/** Trường sửa được. `undefined` = KHÔNG đổi. KHÔNG có `code` và KHÔNG có `status` (đổi trạng thái đi đường riêng, có lý do). */
export const suaWebsiteSchema = z
  .object({
    name: tenWebsite.optional(),
    baseUrl: z.string().max(300, "Gốc URL quá dài.").optional(),
    allowedDomains: z.array(chuoiTenMien).max(SO_TEN_MIEN_TOI_DA, `Tối đa ${SO_TEN_MIEN_TOI_DA} tên miền cho một website.`).optional(),
    trackingEnabled: z.boolean().optional(),
    defaultCampaignId: idTuyChon.nullable().optional(),
  })
  .strict();
export type DauVaoSuaWebsite = z.infer<typeof suaWebsiteSchema>;

export const TRUONG_SUA_WEBSITE = ["name", "baseUrl", "allowedDomains", "trackingEnabled", "defaultCampaignId"] as const;
export type TruongSuaWebsite = (typeof TRUONG_SUA_WEBSITE)[number];

export type GiaTriWebsite = {
  name: string;
  baseUrl: string;
  allowedDomains: readonly string[];
  trackingEnabled: boolean;
  defaultCampaignId: string | null;
};

export type KetQuaKiemSua = { ok: true; truongDoi: TruongSuaWebsite[]; moi: GiaTriWebsite; doiCampaignMacDinh: boolean } | LoiTruong;

const cungMang = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Áp `patch` lên giá trị hiện tại: trả danh sách trường THẬT SỰ đổi (biểu mẫu gửi lại mọi ô nên "gửi" ≠ "đổi") và giá trị mới đã chuẩn hoá.
 * Gốc URL + tên miền chỉ kiểm khi MỘT TRONG HAI đổi — website cũ có thể mang gốc URL không còn đúng luật mới, không được chặn việc sửa TÊN.
 */
export function kiemSuaWebsite(p: { hienTai: GiaTriWebsite; patch: DauVaoSuaWebsite }): KetQuaKiemSua {
  const { hienTai, patch } = p;
  let baseUrl = hienTai.baseUrl;
  let allowedDomains: readonly string[] = hienTai.allowedDomains;
  const doiNoiDung = patch.baseUrl !== undefined || patch.allowedDomains !== undefined;
  if (doiNoiDung) {
    const nd = chuanHoaNoiDungWebsite({ baseUrl: patch.baseUrl ?? hienTai.baseUrl, allowedDomains: patch.allowedDomains ?? hienTai.allowedDomains });
    if (!nd.ok) {
      // Gốc URL hiện tại KHÔNG đổi mà danh sách tên miền mới làm nó hỏng ⇒ nói thẳng nguyên nhân là danh sách vừa sửa.
      if (nd.truong === "baseUrl" && patch.baseUrl === undefined) {
        return { ok: false, loi: `Không bỏ được tên miền của gốc URL hiện tại (${hienTai.baseUrl}). Đổi gốc URL trước, hoặc giữ tên miền đó trong danh sách.`, truong: "allowedDomains" };
      }
      return nd;
    }
    baseUrl = nd.baseUrl;
    allowedDomains = nd.allowedDomains;
  }
  const moi: GiaTriWebsite = {
    name: patch.name ?? hienTai.name,
    baseUrl,
    allowedDomains,
    trackingEnabled: patch.trackingEnabled ?? hienTai.trackingEnabled,
    defaultCampaignId: patch.defaultCampaignId !== undefined ? patch.defaultCampaignId : hienTai.defaultCampaignId,
  };
  const truongDoi: TruongSuaWebsite[] = [];
  if (moi.name !== hienTai.name) truongDoi.push("name");
  if (moi.baseUrl !== hienTai.baseUrl) truongDoi.push("baseUrl");
  if (!cungMang(moi.allowedDomains, hienTai.allowedDomains)) truongDoi.push("allowedDomains");
  if (moi.trackingEnabled !== hienTai.trackingEnabled) truongDoi.push("trackingEnabled");
  if (moi.defaultCampaignId !== hienTai.defaultCampaignId) truongDoi.push("defaultCampaignId");
  return { ok: true, truongDoi, moi, doiCampaignMacDinh: truongDoi.includes("defaultCampaignId") && moi.defaultCampaignId !== null };
}

// ── Đổi trạng thái / xoá ────────────────────────────────────────────────────────────────────────────────────

export type KetQuaKiemDoiTrangThai = { ok: true } | LoiTruong;

export function kiemDoiTrangThaiWebsite(p: { tu: TrangThaiWebsite; den: TrangThaiWebsite; lyDo: string | null }): KetQuaKiemDoiTrangThai {
  if (p.tu === p.den) return { ok: false, loi: `Website đã ở trạng thái «${NHAN_TRANG_THAI_WEBSITE[p.den]}».`, truong: "trangThai" };
  const ly = (p.lyDo ?? "").trim();
  if (p.den === "INACTIVE" && ly.length < LY_DO_TOI_THIEU_WEBSITE) {
    return { ok: false, loi: `Ngừng website cần ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_WEBSITE} ký tự).`, truong: "lyDo" };
  }
  return { ok: true };
}

export function kiemXoaWebsite(p: { soTrangDich: number; soCampaign: number; lyDo: string | null }): KetQuaKiemDoiTrangThai {
  if (p.soCampaign > 0) {
    return { ok: false, loi: `Website đang gắn ${p.soCampaign} campaign nên không xoá được. Gỡ khỏi campaign trước, hoặc chỉ ngừng website.`, truong: "xoa" };
  }
  if (p.soTrangDich > 0) {
    return { ok: false, loi: `Website đã có ${p.soTrangDich} trang đích nên không xoá được — chỉ ngừng được.`, truong: "xoa" };
  }
  if ((p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_WEBSITE) {
    return { ok: false, loi: `Xoá website cần ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_WEBSITE} ký tự).`, truong: "lyDo" };
  }
  return { ok: true };
}

// ── Trang đích ──────────────────────────────────────────────────────────────────────────────────────────────

const nhanTrangDich = z
  .string()
  .trim()
  .max(DO_DAI_NHAN_TOI_DA, `Nhãn tối đa ${DO_DAI_NHAN_TOI_DA} ký tự.`)
  .transform((v) => (v === "" ? null : v));

/** Tên miền riêng của trang đích (AFF-L6). Rỗng / null / vắng ⇒ tên miền của gốc URL. Kiểm ∈ `allowedDomains` ở `chuanHoaHostTrangDich`. */
const hostTrangDich = z.string().max(253, "Tên miền quá dài.").nullable();

export const taoTrangDichSchema = z
  .object({
    siteId: z.string().trim().min(1, "Chọn website.").max(64),
    host: hostTrangDich.optional(),
    pathPattern: z.string().max(300, "Đường dẫn quá dài."),
    label: nhanTrangDich.nullable(),
    trackingEnabled: z.boolean().optional(),
  })
  .strict();
export type DauVaoTaoTrangDich = z.infer<typeof taoTrangDichSchema>;

export const suaTrangDichSchema = z
  .object({
    host: hostTrangDich.optional(),
    pathPattern: z.string().max(300, "Đường dẫn quá dài.").optional(),
    label: nhanTrangDich.nullable().optional(),
    trackingEnabled: z.boolean().optional(),
  })
  .strict();
export type DauVaoSuaTrangDich = z.infer<typeof suaTrangDichSchema>;

export type KetQuaKiemMau = { ok: true; mau: string } | LoiTruong;

/** Mẫu đường dẫn → mẫu đã chuẩn hoá hoặc câu lỗi gắn ô `pathPattern`. */
export function kiemMauTrangDich(raw: string): KetQuaKiemMau {
  const m = chuanHoaDuongDanMau(raw);
  if (!m.ok) return { ok: false, loi: m.loi, truong: "pathPattern" };
  return { ok: true, mau: m.mau };
}

export type KetQuaHostTrangDich = { ok: true; host: string | null; hostKey: string } | LoiTruong;

/**
 * Tên miền của MỘT trang đích → dạng LƯU (AFF-L6). Không khai ⇒ tên miền của gốc URL (`host = null`). Có khai ⇒ chuẩn hoá (`kiemTenMien`), PHẢI ∈ `allowedDomains` của website (so bằng-chính-xác, không wildcard
 * — «chưa có công tắc wildcard»), và nếu trùng tên miền của gốc URL thì lưu `null` (một trang = một dòng; khoá duy nhất `(siteId, hostKey, pathPattern)` mới chặn đúng ca trùng).
 * Postgres không CHECK được «∈ danh sách của bảng khác» ⇒ phép kiểm này là LỚP GHI; lớp đọc (`kiemUrlDuocPhep` + cổng link) kiểm lại mỗi lượt.
 */
export function chuanHoaHostTrangDich(p: { raw: string | null | undefined; baseUrl: string; allowedDomains: readonly string[] }): KetQuaHostTrangDich {
  const tho = (p.raw ?? "").trim();
  if (tho === "") return { ok: true, host: null, hostKey: "" };
  const t = kiemTenMien(tho);
  if (!t.ok) return { ok: false, loi: t.loi, truong: "host" };
  if (!hostTrongDanhSach(p.allowedDomains, t.tenMien)) {
    return { ok: false, loi: `Tên miền «${t.tenMien}» chưa nằm trong danh sách tên miền được phép của website này — thêm nó ở mục Sửa website trước (khớp chính xác, không tính tên miền con).`, truong: "host" };
  }
  if (t.tenMien === hostCuaBaseUrl(p.baseUrl)) return { ok: true, host: null, hostKey: "" };
  return { ok: true, host: t.tenMien, hostKey: t.tenMien };
}

/**
 * Sửa website có làm một trang đích mất tên miền không: tên miền riêng của trang đích phải còn ∈ `allowedDomains` MỚI, và gốc URL mới không được đổi sang một tên miền đang là host riêng của
 * trang đích (lưu NULL mới đúng dạng chuẩn ⇒ hai dòng cùng nghĩa). `null` = ổn.
 */
export function kiemSuaWebsiteVoiTrangDich(p: { baseUrlMoi: string; allowedDomainsMoi: readonly string[]; hostTrangDich: readonly (string | null)[] }): LoiTruong | null {
  const dung = new Set<string>();
  for (const h of p.hostTrangDich) if (h !== null) dung.add(h);
  for (const h of dung) {
    if (!hostTrongDanhSach(p.allowedDomainsMoi, h)) {
      return { ok: false, loi: `Tên miền «${h}» đang được dùng bởi trang đích — chuyển hoặc đổi tên miền của trang đích đó trước khi bỏ nó khỏi danh sách.`, truong: "allowedDomains" };
    }
  }
  const hostGoc = hostCuaBaseUrl(p.baseUrlMoi);
  if (hostGoc !== null && dung.has(hostGoc)) {
    return { ok: false, loi: `Gốc URL mới nằm trên tên miền «${hostGoc}» — tên miền này đang là tên miền riêng của một trang đích. Đổi tên miền của trang đích đó về mặc định trước.`, truong: "baseUrl" };
  }
  return null;
}

/** Thao tác bật/tắt một trang đích: không đổi gì thì báo (không ghi audit rỗng). */
export function kiemBatTatTrangDich(p: { tu: boolean; den: boolean }): KetQuaKiemDoiTrangThai {
  if (p.tu === p.den) return { ok: false, loi: p.den ? "Trang đích đang bật rồi." : "Trang đích đang tắt rồi.", truong: "trangThai" };
  return { ok: true };
}
