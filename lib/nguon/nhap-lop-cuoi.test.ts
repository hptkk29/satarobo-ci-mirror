/**
 * LANE C1 «NGUỒN Ở LỚP NHẬP» — phần THUẦN (không DB). Phần chạm DB ở `tests/lead-intake/nguon-nhap-lop-cuoi.spec.ts`; phần giao diện ở
 * `components/lead-intake/quick-lead-form-nhap-lop-cuoi.test.tsx`.
 *
 *   [SRC-ENT-12]  «dropdown chọn được» = ACTIVE ∧ selectable ∧ trong khoảng hiệu lực — biên: bắt đầu ĐÓNG, kết thúc MỞ; UNKNOWN (danh mục gốc) không bao giờ có mặt
 *   [SRC-ENT-13]  «xem tay» là TRẠNG THÁI, không phải nguồn: không mã nguồn nào được bắt đầu bằng MANUAL, danh mục gốc không có dòng nào như vậy
 *   [SRC-ENT-14]  nguồn / người giới thiệu / Sale phụ trách độc lập: mã `lib/nguon/**` KHÔNG ghi `Lead.assignedToId` (chỉ đọc)
 *
 * Luật 19: `now` luôn là ngày TUYỆT ĐỐI truyền vào.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC } from "./danh-muc-goc";
import { kiemCode, TIEN_TO_CAM } from "./danh-muc-ghi-dau-vao";
import { locNhomChon, type NhomChonTho } from "./chon-nguon";
import { nguonChonDuoc } from "./hieu-luc-nguon";

const NOW = new Date("2026-11-20T03:00:00.000Z");

const g = (p: Partial<NhomChonTho> & Pick<NhomChonTho, "id" | "code">): NhomChonTho => ({
  name: `Nguồn ${p.code}`,
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  sortOrder: 1,
  effectiveFrom: null,
  effectiveTo: null,
  ...p,
});

describe("[SRC-ENT-12] ô chọn nguồn = ACTIVE ∧ selectable ∧ trong khoảng hiệu lực", () => {
  it("mỗi cổng LOẠI đúng nguồn của nó; chỉ nguồn qua đủ ba cổng được hiện (đối chứng dương)", () => {
    const rows: NhomChonTho[] = [
      g({ id: "ok", code: "OK" }),
      g({ id: "trong", code: "TRONG", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2027-01-01T00:00:00.000Z") }),
      g({ id: "tat", code: "TAT", status: "INACTIVE" }),
      g({ id: "nhap", code: "NHAP", status: "DRAFT" }),
      g({ id: "luutru", code: "LUUTRU", status: "ARCHIVED" }),
      g({ id: "khongchon", code: "KHONG_CHON", selectable: false }),
      g({ id: "hethan", code: "HET_HAN", effectiveTo: new Date("2026-01-01T00:00:00.000Z") }),
      g({ id: "chua", code: "CHUA", effectiveFrom: new Date("2027-01-01T00:00:00.000Z") }),
    ];
    expect(locNhomChon(rows, NOW).map((x) => x.code)).toEqual(["OK", "TRONG"]);
  });

  it("biên thời gian: effectiveFrom == now ⇒ chọn được (ĐÓNG); effectiveTo == now ⇒ KHÔNG (MỞ); lùi/tiến 1 ms đổi kết quả", () => {
    const base = { status: "ACTIVE", selectable: true };
    const tuLuc = (d: Date) => ({ ...base, effectiveFrom: d, effectiveTo: null });
    const denLuc = (d: Date) => ({ ...base, effectiveFrom: null, effectiveTo: d });
    expect(nguonChonDuoc(tuLuc(NOW), NOW)).toBe(true);
    expect(nguonChonDuoc(tuLuc(new Date(NOW.getTime() + 1)), NOW)).toBe(false);
    expect(nguonChonDuoc(denLuc(NOW), NOW)).toBe(false);
    expect(nguonChonDuoc(denLuc(new Date(NOW.getTime() + 1)), NOW)).toBe(true);
  });

  it("danh mục GỐC: UNKNOWN là nguồn duy nhất không selectable; qua `locNhomChon` chỉ còn 8 nguồn, không UNKNOWN", () => {
    const khongChon = DANH_MUC_GOC.filter((d) => !d.selectable).map((d) => d.code);
    expect(khongChon).toEqual(["UNKNOWN"]);
    const rows = DANH_MUC_GOC.map((d, i) =>
      g({ id: `g${i}`, code: d.code, selectable: d.selectable, status: d.status, referrerRequirement: d.referrerRequirement, requiresNote: d.requiresNote, sortOrder: d.sortOrder }),
    );
    const hien = locNhomChon(rows, NOW).map((x) => x.code);
    expect(hien).toHaveLength(8);
    expect(hien).not.toContain("UNKNOWN");
  });
});

describe("[SRC-ENT-13] MANUAL_REVIEW là trạng thái xem tay, không phải một nguồn", () => {
  it("mã nguồn mới không được bắt đầu bằng MANUAL; danh mục gốc không có dòng nào như vậy", () => {
    expect(TIEN_TO_CAM).toBe("MANUAL");
    expect(kiemCode("MANUAL_REVIEW")).toMatch(/MANUAL/);
    expect(kiemCode("MANUAL_REVIEW_2")).not.toBeNull();
    expect(kiemCode("HOI_THAO_STEM")).toBeNull(); // đối chứng dương: mã thường qua
    expect(DANH_MUC_GOC.some((d) => d.code.startsWith(TIEN_TO_CAM))).toBe(false);
  });
});

describe("[SRC-ENT-14] nguồn · người giới thiệu · Sale phụ trách độc lập — mã lib/nguon KHÔNG ghi chủ lead", () => {
  /** Bỏ chú thích để câu chữ giải thích bản vá không tự khớp mẫu đang cấm (luật 11). */
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:])\/\/.*$/gm, "$1");

  it("không tệp nguồn nào gán `assignedToId` / `assignedAt` (chỉ `select: { assignedToId: true }` và kiểu dữ liệu)", () => {
    const thuMuc = resolve(process.cwd(), "lib/nguon");
    const tep = readdirSync(thuMuc).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(tep.length).toBeGreaterThan(50); // đối chứng: thật sự quét được cả thư mục
    const vi: string[] = [];
    for (const f of tep) {
      const ma = boChuThich(readFileSync(resolve(thuMuc, f), "utf8"));
      // `assignedToId: <gì đó khác true / kiểu>` (khoá đối tượng — KHÔNG có dấu cách trước `:`, nên nhánh đọc `? l.assignedToId : null` không dính) · `assignedToId = …` · `assignedAt:` = một phép GHI
      for (const m of ma.matchAll(/assignedToId(?::(?!\s*(?:true\b|string\b|\w+\s*\|\s*null))|\s*=(?!=))|assignedAt\s*:/g)) vi.push(`${f}: ${m[0]}`);
    }
    expect(vi).toEqual([]);
  });

  it("`Lead` KHÔNG có cột `nguonLead` — nguồn nghiệp vụ là `LeadAttribution`, `Lead.source` chỉ là khoá định tuyến tương thích (08 §8)", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const m = schema.match(/^model Lead \{([\s\S]*?)^\}/m);
    expect(m, "đối chứng: đọc được thân model Lead").not.toBeNull();
    const than = m![1]!;
    expect(than).toMatch(/^\s*source\s+String/m); // cột tương thích CÓ mặt
    expect(than).not.toMatch(/^\s*nguonLead\b/m);
    expect(boChuThich(than)).not.toMatch(/nguonLead/);
  });

  it("mẫu bắt đúng thứ cần bắt (cấy giả trên chuỗi)", () => {
    const bat = (s: string) => /assignedToId(?::(?!\s*(?:true\b|string\b|\w+\s*\|\s*null))|\s*=(?!=))|assignedAt\s*:/.test(boChuThich(s));
    expect(bat("data: { assignedToId: referrerUserId }")).toBe(true);
    expect(bat("lead.assignedToId = nguoi.id")).toBe(true);
    expect(bat("data: { assignedAt: new Date() }")).toBe(true);
    expect(bat("select: { id: true, assignedToId: true }")).toBe(false);
    expect(bat("type L = { assignedToId: string | null }")).toBe(false);
    expect(bat("// assignedToId: x  — chú thích")).toBe(false);
  });
});
