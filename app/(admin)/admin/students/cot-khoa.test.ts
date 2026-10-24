// [SKH-*] Cột "Khoá" ở danh sách học viên đếm ghi danh CÒN SỐNG (11/10/2026).
//
// Sự cố prod: học viên CS2-26-57AWRE bị "gỡ khỏi lớp rồi add lại" ba lần ⇒ 5 dòng Enrollment,
// 4 dòng đã xoá mềm (`deletedAt` có giá trị), chỉ 1 dòng sống — màn hình in "5". Bản cũ dùng
// `_count: { select: { enrollments: true } }`, đếm cả dòng xoá mềm. Trang là RSC chạm DB nên lưới
// ghim mã nguồn (mẫu "LƯỚI GHIM MÃ NGUỒN" trong CLAUDE.md), đọc mã ĐÃ BỎ chú thích.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const goc = readFileSync(resolve(process.cwd(), "app/(admin)/admin/students/page.tsx"), "utf8").replace(/\r\n/g, "\n");
const ma = goc
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("[SKH] cột Khoá — chỉ đếm ghi danh còn sống", () => {
  it("[SKH-01] ô Khoá in độ dài mảng ghi danh đã lọc, không dùng _count.enrollments", () => {
    expect(ma.match(/\{s\.enrollments\.length\}/g)).toHaveLength(1);
    expect(ma).not.toMatch(/_count\s*:\s*\{\s*select\s*:\s*\{\s*enrollments\s*:\s*true/);
    expect(ma).not.toMatch(/_count\.enrollments/);
  });

  it("[SKH-02] mảng ghi danh của danh sách lọc deletedAt: null (nguồn chung của cột Khoá + Tình trạng học)", () => {
    const i = ma.indexOf("const STUDENT_LIST_SELECT = {");
    expect(i).toBeGreaterThan(-1);
    const khoi = ma.slice(i, ma.indexOf("\n};", i));
    expect(khoi).toMatch(/enrollments:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\}/);
  });
});
