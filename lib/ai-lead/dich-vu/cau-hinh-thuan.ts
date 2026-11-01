// lib/ai-lead/dich-vu/cau-hinh-thuan.ts — PHẦN THUẦN của cấu hình AI Lead (lát K): dựng payload catalog, băm etag, so diff, schema đầu vào của action.
// Không DB, không env, không đồng hồ thật — test không cần mock.
//
// Vì sao tách khỏi `cau-hinh.ts`: (1) component client cần kiểu + hằng mà không kéo `@/lib/db`; (2) bất biến của catalog (đúng hợp đồng, etag có version,
// thứ tự ổn định) là LUẬT thuần, nên test được không cần Postgres.
import { createHash } from "node:crypto";
import { z } from "zod";
import { MOI_TRUONG, RE, TRANG_THAI_CONTRACT, TRANG_THAI_PAGE, TRANG_THAI_CHINH_SACH_DONG_Y, laDanhTinhFixture } from "../hop-dong";
import { catalogResponseSchema } from "../schemas";
import type { CoSoCatalog } from "../kieu";

// ─── Catalog ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PayloadCatalog = { pages: { pageId: string; campuses: CoSoCatalog[] }[] };

/** Một hàng xuất bản + cơ sở nó trỏ tới — đầu vào của `dungPayloadCatalog`. */
export type HangXuatBan = {
  pageId: string;
  displayOrder: number;
  acceptingLeads: boolean;
  publicVisible: boolean;
  campus: { id: string; code: string | null; name: string; address: string; isActive: boolean };
};

const schemaPages = catalogResponseSchema.shape.data.shape.pages;

export class LoiCatalog extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiCatalog";
  }
}

/**
 * Dựng payload xuất bản. THUẦN, TẤT ĐỊNH (cùng đầu vào ⇒ cùng bytes — etag dựa vào đó).
 *  · `pageIds` = mọi Page đã được cấp cho ít nhất một agent ∪ mọi Page có hàng xuất bản. Page chưa có cơ sở nào hiện ra với `campuses: []` (Agent thấy Page
 *    mình được cấp nhưng chưa có cơ sở để mời ⇒ `INVALID_SELECTION`, đúng chứ không im lặng).
 *  · CHỈ hàng `publicVisible` vào catalog; `campusCode` = `Center.code`.
 *  · Cơ sở ngừng hoạt động / thiếu mã hợp lệ ⇒ NÉM `LoiCatalog` nêu tên cơ sở (từ chối cả bản xuất bản: thà không xuất bản còn hơn xuất bản một cơ sở Agent
 *    sẽ mời khách chọn mà ingest sẽ từ chối).
 *  · Kết quả PHẢI qua `catalogResponseSchema` (đúng hợp đồng) — chạy lại ở đây để không bao giờ tạo snapshot trái hợp đồng.
 */
export function dungPayloadCatalog(pageIds: readonly string[], hang: readonly HangXuatBan[]): PayloadCatalog {
  const tatCa = new Set<string>(pageIds);
  for (const h of hang) tatCa.add(h.pageId);
  const pages = [...tatCa].sort().map((pageId) => {
    const cua = hang
      .filter((h) => h.pageId === pageId && h.publicVisible)
      .sort((a, b) => a.displayOrder - b.displayOrder || (a.campus.code ?? "").localeCompare(b.campus.code ?? ""));
    const campuses: CoSoCatalog[] = cua.map((h) => {
      if (!h.campus.isActive) {
        throw new LoiCatalog(`Cơ sở "${h.campus.name}" đã ngừng hoạt động — gỡ khỏi Page ${pageId} (hoặc tắt "hiện công khai") trước khi xuất bản.`);
      }
      if (h.campus.code === null || !RE.campusCode.test(h.campus.code)) {
        throw new LoiCatalog(`Cơ sở "${h.campus.name}" chưa có mã hợp lệ (A–Z, 0–9, _ -, 2–16 ký tự) — vào trang cơ sở khai mã trước khi xuất bản.`);
      }
      return { campusCode: h.campus.code, name: h.campus.name.trim(), address: h.campus.address.trim(), acceptingLeads: h.acceptingLeads };
    });
    return { pageId, campuses };
  });
  // Hai hàng cùng `campusCode` trong MỘT Page (hai Center trùng mã, hoặc dữ liệu hỏng) ⇒ Agent không phân biệt được cơ sở nào khách chọn ⇒ từ chối cả bản xuất bản.
  for (const p of pages) {
    const thay = new Set<string>();
    for (const c of p.campuses) {
      if (thay.has(c.campusCode)) throw new LoiCatalog(`Mã cơ sở "${c.campusCode}" xuất hiện hai lần ở Page ${p.pageId} — mỗi mã chỉ được dùng cho MỘT cơ sở trong một Page.`);
      thay.add(c.campusCode);
    }
  }
  const r = schemaPages.safeParse(pages);
  if (!r.success) {
    const loi = r.error.issues[0];
    const vitri = loi ? loi.path.join(".") : "";
    throw new LoiCatalog(`Catalog không đúng hợp đồng (${vitri || "?"}): tên cơ sở 1–200 ký tự, địa chỉ 1–400 ký tự, mã cơ sở hợp lệ.`);
  }
  return { pages: r.data };
}

