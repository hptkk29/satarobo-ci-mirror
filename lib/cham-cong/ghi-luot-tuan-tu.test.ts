// [H2-W*] dây nối — đường ghi lượt chấm công đi qua MỘT đoạn tuần tự. Hành vi (Postgres thật, song song): tests/cham-cong/cham-cong-dua.spec.ts.
// Mã TRƯỚC bản vá: `recordCheckin` / `chamCongTac` gọi `suyHuongHomNay` rồi `recordTimeLog` trên `db`, không giao dịch, không khoá —
// đo trên mã cũ: [RACE-01] [RACE-02] đỏ 3/3 lần (hai VÀO hợp lệ).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ma = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[H2-W] ghi lượt tuần tự", () => {
  const L = ma("lib/cham-cong/ghi-luot-tuan-tu.ts");

  it("[H2-W1] trong MỘT giao dịch: khoá (người, ngày) → mốc now → suy hướng trên tx → ghi trên tx với ĐÚNG hướng vừa suy", () => {
    const khoa = L.indexOf("await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoaChamCong(p.userId, ngay)}))`;");
    const moc = L.indexOf("const now = p.now ?? new Date();");
    const suy = L.indexOf("const suy = await suyHuongHomNay({ userId: p.userId, workLocationId: p.workLocationId, now, client: tx });");
    const ghi = L.indexOf("const r = await recordTimeLog({ ...p, direction: suy.huong, now, client: tx });");
    expect([khoa, moc, suy, ghi].every((i) => i > 0)).toBe(true);
    expect(khoa).toBeLessThan(moc);
    expect(moc).toBeLessThan(suy);
    expect(suy).toBeLessThan(ghi);
    expect(L.indexOf("db.$transaction(")).toBeLessThan(khoa);
    expect(dem(L, /suyHuongHomNay\(/g)).toBe(1);
    expect(dem(L, /recordTimeLog\(/g)).toBe(1);
  });

  it("[H2-W2] hai Server Action chấm công chỉ GHI qua ghiLuotTuanTu — không gọi recordTimeLog trực tiếp", () => {
    for (const f of ["lib/attendance/checkin-action.ts", "lib/cham-cong/cong-tac-action.ts"]) {
      const s = ma(f);
      expect(dem(s, /await ghiLuotTuanTu\(/g), f).toBe(1);
      expect(dem(s, /recordTimeLog\(/g), f).toBe(0);
    }
  });

  it("[H2-W3] lỗi chờ khoá ⇒ HOÀN VÉ và trả lỗi bấm lại (không bao giờ tiêu vé mà không ghi)", () => {
    const s = ma("lib/attendance/checkin-action.ts");
    const bat = s.slice(s.indexOf("await ghiLuotTuanTu("), s.indexOf("const { now, suy, r } = ghi;"));
    expect(bat).toMatch(/catch \(e\) \{[\s\S]*await hoanVe\(d\.ticketId\);[\s\S]*veConDung: conDung/);
  });
});
