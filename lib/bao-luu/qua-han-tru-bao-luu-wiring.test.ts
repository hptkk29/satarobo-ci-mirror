// lib/bao-luu/qua-han-tru-bao-luu-wiring.test.ts — LƯỚI GHIM DÂY NỐI cho K19: mọi đường tính "quá hạn bao nhiêu ngày" của SỔ CŨ và các cổng nợ phải đi qua MỘT hàm
// (`tinhSoNgayQuaHanTruBaoLuu` + `docKhoang*`). Test hành vi của từng cron/trang đều chạm DB hoặc RSC nên không có chỗ cấy lỗi; quên nối một đường là KHÔNG ca nào đỏ — và
// đúng đường bị quên sẽ lại "nhảy ngày" sau phục học.
//
// Luật 11: bỏ chú thích TRƯỚC khi đếm, neo hẹp, đếm số lần. Lưới này chỉ có nghĩa khi đã CẤY thử (xem commit).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function maThat(duongDan: string): string {
  return readFileSync(resolve(process.cwd(), duongDan), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");
}
const dem = (ma: string, re: RegExp) => ma.match(re)?.length ?? 0;

describe("[KQH-W] đường nào cũng tính quá hạn TRỪ thời gian bảo lưu", () => {
  it("[KQH-W1] cron debt-reminder: chuông 'Công nợ quá hạn' hỏi `tinhSoNgayQuaHanTruBaoLuu` (1 lần) và KHÔNG còn `overdueBucket(`", () => {
    const ma = maThat("app/api/cron/debt-reminder/route.ts");
    expect(dem(ma, /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
    expect(dem(ma, /docKhoangTheoDon\(/g)).toBe(1);
    expect(ma).not.toMatch(/overdueBucket\(/);
  });

  it("[KQH-W2] danh sách quá hạn theo nhà (sổ mới): `gomTheoNha` và loader đều dùng hàm chung; không còn `soNgayQuaHan(` trực tiếp trong đường gom", () => {
    const thuan = maThat("lib/finance/qua-han.ts");
    expect(dem(thuan, /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
    const db = maThat("lib/finance/qua-han-db.ts");
    expect(dem(db, /docKhoangTheoDong\(/g)).toBe(1);
    expect(dem(db, /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
    expect(thuan.match(/const soNgay = soNgayQuaHan\(/)).toBeNull();
  });

  it("[KQH-W3] cron payment-reconcile: đợt PARTIAL sau phục học mà 0 ngày quá hạn không bị báo kế toán", () => {
    const ma = maThat("app/api/cron/payment-reconcile/route.ts");
    expect(dem(ma, /docKhoangTheoDong\(/g)).toBe(1);
    expect(dem(ma, /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
  });

  it("[KQH-W4] cổng nợ khi lập / duyệt / phục học: `soNgayQuaHanLonNhat` dùng hàm chung và `docKhoanDenHan` điền `khoang` cho CẢ hai sổ; ba chỗ gọi truyền `now`", () => {
    expect(dem(maThat("lib/bao-luu/hoso.ts"), /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
    const nc = maThat("lib/bao-luu/ngu-canh-db.ts");
    expect(dem(nc, /khoangCuaCap\(/g)).toBe(1);
    expect(nc).toMatch(/dueDate: r\.dueDate!, conNo: r\.amountDue[^}]*khoang/);
    expect(nc).toMatch(/dueDate: r\.dueDate!, conNo: r\.amount, khoang/);
    const dv = maThat("lib/bao-luu/dich-vu.ts");
    expect(dem(dv, /docKhoanDenHan\(tx, \{[^}]*\bnow\b[^}]*\}\)/g)).toBe(2);
    expect(dem(maThat("lib/bao-luu/phuc-hoc-db.ts"), /docKhoanDenHan\(tx, \{[^}]*\bnow\b[^}]*\}\)/g)).toBe(1);
  });

  it("[KQH-W5] màn /cong-no + tệp xuất: tuổi nợ qua `gomTuoiNo` (xem [BL1-W3/W4]); `tuoi-no.ts` không tự tính số ngày", () => {
    const t = maThat("lib/finance/tuoi-no.ts");
    expect(dem(t, /tinhSoNgayQuaHanTruBaoLuu\(/g)).toBe(1);
    expect(t).not.toMatch(/overdueBucket\(/);
  });
});
