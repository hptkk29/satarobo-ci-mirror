// [CTW-*] — LƯỚI GHIM MÃ NGUỒN cho "QLCS cấp thêm lượt học bù" (22/10/2026).
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/cap-them-luot.test.ts`). Thứ nó KHÔNG canh: action quên cổng quyền, phép ghi sổ bị dời ra ngoài giao dịch,
// nút hiện cho người không có quyền, hay một đường THỨ HAI ghi sổ lượt bằng tay. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP
// vào LỜI GỌI, khẳng định THỨ TỰ và đếm số lần khớp.
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
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};
const dem = (s: string, x: string) => s.split(x).length - 1;

const ACT = "app/(admin)/admin/hoc-bu/_actions.ts";
const DB = "lib/hoc-bu/cap-them-luot-db.ts";
const UI = "app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx";

describe("[CTW] cấp thêm lượt học bù — dây nối", { timeout: 30_000 }, () => {
  it("[CTW-01] server action: cổng `makeup:waive` là câu ĐẦU, đứng trước mọi đọc/ghi; không dùng quyền nào yếu hơn", () => {
    const a = than(ma(ACT), "capThemLuotAction");
    expect(a).toContain('await cong("makeup:waive")');
    expect(vi(a, 'cong("makeup:waive")')).toBeLessThan(vi(a, "capLuotSchema.safeParse"));
    expect(vi(a, 'cong("makeup:waive")')).toBeLessThan(vi(a, "await capThemLuot("));
    expect(a).not.toMatch(/cong\("makeup:(manage|attend)"\)/);
    // số lượt chặn cả ở schema (không chỉ ở dịch vụ): trần lấy từ MỘT hằng
    expect(ma(ACT)).toMatch(/delta: z\.number\(\)\.int\(\)\.min\(-TOI_DA_LUOT_MOI_LAN\)\.max\(TOI_DA_LUOT_MOI_LAN\)\.refine\(\(n\) => n !== 0/);
  });

  it("[CTW-02] dịch vụ: đọc dòng cần bù qua `scopedDb(actor)` TRƯỚC giao dịch; ghi sổ bằng `dieuChinhLuot` DƯƠNG, trong giao dịch, rồi mới nhật ký", () => {
    const s = than(ma(DB), "capThemLuot");
    expect(vi(s, "kiemCapThemLuot(")).toBeLessThan(vi(s, "docDongTheoId(scopedDb(actor)"));
    expect(vi(s, "docDongTheoId(scopedDb(actor)")).toBeLessThan(vi(s, "$transaction("));
    expect(vi(s, "$transaction(")).toBeLessThan(vi(s, "await dieuChinhLuot(tx"));
    expect(vi(s, "await dieuChinhLuot(tx")).toBeLessThan(vi(s, "await ghiNhatKy(tx"));
    expect(s).toMatch(/dieuChinhLuot\(tx, \{[\s\S]*?\bdelta: p\.delta,/); // đúng số CÓ DẤU người dùng chọn — không lấy trị tuyệt đối, không nhân
    expect(s).toContain("const nguon = nguonCapThem(p.maLanCap);"); // khoá `qlcs:<mã>` — một chỗ, dùng cho cả nhận-ra-lần-chạy-lại lẫn bút toán
    expect(s).toMatch(/dieuChinhLuot\(tx, \{[\s\S]*?\bnguon,/);
    // chạy lại cùng mã ⇒ KHÔNG nhật ký lần hai: cổng `ap === 0` đứng TRƯỚC ghiNhatKy
    expect(vi(s, "if (ap === 0)")).toBeLessThan(vi(s, "await ghiNhatKy(tx"));
    expect(dem(s, "ghiNhatKy(tx")).toBe(1);
    // không tự ghi sổ bằng tay (đọc để nhận ra lần chạy lại thì được; GHI chỉ ở so-luot.ts)
    expect(s).not.toMatch(/\bmakeupCredit(Account|Entry)\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    // chiều giảm không còn lượt trống ⇒ ném (rollback) TRƯỚC khi ghi nhật ký; nhật ký đổi tên hành động theo dấu
    expect(vi(s, 'throw new LoiHocBu("Học viên không còn lượt trống')).toBeLessThan(vi(s, "await ghiNhatKy(tx"));
    expect(s).toContain('action: p.delta > 0 ? "hoc-bu.cap-them-luot" : "hoc-bu.giam-luot"');
  });

  it("[CTW-03] KIỂM KÊ: `dieuChinhLuot(` chỉ được gọi ở BA nơi — đơn bị huỷ/hoàn, cấp thêm lượt của QLCS, và học vượt bù khi chuyển đổi đơn (27/10/2026)", () => {
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    const goi = tep.filter((f) => /\bdieuChinhLuot\(/.test(ma(f)) && f !== "lib/hoc-bu/so-luot.ts");
    expect(goi.sort()).toEqual(["lib/hoc-bu/cap-them-luot-db.ts", "lib/hoc-bu/don-doi-db.ts", "lib/orders/hoc-vuot-chuyen-doi.ts"]);
  });

  it("[CTW-04] màn hình: mục menu CHỈ nằm trong khối `coTheHuy` (người có `makeup:waive`); mã lần cấp sinh trong HANDLER bấm, không trong lúc render", () => {
    const u = ma(UI);
    const dau = vi(u, "{coTheHuy && (");
    const menu = u.slice(dau, vi(u, "</DropdownMenu>") + "</DropdownMenu>".length);
    expect(menu).toContain("Cấp thêm / giảm lượt bù");
    expect(menu).toContain("setHopCapLuot({ dong: d, ma: taoMaLanCap() })");
    // ngoài khối menu không có lối vào thứ hai
    expect(dem(u, "setHopCapLuot({")).toBe(1);
    // `taoMaLanCap()`: một khai báo + đúng MỘT lời gọi (trong onClick). Gọi ở thân component ⇒ mã đổi mỗi lần render ⇒ bấm đúp cấp hai lần.
    expect(dem(u, "taoMaLanCap()")).toBe(2);
    // hộp thoại gửi chính mã đã sinh lúc mở, không sinh mã mới lúc bấm
    expect(u).toContain("maLanCap: hop.ma");
    expect(u).toContain("capThemLuotAction(");
    // chiều GIẢM = số ÂM gửi lên máy chủ; đảo dấu là biến nút "Giảm" thành "Cấp thêm" mà không test hành vi nào thấy (chúng gọi dịch vụ, không gọi hộp thoại)
    expect(u).toContain("delta: laGiam ? -n : n");
  });
});
