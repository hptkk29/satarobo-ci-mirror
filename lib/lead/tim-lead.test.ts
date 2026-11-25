// @vitest-environment node
// [TL] — ô tìm lead dùng chung (13/11/2026). THUẦN: tách từ khoá + dựng mệnh đề. Hành vi trên Postgres thật ở `tests/lead-intake/tim-lead.spec.ts`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boDau } from "@/lib/ui/bo-dau";
import { BANG_BO_DAU, TU_KHOA_TOI_DA, dieuKienTimLead, tachTuKhoa, thoatLike } from "./tim-lead";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[TL] tách từ khoá", () => {
  it("[TL-01] bỏ dấu + thường + tách theo khoảng trắng; đ → d; bỏ trùng", () => {
    expect(tachTuKhoa("  Nguyễn   Đức  An ")).toEqual(["nguyen", "duc", "an"]);
    expect(tachTuKhoa("An an AN")).toEqual(["an"]);
    expect(tachTuKhoa("   ")).toEqual([]);
  });

  it("[TL-02] chặn câu phình theo đầu vào: tối đa số tiếng, mỗi tiếng có trần độ dài", () => {
    expect(tachTuKhoa("a b c d e f g h i j")).toHaveLength(TU_KHOA_TOI_DA);
    expect(tachTuKhoa("x".repeat(500))[0]).toHaveLength(40);
  });

  it("[TL-03] ký tự đặc biệt của LIKE bị thoát — từ khoá là chữ, không phải mẫu", () => {
    expect(thoatLike(String.raw`100%_a\b`)).toBe(String.raw`100\%\_a\\b`);
  });
});

describe("[TL] bảng bỏ dấu phía cột ≡ bỏ dấu phía từ khoá", () => {
  const tu = [...BANG_BO_DAU.tu];
  const thanh = [...BANG_BO_DAU.thanh];
  // Mô phỏng đúng `translate(x, tu, thanh)` của Postgres: ký tự ở vị trí i của `tu` → ký tự i của `thanh`; không có ký tự i ⇒ bị XOÁ.
  const ap = (s: string) =>
    [...s]
      .map((ch) => {
        const i = tu.indexOf(ch);
        return i < 0 ? ch : (thanh[i] ?? "");
      })
      .join("");

  it("[TL-04] dấu tổ hợp nằm CUỐI bảng và không có chữ đích (bị xoá); phần còn lại ghép cặp 1-1", () => {
    const soDauTohop = tu.filter((ch) => /[̀-ͯ]/.test(ch)).length;
    expect(soDauTohop).toBeGreaterThan(0);
    expect(tu.slice(tu.length - soDauTohop).every((ch) => /[̀-ͯ]/.test(ch))).toBe(true);
    expect(tu.length - soDauTohop).toBe(thanh.length);
  });

  it("[TL-05] áp bảng lên tên thật cho ĐÚNG kết quả mà phía từ khoá cho (cùng một phép bỏ dấu hai phía) — kể cả Đ/đ, chữ hoa, dạng tổ hợp NFD", () => {
    for (const mau of ["Đặng Thị Ngọc Ánh", "Lê Quỳnh Như", "Nguyễn Hữu Thọ", "Ơ Ư Ê Ô Â Ă", "Hoàng Phan Tuấn Kiệt"]) {
      expect(ap(mau)).toBe(boDau(mau));
      expect(ap(mau.normalize("NFD"))).toBe(boDau(mau));
    }
    expect(ap("Khải")).toBe("khai");
  });
});

describe("[TL] mệnh đề tìm", () => {
  it("[TL-06] chuỗi rỗng ⇒ null (không lọc)", () => {
    expect(dieuKienTimLead("   ", true)).toBeNull();
  });

  it("[TL-07] LUÔN xét tên PH + tên con trên phiếu + TỪNG bé trong LeadChild (vế bản cũ thiếu)", () => {
    const q = dieuKienTimLead("khai", false)!.sql;
    expect(q).toContain('l."parentName"');
    expect(q).toContain('l."childName"');
    expect(q).toContain('FROM "LeadChild" c WHERE c."leadId" = l."id"');
    expect(q).toContain('c."fullName"');
  });

  it("[TL-08] từ khoá đi vào làm THAM SỐ, không nối chuỗi: gõ `x' OR 1=1 --` không để lại dấu vết trong câu SQL", () => {
    const sql = dieuKienTimLead("x' OR 1=1 --", false)!;
    expect(sql.sql).not.toContain("OR 1=1");
    expect(sql.values.some((v) => typeof v === "string" && v.includes("or"))).toBe(true);
  });

  it("[TL-09] SĐT: chỉ khi được phép VÀ chuỗi gõ là số; số có dấu cách vẫn nhận; gõ chữ thì không có nhánh phone", () => {
    const co = dieuKienTimLead("0905 123 456", true)!;
    expect(co.sql).toContain('l."phone"');
    expect(co.values).toContain("%905123456%");
    expect(dieuKienTimLead("nguyen an", true)!.sql).not.toContain('l."phone"');
    expect(dieuKienTimLead("0905123456", false)!.sql).not.toContain('l."phone"');
  });
});

describe("[TL-W] dây nối: mọi ô tìm lead gọi ô tìm CHUNG, không còn ô tìm riêng", () => {
  const CAC_NOI: [string, RegExp][] = [
    ["app/(admin)/admin/leads/page.tsx", /timIdLead\(\{ q, duocTimSdtEmail: canSearchPhone \}\)/],
    ["app/(admin)/admin/search/page.tsx", /timIdLead\(\{ q, duocTimSdtEmail: canSearchLeadPhone \}\)/],
    ["lib/students/lead-nguon.ts", /timIdLead\(\{ q, duocTimSdtEmail: soSdt \}\)/],
    ["app/api/admin/leads/export/route.ts", /timIdLead\(\{ q, duocTimSdtEmail: phoneHienDuoc \}\)/],
  ];

  it("[TL-W1] bốn nơi gọi đúng một lần với đúng cờ quyền", () => {
    for (const [f, re] of CAC_NOI) expect(doc(f).match(new RegExp(re.source, "g")), f).toHaveLength(1);
  });

  it("[TL-W2] không còn ô tìm tên con chỉ so `Lead.childName` ở bốn nơi đó", () => {
    for (const [f] of CAC_NOI) expect(doc(f), f).not.toMatch(/childName:\s*\{\s*contains/);
  });

  it("[TL-W3] câu tìm chạy bằng SQL thô nên KHÔNG tự trả hàng: chỉ trả id, và loại lead đã xoá", () => {
    const s = doc("lib/lead/tim-lead-db.ts");
    expect(s).toContain('SELECT l."id" FROM "Lead" l WHERE l."deletedAt" IS NULL');
    expect(s).not.toMatch(/SELECT\s+l\.\*/);
  });
});
