/**
 * [SRC-ENTRY-*] — ô «Nguồn khách hàng» của màn Nhập khách hàng phải là NGUỒN ĐỘNG (12/10/2026, chủ dự án).
 *
 *   U1  `epChonNguonChoMaCoSo`: module BẬT ⇒ true ở mọi cơ sở/mã (cờ riêng của cơ sở không quyết); TẮT ⇒ false
 *   U2  `loadNguonChoFormNhap`: danh mục = nguồn ACTIVE ∧ selectable ∧ trong hiệu lực — KHÔNG UNKNOWN, KHÔNG nguồn ngừng, KHÔNG MANUAL_REVIEW; nguồn tuỳ biến
 *       có `requiresNote` đi kèm đúng thuộc tính (giao diện phản ứng theo thuộc tính, không theo mã)
 *   U3  `kiemGiaiTrinh`: trống ⇒ câu chốt «Vui lòng nhập giải trình…»; ngắn ⇒ câu đếm ký tự; đủ ⇒ null — cho MỌI nguồn có `requiresNote`, không riêng OTHER
 *   SRC-ENTRY-W1  lưới ghim mã: `createLeadManual` (action còn gọi được dù không có giao diện) từ chối khi module BẬT, TRƯỚC khi parse/ghi
 *   SRC-ENTRY-W2  lưới ghim mã: form chỉ dùng mảng `NGUON_LEAD` ở nhánh cũ (module tắt); `nguon-cho-form-nhap.ts` không còn hỏi cờ theo cơ sở
 * Server Action đã kiểm nguồn (tồn tại · còn dùng · selectable · người · giải trình) ở `giai-nguon-chon` — ca [NHH-UI-NL-05] (DB thật) và `giai-nguon-chon.test.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  master: true,
  nhom: [] as Array<Record<string, unknown>>,
}));

vi.mock("./feature", () => ({
  laQuanLyNguonBat: async () => MOCK.master,
  laEpChonNguon: async () => {
    throw new Error("form nhập KHÔNG được hỏi cờ theo cơ sở nữa");
  },
}));
vi.mock("@/lib/db", () => ({
  db: { leadSourceGroup: { findMany: async () => MOCK.nhom } },
}));

import { kiemGiaiTrinh } from "./kiem-nguon";
import { epChonNguonChoMaCoSo, loadNguonChoFormNhap } from "./nguon-cho-form-nhap";

const dong = (code: string, o: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  name: `Nguồn ${code}`,
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  sortOrder: 1,
  effectiveFrom: null,
  effectiveTo: null,
  ...o,
});

beforeEach(() => {
  MOCK.master = true;
  MOCK.nhom = [];
});

describe("[SRC-ENTRY-U1] epChonNguonChoMaCoSo", () => {
  it("module BẬT ⇒ true ở MỌI cơ sở, chưa chọn cơ sở và mã lạ — không đọc cờ theo cơ sở", async () => {
    for (const ma of ["CS1", "CS2", null, undefined, "", "MA-LA"]) expect(await epChonNguonChoMaCoSo(ma), String(ma)).toBe(true);
  });
  it("module TẮT ⇒ false (hành vi cũ y nguyên)", async () => {
    MOCK.master = false;
    for (const ma of ["CS1", null, ""]) expect(await epChonNguonChoMaCoSo(ma), String(ma)).toBe(false);
  });
});

describe("[SRC-ENTRY-U2] danh mục của form", () => {
  const NOW = new Date("2026-11-20T03:00:00.000Z");
  const CO = [{ code: "CS1" }, { code: "CS2" }];

  it("module TẮT ⇒ null (không đọc danh mục); BẬT ⇒ luôn có, ép ở mọi cơ sở", async () => {
    MOCK.master = false;
    expect(await loadNguonChoFormNhap(CO, NOW)).toBeNull();
    MOCK.master = true;
    MOCK.nhom = [dong("PAID_ADS")];
    const r = await loadNguonChoFormNhap(CO, NOW);
    expect(r).not.toBeNull();
    expect(r!.epMacDinh).toBe(true);
    expect(r!.epTheoCoSo).toEqual({ CS1: true, CS2: true });
  });

  it("chỉ nguồn ACTIVE ∧ selectable ∧ trong hiệu lực; UNKNOWN / ngừng / nháp / hết hạn / MANUAL_REVIEW KHÔNG có mặt; nguồn tuỳ biến có mặt kèm requiresNote", async () => {
    MOCK.nhom = [
      dong("PAID_ADS"),
      dong("UNKNOWN", { selectable: false }),
      dong("DA_NGUNG", { status: "INACTIVE" }),
      dong("BAN_NHAP", { status: "DRAFT" }),
      dong("HET_HAN", { effectiveTo: new Date("2026-10-01T00:00:00.000Z") }),
      dong("MANUAL_REVIEW", { selectable: false }),
      dong("UAT_CUSTOM_OTHER", { requiresNote: true, sortOrder: 9 }),
    ];
    const r = await loadNguonChoFormNhap(CO, NOW);
    const ma = r!.danhMuc.map((g) => g.code);
    expect(ma).toEqual(expect.arrayContaining(["PAID_ADS", "UAT_CUSTOM_OTHER"]));
    for (const khong of ["UNKNOWN", "DA_NGUNG", "BAN_NHAP", "HET_HAN", "MANUAL_REVIEW"]) expect(ma, khong).not.toContain(khong);
    expect(r!.danhMuc.find((g) => g.code === "UAT_CUSTOM_OTHER")!.requiresNote).toBe(true);
    expect(r!.danhMuc.find((g) => g.code === "PAID_ADS")!.requiresNote).toBe(false);
  });
});

describe("[SRC-ENTRY-U3] giải trình theo thuộc tính", () => {
  it("nguồn requiresNote: trống ⇒ câu chốt; ngắn ⇒ đếm ký tự; đủ 10 ký tự ⇒ null; nguồn không yêu cầu ⇒ null dù trống", () => {
    const CAU = "Vui lòng nhập giải trình cho nguồn khách hàng này.";
    expect(kiemGiaiTrinh({ requiresNote: true }, "")).toBe(CAU);
    expect(kiemGiaiTrinh({ requiresNote: true }, "   ")).toBe(CAU);
    expect(kiemGiaiTrinh({ requiresNote: true }, null)).toBe(CAU);
    expect(kiemGiaiTrinh({ requiresNote: true }, "ngắn")).toMatch(/giải trình từ 10 ký tự \(hiện 4\)/);
    expect(kiemGiaiTrinh({ requiresNote: true }, "đủ mười ký tự rồi")).toBeNull();
    expect(kiemGiaiTrinh({ requiresNote: false }, "")).toBeNull();
  });
});

describe("[SRC-ENTRY-W] lưới ghim mã nguồn (luật 11: bỏ chú thích, neo hẹp, đếm số lần)", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
  const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

  it("[SRC-ENTRY-W1] createLeadManual (action còn gọi được dù không có giao diện): module BẬT ⇒ nhãn gõ tay của payload bị BỎ — quy nguồn lẫn hai chỗ ghi Lead.source đều dùng `nhanNguon`, không dùng d.source", () => {
    const s = doc("app/(admin)/admin/leads/actions.ts");
    const a = s.indexOf("export async function createLeadManual(");
    expect(a).toBeGreaterThan(-1);
    const cuoi = s.indexOf("export async function", a + 10);
    const than = s.slice(a, cuoi > 0 ? cuoi : undefined);
    expect(dem(than, /const nguonBatKhiTao = await laQuanLyNguonBat\(\)/g)).toBe(1);
    expect(dem(than, /const nhanNguon = nguonBatKhiTao \? 'Nhập tay' : d\.source \|\| 'Nhập tay'/g)).toBe(1);
    expect(dem(than, /source: nhanNguon,/g)).toBe(2); // hai nhánh tạo cùng một nhãn
    expect(dem(than, /d\.source/g)).toBe(1); // chỉ còn MỘT chỗ đọc payload: ngay trong biểu thức nhanNguon
  });

  it("[SRC-ENTRY-W2] nguon-cho-form-nhap không còn hỏi cờ theo cơ sở; form chỉ nhúng NGUON_LEAD ở nhánh cũ", () => {
    const f = doc("lib/nguon/nguon-cho-form-nhap.ts");
    expect(dem(f, /laEpChonNguon/g)).toBe(0);
    expect(dem(f, /orgUnitIdForCenter/g)).toBe(0);
    const form = doc("components/lead-intake/quick-lead-form.tsx");
    expect(dem(form, /NGUON_LEAD/g)).toBe(2); // import + MỘT lần dùng (datalist của nhánh module tắt)
    const iNguonLead = form.lastIndexOf("NGUON_LEAD.map");
    const iPicker = form.indexOf("<ChonNguonFields");
    expect(iPicker).toBeGreaterThan(-1);
    expect(iNguonLead).toBeGreaterThan(iPicker); // danh sách gõ cứng nằm SAU nhánh picker (nhánh else)
  });
});
