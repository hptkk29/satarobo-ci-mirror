// [PLW-nn] Lưới ghim mã nguồn cho HAI trang play SCORM (admin + GV) — chúng là BẢN SAO của nhau, sửa THÀNH CẶP.
// Hành vi ở đây (ghi nhật ký chạy nền, bài của gói lấy cùng câu tra gói) không có test hành vi nào chạm tới vì trang là RSC chạm DB;
// gỡ nó đi thì mọi test khác vẫn xanh. Mẫu: CLAUDE.md "LƯỚI GHIM MÃ NGUỒN" — neo vào LỜI GỌI và SỐ LẦN khớp, không neo vào chỗ đặt chữ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TRANG = [
  "app/(admin)/admin/scorm/play/[id]/page.tsx",
  "app/(teacher)/teacher/scorm/play/[id]/page.tsx",
] as const;

// Bỏ dòng chú thích TRƯỚC khi đếm: chính khối chú thích giải thích bản vá có chứa các chuỗi đang cấm.
const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*(\/\/|\/\*|\*)/.test(d))
    .join("\n");
const dem = (s: string, mau: string | RegExp) =>
  typeof mau === "string" ? s.split(mau).length - 1 : (s.match(mau) ?? []).length;

describe("[PLW] trang play SCORM: ghi nhật ký mở chạy nền, không chặn render, không làm hỏng việc mở", () => {
  for (const f of TRANG) {
    it(`[PLW-1] ${f}: đúng MỘT lời gọi ghi ScormAccessLog, không await, có .catch, giữ sống bằng after()`, () => {
      const s = doc(f);
      expect(dem(s, "scormAccessLog")).toBe(1);
      expect(dem(s, /scormAccessLog\s*\.create\(/g)).toBe(1);
      // Không bao giờ await lượt ghi (cả dạng gọi thẳng lẫn qua biến).
      expect(s).not.toMatch(/await\s+sdb\.scormAccessLog/);
      expect(s).not.toMatch(/await\s+ghiNhatKy/);
      expect(s).not.toMatch(/Promise\.all\(\[[^\]]*ghiNhatKy/);
      // Lỗi ghi chỉ log: bắt ngay trên lượt ghi.
      expect(s).toMatch(/scormAccessLog\s*\.create\([\s\S]*?\)\s*\.catch\(/);
      // Giữ tiến trình sống tới khi ghi xong.
      expect(dem(s, "after(() => ghiNhatKy)")).toBe(1);
    });

    it(`[PLW-2] ${f}: bài của gói lấy cùng câu tra gói (không còn lượt lesson.findUnique nối đuôi)`, () => {
      const s = doc(f);
      expect(s).not.toMatch(/sdb\.lesson\.findUnique/);
      expect(dem(s, "lesson: { select: { curriculumId: true, curriculum: { select: { courseId: true } } } }")).toBe(1);
      expect(dem(s, "const lessonInfo = pkg.lesson;")).toBe(1);
    });

    it(`[PLW-3] ${f}: danh tính + tiến độ + gói + buổi chạy trong MỘT Promise.all (không nối đuôi)`, () => {
      const s = doc(f);
      expect(dem(s, /const \[pkg, cs, u, attempt, hdrs\] = await Promise\.all\(\[/g)).toBe(1);
      expect(dem(s, /await sdb\.user\.findUnique/g)).toBe(0);
      expect(dem(s, /await sdb\.scormAttempt\.findFirst/g)).toBe(0);
      expect(dem(s, /await headers\(\)/g)).toBe(0);
    });
  }

  it("[PLW-4] hai trang còn là BẢN SAO của nhau ở các mốc chung: cùng cổng canOpenScorm, cùng vé, cùng truyền mã gói", () => {
    for (const f of TRANG) {
      const s = doc(f);
      expect(dem(s, "canOpenScorm(actor, classSession)"), f).toBe(1);
      expect(dem(s, "canView = Boolean(teaches);"), f).toBe(1);
      expect(dem(s, "prefix: pkg.storagePrefix"), f).toBe(1);
      expect(dem(s, "packageId={pkg.id}"), f).toBe(2); // PdfSlidePlayer + ScormPlayer
      expect(dem(s, "lamNongGoi(pkg.storagePrefix)"), f).toBe(1);
    }
  });
});
