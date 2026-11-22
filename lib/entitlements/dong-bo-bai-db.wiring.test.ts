// [SCW-06] — LƯỚI GHIM MÃ NGUỒN cho ĐỘNG CƠ đồng bộ sổ cái từ điểm danh (`dong-bo-bai-db.ts`). Cùng họ với `lib/hoc-bu/so-cai-quyen-hoc-wiring.test.ts` (SCW-01..05, 07),
// nhưng đặt Ở ĐÂY vì nó nhắc tên bảng sổ cái, mà `[ENT-USAGE-PIN-01]` cấm mọi tệp ngoài lib/entitlements/** nhắc nó.
// Neo vào LỜI GỌI và THỨ TỰ, không vào chỗ đặt `await`/thụt lề; bóc chú thích trước khi đếm (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm).
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

/** Thân một hàm `export async function ten(` đến hàm export kế tiếp. */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}

const EN = "lib/entitlements/dong-bo-bai-db.ts";

describe("[SCW-06] động cơ đồng bộ sổ cái — dây nối", () => {
  it("[SCW-06] khoá quyền học TRƯỚC khi đọc bằng chứng; lọc cơ sở TRƯỚC tầng ghi; cờ fail-closed khi cơ sở không có OrgUnit; không bọc try/catch nuốt lỗi", () => {
    const src = ma(EN);
    const dong = than(src, "dongBoSoCaiTrongTx");
    expect(dem(dong, "FOR UPDATE")).toBe(1);
    expect(dong.indexOf("FOR UPDATE")).toBeLessThan(dong.indexOf("tx.attendance.findMany("));
    expect(dong.indexOf("FOR UPDATE")).toBeLessThan(dong.indexOf("tx.makeupNeed.findMany("));
    expect(dong.indexOf("FOR UPDATE")).toBeLessThan(dong.indexOf("tx.studyEntitlementUsage.findMany("));
    expect(dem(dong, "locTheoCoSo(")).toBe(1);
    expect(dong.indexOf("locTheoCoSo(")).toBeLessThan(dong.indexOf("ghiNhanBaiTrongTx("));
    expect(dong.indexOf("locTheoCoSo(")).toBeLessThan(dong.indexOf("huyGhiNhanBaiTrongTx("));
    // Chỉ quyền học CÙNG cơ sở được khoá (không khoá hàng của cơ sở khác).
    expect(dong).toMatch(/"centerId" = \$\{soCai\.co\.centerId\}/);
    // Cờ: tra OrgUnit, null ⇒ trả null TRƯỚC khi hỏi cờ.
    const co = than(src, "docSoCaiDiemDanh");
    expect(co.indexOf("orgUnitIdForCenter(")).toBeLessThan(co.indexOf("if (!orgUnitId) return null"));
    expect(co.indexOf("if (!orgUnitId) return null")).toBeLessThan(co.indexOf("laThuHocPhiTheoPhamViBat(orgUnitId)"));
    expect(co).not.toMatch(/laThuHocPhiTheoPhamViBat\(null\)|laThuHocPhiTheoPhamViBat\(\)/);
    // Sau một câu SQL lỗi transaction đã hỏng: nuốt lỗi chỉ để lại trạng thái nửa vời.
    expect(src).not.toMatch(/\bcatch\s*[({]/);
    // Lý do huỷ không được rỗng (huyGhiNhanBaiTrongTx ném TRƯỚC cả khi cờ tắt).
    expect(dong).toContain("LY_DO_HUY_MAT_BANG_CHUNG");
    // Bài miễn phí: khử trùng audit BONUS_LEARN trước khi gọi tầng ghi.
    expect(dong.indexOf("daCoAuditBaiBoSung(")).toBeLessThan(dong.indexOf("ghiNhanBaiTrongTx("));
  });
});
