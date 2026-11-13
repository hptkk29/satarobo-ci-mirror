// [HDNCC-W*] LƯỚI RANH GIỚI — lớp nhà cung cấp phải THUẦN: không env, không DB, không mạng, không server-only,
// không đồng hồ. Test hành vi không canh được điều này (gỡ ràng buộc đi thì mọi ca vẫn xanh).
// Neo vào BIỂU THỨC (process.env · @/lib/db · fetch( · Date.now) trên mã đã bỏ chú thích — không neo cách viết.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const THU_MUC = resolve(process.cwd(), "lib/finance/hoa-don/nha-cung-cap");

function boChuThich(ma: string): string {
  return ma.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function nguonKhongTest(): Array<{ ten: string; ma: string }> {
  return readdirSync(THU_MUC)
    .filter((t) => t.endsWith(".ts") && !t.endsWith(".test.ts"))
    .map((ten) => ({ ten, ma: boChuThich(readFileSync(join(THU_MUC, ten), "utf8")) }));
}

/**
 * Mọi chuỗi tham chiếu tới lib/misa trong mã — KHÔNG neo vào từ khoá `from`, để bắt cả `import "…"` (tác dụng phụ),
 * `import("…")` động, `require("…")`, `export … from` và dạng index trần. Nhóm 1 = phân đoạn sau `meinvoice/` (nếu có).
 */
const DUONG_MISA = /@\/lib\/misa(?:\/meinvoice(?:\/([a-z-]+))?)?/g;
const DUONG_MISA_DUOC_PHEP = new Set(["cong", "gia-lap", "anh-xa"]);

function duongMisaNgoaiDanhSach(ma: string): string[] {
  return [...ma.matchAll(DUONG_MISA)]
    .filter((m) => !(m[0].startsWith("@/lib/misa/meinvoice/") && DUONG_MISA_DUOC_PHEP.has(m[1] ?? "")))
    .map((m) => m[0]);
}

describe("[HDNCC-W] lớp nhà cung cấp thuần", () => {
  const nguon = nguonKhongTest();

  it("[HDNCC-W1] quét đủ tệp nguồn (chống lưới rỗng): hop-dong · nang-luc · registry · misa · vin · mock · stub · bộ test hợp đồng", () => {
    const ten = nguon.map((n) => n.ten).sort();
    expect(ten).toEqual(
      [
        "bo-test-hop-dong.ts",
        "hop-dong.ts",
        "misa-adapter.ts",
        "mock-adapter.ts",
        "nang-luc.ts",
        "registry.ts",
        "stub-chua-ho-tro.ts",
        "vin-adapter.ts",
      ].sort(),
    );
  });

  it("[HDNCC-W2] không đọc env, không import DB/server-only, không gọi mạng/đồng hồ trong mã nguồn (đã bỏ chú thích)", () => {
    const cam: Array<readonly [string, RegExp]> = [
      ["process.env", /process\s*\.\s*env/],
      ["@/lib/db", /@\/lib\/db/],
      ["server-only", /server-only/],
      ["fetch(", /\bfetch\s*\(/],
      ["Date.now", /Date\s*\.\s*now\s*\(/],
      ["new Date()", /new\s+Date\s*\(\s*\)/],
      ["Math.random", /Math\s*\.\s*random/],
    ];
    for (const { ten, ma } of nguon) {
      for (const [nhan, mau] of cam) expect(ma, `${ten} chứa ${nhan}`).not.toMatch(mau);
    }
  });

  it("[HDNCC-W3] không tệp nào trong lớp này import từ lib/misa ngoài cong/gia-lap/anh-xa (không chạm http/cau-hinh/index — cấu hình là việc của tầng nối sau)", () => {
    for (const { ten, ma } of nguon) {
      expect(duongMisaNgoaiDanhSach(ma), `${ten} chạm lib/misa ngoài cong/gia-lap/anh-xa`).toEqual([]);
    }
    // chống lưới rỗng: lớp này CÓ dùng lib/misa (cổng, ánh xạ, giả lập) — quét ra 0 nghĩa là regex hỏng
    const tatCa = nguon.flatMap(({ ma }) => [...ma.matchAll(DUONG_MISA)].map((m) => m[1]));
    expect(new Set(tatCa)).toEqual(new Set(["cong", "gia-lap", "anh-xa"]));
  });

  it("[HDNCC-W3b] bộ quét bắt MỌI cách chạm vào lib/misa: from · import tác dụng phụ · import() động · require() · index trần", () => {
    const bay: ReadonlyArray<readonly [string, string]> = [
      ["import … from", `import { x } from "@/lib/misa/meinvoice/http";`],
      ["import tác dụng phụ", `import "@/lib/misa/meinvoice/http";`],
      ["import() động", `const m = await import("@/lib/misa/meinvoice/cau-hinh");`],
      ["require()", `const m = require('@/lib/misa/meinvoice/http');`],
      ["export … from", `export * from "@/lib/misa/meinvoice/http";`],
      ["index trần", `import { y } from "@/lib/misa/meinvoice";`],
      ["thư mục misa khác", `import { z } from "@/lib/misa/khac/x";`],
    ];
    for (const [nhan, ma] of bay) expect(duongMisaNgoaiDanhSach(ma), nhan).not.toEqual([]);
    // đối chứng DƯƠNG: ba đường được phép thì không bị bắt, dù viết dạng nào
    for (const ok of ["cong", "gia-lap", "anh-xa"]) {
      expect(duongMisaNgoaiDanhSach(`import "@/lib/misa/meinvoice/${ok}";`), ok).toEqual([]);
      expect(duongMisaNgoaiDanhSach(`import type { T } from "@/lib/misa/meinvoice/${ok}";`), ok).toEqual([]);
    }
  });
});