/** JSON chuẩn tắc: khoá đối tượng sắp xếp, mảng giữ nguyên thứ tự. Dùng để băm. */
export function jsonChuanTac(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonChuanTac).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonChuanTac(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * ETag của một snapshot. BAO GỒM `version`: xuất bản lại nội dung cũ (rollback) vẫn ra etag MỚI. Nếu etag chỉ băm nội dung thì rollback tái tạo đúng etag
 * một bản cũ, Agent đang giữ etag đó nhận 304 mãi mãi, không bao giờ nâng `catalogVersionSeen` — Trung tâm kết nối báo "catalog cũ" vĩnh viễn.
 * Độ dài ≤ AN_TOAN_CUNG.etagToiDaKyTu.
 */
export function tinhEtag(version: number, payload: PayloadCatalog): string {
  const h = createHash("sha256").update(`v${version}|${jsonChuanTac(payload)}`).digest("hex");
  return `v${version}-${h.slice(0, 32)}`;
}

export type KetQuaToanVen = { ok: true } | { ok: false; ly: "PAYLOAD_SAI_HOP_DONG" | "ETAG_LECH" };

/**
 * Toàn vẹn của MỘT snapshot đã lưu (THUẦN). (1) payload phải còn qua schema hợp đồng của catalog (không có mã trùng trong một Page); (2) etag do bộ xuất bản sinh (`v<n>-<32 hex>`) phải bằng băm tính lại từ
 * (version, payload) — sửa tay payload trong DB mà quên etag là Agent nhận 304 mãi trên nội dung cũ, hoặc nội dung mới mang etag cũ. Etag KHÔNG theo khuôn của bộ xuất bản (dữ liệu nhập tay / fixture
 * hợp đồng) thì chỉ kiểm (1): không có cách nào tính lại một giá trị tuỳ ý.
 */
export function kiemToanVenSnapshot(s: { version: number; etag: string; payload: unknown }): KetQuaToanVen {
  const pages = (s.payload as { pages?: unknown } | null)?.pages;
  const r = schemaPages.safeParse(pages);
  const trung = r.success && r.data.some((p) => new Set(p.campuses.map((c) => c.campusCode)).size !== p.campuses.length);
  if (!r.success || trung) return { ok: false, ly: "PAYLOAD_SAI_HOP_DONG" };
  if (/^v\d+-[0-9a-f]{32}$/.test(s.etag) && s.etag !== tinhEtag(s.version, { pages: r.data })) return { ok: false, ly: "ETAG_LECH" };
  return { ok: true };
}

// ─── Diff ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ThayDoiCatalog =
  | { loai: "THEM_PAGE"; pageId: string }
  | { loai: "BO_PAGE"; pageId: string }
  | { loai: "THEM_CO_SO"; pageId: string; campusCode: string; ten: string }
  | { loai: "BO_CO_SO"; pageId: string; campusCode: string; ten: string }
  | { loai: "SUA_CO_SO"; pageId: string; campusCode: string; ten: string; truong: ("name" | "address" | "acceptingLeads")[] };

/** So payload sắp xuất bản với snapshot hiện hành (`truoc = null` ⇒ chưa từng xuất bản: mọi thứ là "thêm"). THUẦN. */
export function soSanhCatalog(truoc: PayloadCatalog | null, sau: PayloadCatalog): ThayDoiCatalog[] {
  const ra: ThayDoiCatalog[] = [];
  const mapTruoc = new Map((truoc?.pages ?? []).map((p) => [p.pageId, p]));
  const mapSau = new Map(sau.pages.map((p) => [p.pageId, p]));
  for (const [pageId, p] of mapSau) {
    const cu = mapTruoc.get(pageId);
    if (!cu) {
      ra.push({ loai: "THEM_PAGE", pageId });
      for (const c of p.campuses) ra.push({ loai: "THEM_CO_SO", pageId, campusCode: c.campusCode, ten: c.name });
      continue;
    }
    const cuMap = new Map(cu.campuses.map((c) => [c.campusCode, c]));
    const moiMap = new Map(p.campuses.map((c) => [c.campusCode, c]));
    for (const [ma, c] of moiMap) {
      const k = cuMap.get(ma);
      if (!k) {
        ra.push({ loai: "THEM_CO_SO", pageId, campusCode: ma, ten: c.name });
        continue;
      }
      const truong: ("name" | "address" | "acceptingLeads")[] = [];
      if (k.name !== c.name) truong.push("name");
      if (k.address !== c.address) truong.push("address");
      if (k.acceptingLeads !== c.acceptingLeads) truong.push("acceptingLeads");
      if (truong.length > 0) ra.push({ loai: "SUA_CO_SO", pageId, campusCode: ma, ten: c.name, truong });
    }
    for (const [ma, k] of cuMap) if (!moiMap.has(ma)) ra.push({ loai: "BO_CO_SO", pageId, campusCode: ma, ten: k.name });
  }
  for (const pageId of mapTruoc.keys()) if (!mapSau.has(pageId)) ra.push({ loai: "BO_PAGE", pageId });
  return ra;
}

export function moTaThayDoi(t: ThayDoiCatalog): string {
  const nhan = { name: "tên", address: "địa chỉ", acceptingLeads: "trạng thái nhận khách" } as const;
  switch (t.loai) {
    case "THEM_PAGE":
      return `Thêm Page ${t.pageId}`;
    case "BO_PAGE":
      return `Bỏ Page ${t.pageId}`;
    case "THEM_CO_SO":
      return `Page ${t.pageId}: thêm cơ sở ${t.campusCode} (${t.ten})`;
    case "BO_CO_SO":
      return `Page ${t.pageId}: bỏ cơ sở ${t.campusCode} (${t.ten})`;
    case "SUA_CO_SO":
      return `Page ${t.pageId}: sửa ${t.truong.map((x) => nhan[x]).join(", ")} của ${t.campusCode} (${t.ten})`;
  }
}

// ─── Schema đầu vào của action (dùng chung action + test) ─────────────────────────────────────────────────────────────────

const id = z.string().regex(/^[a-z0-9]{20,40}$/, "Mã không hợp lệ");
/**
 * Mã CƠ SỞ (`Center.id`). KHÔNG dùng regex cuid: `Center.id` THẬT trên PROD là slug (`co-so-nguyen-huu-tho`, `co-so-hoang-dieu`, `hoi-so` — đo chỉ-đọc 28/10/2026), cuid chỉ có ở DB dựng lại.
 * Regex cuid từng từ chối MỌI cơ sở thật ở các hành động xuất bản catalog / cơ sở nhận / quy tắc. Chỉ chặn ký tự lạ và độ dài; tồn tại + còn nhận khách do `kiemCoSoNhanKhach` kiểm với DB.
 * `agentId` vẫn dùng `id` (cuid do chính Gateway sinh).
 */
export const maCoSo = z
  .string()
  .min(1, "Mã cơ sở không hợp lệ")
  .max(64, "Mã cơ sở không hợp lệ")
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Mã cơ sở không hợp lệ");
const lyDoNguyHiem = z.string().trim().min(10, "Nhập lý do (ít nhất 10 ký tự) — lý do được ghi vào nhật ký.").max(500, "Lý do tối đa 500 ký tự.");
export const pageIdSchema = z
  .string()
  .trim()
  .regex(RE.pageId, "pageId gồm chữ, số, _ hoặc -, dài 5–64 ký tự")
  .refine((v) => !laDanhTinhFixture({ pageId: v }), "pageId này là Page mẫu của gói bàn giao — không dùng được ở hệ thống thật");

export const taoAgentSchema = z.strictObject({
  name: z.string().trim().min(3, "Tên Agent tối thiểu 3 ký tự").max(80, "Tên Agent tối đa 80 ký tự"),
  environment: z.enum(MOI_TRUONG),
});
export const taoLaiKhoaSchema = z.strictObject({
  agentId: id,
  /** Version màn đang thấy — phép đổi CÓ ĐIỀU KIỆN theo nó. */
  secretVersionDangThay: z.number().int().min(1),
  lyDo: lyDoNguyHiem,
});
export const datHoatDongSchema = z.strictObject({ agentId: id, active: z.boolean(), lyDo: lyDoNguyHiem });
export const datContractSchema = z.strictObject({ agentId: id, contractStatus: z.enum(TRANG_THAI_CONTRACT), lyDo: lyDoNguyHiem });
export const themPageSchema = z.strictObject({
  agentId: id,
  pageId: pageIdSchema,
  routingCenterId: maCoSo.nullable().optional(),
  note: z.string().trim().max(200).optional(),
});
export const goPageSchema = z.strictObject({ agentId: id, pageId: pageIdSchema, lyDo: lyDoNguyHiem });
export const trangThaiPageSchema = z.strictObject({ agentId: id, pageId: pageIdSchema, state: z.enum(TRANG_THAI_PAGE), lyDo: lyDoNguyHiem });
export const routingSchema = z.strictObject({ agentId: id, pageId: pageIdSchema, routingCenterId: maCoSo.nullable() });
export const luuXuatBanSchema = z.strictObject({
  pageId: pageIdSchema,
  campusCenterId: maCoSo,
  acceptingLeads: z.boolean(),
  publicVisible: z.boolean(),
  displayOrder: z.number().int().min(0).max(9999),
});
export const goXuatBanSchema = z.strictObject({ pageId: pageIdSchema, campusCenterId: maCoSo });
export const xuatBanSchema = z.strictObject({ lyDo: lyDoNguyHiem });
export const xuatBanLaiSchema = z.strictObject({ version: z.number().int().min(1), lyDo: lyDoNguyHiem });
export const doiChinhSachSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("ai.prodEnabled"), value: z.boolean(), lyDo: lyDoNguyHiem }),
  z.strictObject({ key: z.literal("ai.consentPolicyStatus"), value: z.enum(TRANG_THAI_CHINH_SACH_DONG_Y), lyDo: lyDoNguyHiem }),
]);

export function loiDauTien(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
}
