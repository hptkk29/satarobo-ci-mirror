// [BBW-*] — LƯỚI GHIM MÃ NGUỒN cho T12: công dạy bù đi qua MỘT định nghĩa "case nào có công" và nằm trong bản chốt kỳ.
//
// Test hành vi (`tests/hoc-bu/cong-day-bu.test.ts`) chứng minh luật chạy đúng. Thứ nó KHÔNG canh: hai nơi tự gõ lại danh sách trạng thái
// (lệch nhau dần), bản chốt dựng buổi bù từ tập người đã lọc (giáo viên chỉ dạy bù biến mất), hoặc đường học bù ghi thẳng vào kỳ công đã khoá.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
function tepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const t of readdirSync(resolve(process.cwd(), dir))) {
    const d = join(dir, t);
    if (statSync(resolve(process.cwd(), d)).isDirectory()) ra.push(...tepTs(d));
    else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(d);
  }
  return ra;
}

describe("[BBW] T12 — công dạy bù", { timeout: 30_000 }, () => {
  it("[BBW-01] công dạy và bản chốt cùng đọc trạng thái có công từ MỘT hằng (`TRANG_THAI_CASE_CO_CONG`), không ai tự gõ danh sách", () => {
    const cd = ma("lib/cham-cong/cong-day-db.ts");
    const kp = ma("lib/cham-cong/period.ts");
    expect(cd).toContain("status: { in: [...TRANG_THAI_CASE_CO_CONG] }");
    expect(kp).toContain("status: { in: [...TRANG_THAI_CASE_CO_CONG] }");
    for (const [ten, src] of [["cong-day-db", cd], ["period", kp]] as const) {
      expect(src, `${ten} tự gõ danh sách trạng thái`).not.toMatch(/status:\s*\{\s*in:\s*\[\s*"COMPLETED",\s*"NO_SHOW"/);
    }
  });

  it("[BBW-02] bản chốt dựng buổi bù theo CƠ SỞ + THÁNG, KHÔNG lọc theo tập người (`userIds`) — giáo viên chỉ dạy bù vẫn nằm trong bản chốt", () => {
    const kp = ma("lib/cham-cong/period.ts");
    const i = kp.indexOf("db.makeupCase.findMany(");
    expect(i).toBeGreaterThan(0);
    const q = kp.slice(i, i + 400);
    expect(q).toContain("centerId,");
    expect(q).toContain("date: { gte: from, lte: to }");
    expect(q).not.toContain("userIds");
    expect(kp).toContain("    buoiBu,\n    totals: {");
    expect(kp).toContain("makeupSessions: buoiBu.length,");
  });

  it("[BBW-03] `teachingSessions` KHÔNG đổi nghĩa: vẫn chỉ đếm buổi LỚP, buổi bù đi cột riêng", () => {
    const kp = ma("lib/cham-cong/period.ts");
    expect(dem(kp, "teachingSessions: teach.get(userId) ?? 0,")).toBe(1);
    expect(kp).toContain("makeupSessions: buBoiNguoi.get(userId)?.soBuoi ?? 0,");
    expect(kp).toContain("makeupMinutes: buBoiNguoi.get(userId)?.phut ?? 0,");
  });

  it("[BBW-04] checker: TV-93 nằm trong LUAT (đang chạy), KHÔNG còn ở LUAT_HOAN, và được nối vào `chayToanVen`", () => {
    const t = ma("lib/hoc-bu/toan-ven.ts");
    expect(t).toContain('"TV-93": "Công dạy bù ngoài bản chốt kỳ công');
    const hoan = t.slice(t.indexOf("export const LUAT_HOAN"), t.indexOf("export type Finding"));
    expect(hoan).not.toContain("TV-93");
    expect(dem(t, "...luatCongDayBu(ctx),")).toBe(1);
  });

  it("[BBW-05] nửa đọc phân biệt bản chốt CŨ (không có trường) với bản chốt RỖNG bằng `jsonb_exists`, và chỉ lấy trường `buoiBu`", () => {
    const d = ma("lib/hoc-bu/toan-ven-db.ts");
    expect(d).toContain("jsonb_exists(\"summaryJson\"::jsonb, 'buoiBu')");
    expect(d).toContain("banChotBuoiBu: k.coTruong ? docBuoiBuTuBanChot(k.buoiBu) : undefined,");
    expect(d).toContain("\"status\" = 'LOCKED'");
  });

  it("[BBW-06] KỲ ĐÃ CHỐT không bị đường học bù GHI trực tiếp: lib/hoc-bu/** không ghi AttendancePeriod / StaffAttendanceDay / summaryJson (chỉ được ĐỌC kỳ)", () => {
    // Hai nơi được NHÌN vào kỳ: nửa đọc của checker (transaction READ ONLY, chỉ SELECT — xem [BBW-05]) và `chotLaiCaseTrongTx` (T14: hỏi kỳ đã chốt chưa để ghi
    // dấu vết `hoc-bu.cong-day-sau-chot-ky`; chỉ `findUnique`). Mọi nơi khác không được nhắc tới kỳ công. Không nơi nào được GHI.
    const DOC_KY = ["toan-ven-db.ts", "case-diem-danh-db.ts"];
    for (const f of tepTs("lib/hoc-bu").filter((x) => !DOC_KY.some((k) => x.endsWith(k)))) {
      expect(ma(f), f).not.toMatch(/attendancePeriod|staffAttendanceDay|summaryJson/i);
    }
    for (const f of DOC_KY) {
      const m = ma("lib/hoc-bu/" + f);
      expect(m, f).not.toMatch(/staffAttendanceDay/i);
      if (f === "case-diem-danh-db.ts") expect(m, f).not.toMatch(/summaryJson/i); // checker ĐỌC `summaryJson` để so với case; luồng ghi thì không đụng
      expect(m, f).not.toMatch(/attendancePeriod\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\b/);
      expect(m, f).not.toMatch(/(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"AttendancePeriod"/i);
    }
    expect(ma("lib/hoc-bu/case-diem-danh-db.ts")).toContain("tx.attendancePeriod.findUnique(");
  });

  it("[BBW-07] xuất Excel kỳ công có cột buổi bù, và màn kỳ công truyền số đó xuống bảng", () => {
    const x = ma("lib/cham-cong/export-xlsx.ts");
    expect(x).toContain('"Buổi dạy bù", "Phút dạy bù"');
    expect(x).toContain("r.makeupSessions ?? 0, r.makeupMinutes ?? 0");
    expect(ma("app/(admin)/admin/cham-cong/ky-cong/page.tsx")).toContain("makeupSessions: r.makeupSessions,");
  });
});
