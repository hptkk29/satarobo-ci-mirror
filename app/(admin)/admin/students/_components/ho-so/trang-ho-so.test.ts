/**
 * Ca [HSK-*] — LƯỚI GHIM MÃ NGUỒN cho trang `/students/<id>/edit` [25/09/2026].
 *
 * Trang là RSC chạm DB (auth + scopedDb + lead), không dựng được trong jsdom — nên hai luật
 * dưới khoá bằng văn bản mã (mẫu "lưới ghim mã nguồn", CLAUDE.md). Theo luật 11: bỏ chú
 * thích trước khi soi (chú thích giải thích bản vá chứa đúng chuỗi đang tìm), neo chuỗi
 * hẹp nhất, và khẳng định SỐ LẦN khớp.
 *
 * [HSK-01] Form phải mang `key` = dấu vân tay GIÁ TRỊ hồ sơ. Ô không kiểm soát chỉ đọc
 *   `defaultValue` lúc mount: sau "Gắn lead" (điền ô trống) hay nút vòng đời (đổi trạng
 *   thái), `router.refresh()` mang giá trị mới về mà ô vẫn hiện giá trị CŨ — bấm "Lưu thay
 *   đổi" là ghi ĐÈ NGƯỢC (xoá ô vừa điền; mở lại hồ sơ vừa cho nghỉ). Mã TRƯỚC bản vá:
 *   `<StudentForm student={formValue} …/>` không có key.
 *
 * [HSK-02] Trang KHÔNG tự đọc lead. `scopedDb` chỉ cách ly truy vấn TOP-LEVEL; một
 *   `lead: { select … }` lồng trong select học viên là đọc được phiếu của cơ sở khác / Sale
 *   khác mà không cổng nào kêu. Đường duy nhất: `docLeadNguon` (cách ly + canSeeLead + che PII).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boChuThich(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TRANG = boChuThich(
  readFileSync(resolve(process.cwd(), "app/(admin)/admin/students/[id]/edit/page.tsx"), "utf8"),
);

function dem(re: RegExp): number {
  return (TRANG.match(new RegExp(re.source, "g")) ?? []).length;
}

describe("Trang hồ sơ học viên — luật ghim bằng mã nguồn", () => {
  // 25/09 (lượt rà đối kháng) — khoá chuyển sang `GiuFormKhiDangSua`: dựng lại khi CHƯA chạm,
  // GIỮ form + báo khi đang sửa dở (dựng lại là mất chữ đang gõ). Luật gốc vẫn nguyên: khoá
  // phải là băm của CHÍNH object truyền vào `student`.
  it("[HSK-01] <StudentForm> nằm trong <GiuFormKhiDangSua khoa={formKey}>, khoá = băm của CHÍNH object truyền vào `student`", () => {
    expect(dem(/<GiuFormKhiDangSua\s+khoa=\{formKey\}>\s*<StudentForm\b/)).toBe(1);
    expect(dem(/<StudentForm\b/)).toBe(1);
    expect(dem(/student=\{formValue\}/)).toBe(1);
    expect(
      dem(/const formKey = createHash\("sha1"\)\s*\.update\(JSON\.stringify\(formValue\)\)/),
    ).toBe(1);
  });

  it("[HSK-02] không tự đọc lead: không `lead`/`leadChild` lồng trong select, không `.lead.find*`; đi qua docLeadNguon đúng MỘT lần", () => {
    expect(dem(/\blead(Child)?\s*:\s*\{/)).toBe(0);
    expect(dem(/\.lead(Child)?\.find/)).toBe(0);
    expect(dem(/\bdocLeadNguon\(/)).toBe(1);
  });
});
