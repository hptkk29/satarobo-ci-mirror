import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [MIEN-A] BA MIỀN HỌC TẬP TÁCH BẠCH (chủ dự án chốt 19/11/2026) — lưới ghim mã nguồn, chạy trong `test:unit`:
 *   ONLINE_ELEARNING (khoá Online đã mua; hệ E-learning, Workstream E) · OFFLINE_CLASS_LMS (Assignment/Exam lớp offline = `/learning/**` của API di động) ·
 *   STAFF_INTERNAL_TRAINING (`Trn*`, KHÔNG BAO GIỜ cho học viên/phụ huynh).
 *   [MIEN-A-01] mã API di động (lib/mobile-api, app/api/mobile) KHÔNG chạm model `Trn*` và KHÔNG import `@/lib/elearning`
 *   [MIEN-A-02] không route di động nào mang tên khoá online dưới `/learning/**` (V8.9: khoá Online có tuyến RIÊNG `/students/:id/online/**`)
 *   [MIEN-A-03] đối chứng dương: lưới quét được ≥ 40 tệp và thấy đúng các tệp LMS lớp
 */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function tep(d: string, ra: string[] = []): string[] {
  for (const t of readdirSync(d)) {
    const p = join(d, t);
    if (statSync(p).isDirectory()) tep(p, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(p);
  }
  return ra;
}
const GOC = [resolve(process.cwd(), "lib/mobile-api"), resolve(process.cwd(), "app/api/mobile")];
const dsTep = GOC.flatMap((d) => tep(d));

describe("[MIEN-A] ba miền học tập tách bạch ở API di động", () => {
  it("[MIEN-A-01] không chạm model Trn* và không import lib/elearning", () => {
    for (const p of dsTep) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      expect(ma, `${p} chạm model Trn*`).not.toMatch(/\b(db|tx|pdb|sdb|prisma)\.trn[A-Z]\w*/);
      expect(ma, `${p} nhắc model Trn* kiểu Prisma`).not.toMatch(/Prisma\.Trn[A-Z]/);
      // V8.9: hệ E-learning NỘI BỘ (`@/lib/elearning`) vẫn cấm. Lõi Online (`@/lib/elearning-online`) CHỈ được gọi từ MỘT tệp: `dich-vu/online-hoc.ts` (lớp HTTP mỏng; không engine thứ hai).
      expect(ma, `${p} import hệ E-learning nội bộ`).not.toMatch(/from\s+["']@\/lib\/elearning(?!-online)/);
      // V8.45: Free Mode là tệp THỨ HAI được phép (lớp HTTP mỏng riêng của học thử/tự nhận — không engine thứ hai). Danh sách ĐÓNG: thêm tệp thứ ba là quyết định có chủ đích.
      if (/from\s+["']@\/lib\/elearning-online/.test(ma)) expect(["lib/mobile-api/dich-vu/online-hoc.ts", "lib/mobile-api/dich-vu/free-mode.ts", "lib/mobile-api/dich-vu/online-san-pham.ts"].some((t) => p.replace(/\\/g, "/").endsWith(t)), `${p} import lõi Online ngoài online-hoc.ts / free-mode.ts`).toBe(true);
    }
  });

  it("[MIEN-A-02] không route di động tên khoá online dưới learning/**", () => {
    // tên TƯƠNG ĐỐI (đường dẫn tuyệt đối của máy có thể chứa chữ "online" do tên thư mục làm việc)
    const rel = (p: string) => p.replace(/\\/g, "/").slice(process.cwd().replace(/\\/g, "/").length);
    const route = dsTep.filter((p) => rel(p).includes("/learning/"));
    for (const p of route) expect(rel(p), p).not.toMatch(/online|e-?learning|trn|khoa-hoc-online/i);
  });

  it("[MIEN-A-03] đối chứng dương: lưới có tệp để quét", () => {
    expect(dsTep.length).toBeGreaterThanOrEqual(40);
    const t = dsTep.map((p) => p.replace(/\\/g, "/"));
    expect(t.some((p) => p.endsWith("lib/mobile-api/dich-vu/bai-thi-luot.ts"))).toBe(true);
    expect(t.some((p) => p.includes("/learning/attempts/"))).toBe(true);
  });
});
