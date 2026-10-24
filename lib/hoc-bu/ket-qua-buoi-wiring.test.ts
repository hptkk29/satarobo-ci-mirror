// [KQW-*] — LƯỚI GHIM MÃ NGUỒN cho T08: kết quả học bù của một buổi gốc chỉ đi qua MỘT đường đọc.
//
// Test hành vi (`tests/hoc-bu/ket-qua-buoi.test.ts`) chứng minh đường đọc đúng. Thứ nó KHÔNG canh: một màn MỚI (hay màn cũ bị sửa) tự suy "đã bù chưa" từ
// `makeupStatus` hoặc tự ghép câu "Đã học bù ngày …" — màn đó vẫn xanh mọi test của nó và lệch mô hình đọc ngay lúc dữ liệu có hơn một lần thử.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
const dem = (s: string, x: string) => s.split(x).length - 1;

const tep = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx", "components/**/*.tsx"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));

describe("[KQW] T08 — một đường đọc kết quả học bù", { timeout: 60_000 }, () => {
  it("[KQW-01] mô hình đọc THUẦN: không import DB / server-only, không đọc `Attendance`, không có phép ghi nào", () => {
    const m = ma("lib/hoc-bu/ket-qua-buoi.ts");
    expect(m).not.toMatch(/from "@\/lib\/db"/);
    expect(m).not.toMatch(/server-only/);
    expect(m).not.toMatch(/\battendance\b/i);
    expect(m).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    // Chỉ NHẬP kiểu từ Prisma (không import giá trị): file thuần chạy được ở client.
    for (const dong of m.split("\n").filter((d) => d.includes('from "@prisma/client"'))) expect(dong).toMatch(/^import type /);
  });

  it("[KQW-02] vỏ DB: MỘT truy vấn cho cả lô (không N+1), chỉ ĐỌC, đi từ DÒNG CẦN BÙ (không từ bản ghi điểm danh)", () => {
    const d = ma("lib/hoc-bu/ket-qua-buoi-db.ts");
    expect(dem(d, ".findMany(")).toBe(1);
    expect(d).toContain("nguon.makeupNeed.findMany(");
    expect(d).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(d).not.toMatch(/\battendance\b/i);
    expect(d).toContain("dungKetQuaBuoi(");
  });

  it("[KQW-03] các màn đi qua ĐÚNG đường đọc: roster điểm danh (admin + site GV dùng chung) và hồ sơ học viên gọi `docKetQuaBuoi` MỘT lần", () => {
    for (const f of ["lib/attendance/roster.ts", "lib/students/progress.ts"]) {
      const s = ma(f);
      expect(dem(s, "docKetQuaBuoi("), f).toBe(1);
      expect(s, f).toContain("gonKetQua(");
    }
    // Site GV và lưới admin chỉ ĐỌC trường `ketQuaBu` mà roster đã dựng — không tự tra gì thêm.
    expect(ma("app/(teacher)/teacher/lop/page.tsx")).toContain("ketQuaBu: r.ketQuaBu?.nhan ?? null");
    expect(ma("app/(admin)/admin/attendance/_components/attendance-grid.tsx")).not.toMatch(/docKetQuaBuoi|makeupNeed/);
  });

  it("[KQW-04] câu 'Đã học bù ngày …' chỉ được SINH ở mô hình đọc — không màn nào tự ghép lại", () => {
    const co = tep().filter((f) => /Đã học bù ngày/.test(ma(f)));
    expect(co).toEqual(["lib/hoc-bu/ket-qua-buoi.ts"]);
  });

  it("[KQW-05] `AttendanceRosterRow.ketQuaBu` BẮT BUỘC khai ở cả hai nhánh dựng hàng (luật 7: quên khai là lỗi biên dịch, không phải hàng lặng lẽ không hiện kết quả bù)", () => {
    const r = doc("lib/attendance/roster.ts");
    expect(r).toMatch(/\n\s{2}ketQuaBu: KetQuaBuoiGon \| null;\n/); // không có dấu `?`
    expect(dem(ma("lib/attendance/roster.ts"), "ketQuaBu: null")).toBe(2);
  });
});
