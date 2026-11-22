// Ca [GHL-01..04] — lưới ghim các LỚP PHÒNG VỆ THỨ HAI trong ghi-hoa-don.ts (GĐ 8, lượt cấy 27/09).
//
// Lượt cấy lại 80 phép (luật 14) tìm ra bốn lớp mà KHÔNG ca hành vi nào chạm được, vì một lớp khác
// che trước: huỷ hoá đơn có khoá đơn + `findFirst` tiền-kiểm che nhau với `updateMany` có điều kiện;
// "không trùng" có điều kiện `updatedAt` che điều kiện `khongTrungLyDo: null`. Hôm nay đúng, nhưng
// mai ai nới MỘT lớp (vd cho huỷ hàng loạt, bỏ khoá đơn) thì lớp kia là thứ duy nhất còn lại — và nó
// đang không có ai canh. Hành vi đo ở `tests/finance/hoa-don-{huy,ghi}.test.ts`; ở đây ghim văn bản.
// Bỏ chú thích TRƯỚC khi so (luật 11 — chú thích giải thích bản vá hay chứa đúng chuỗi đang tìm).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ma = readFileSync(resolve(process.cwd(), "lib/finance/hoa-don/ghi-hoa-don.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function than(ten: string): string {
  const dau = ma.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const sau = ma.indexOf("\nexport ", dau + 1);
  return ma.slice(dau, sau === -1 ? undefined : sau);
}
const doan = (t: string, dau: string, cuoi: string) => {
  const i = t.indexOf(dau);
  expect(i, `không thấy "${dau}"`).toBeGreaterThan(-1);
  return t.slice(i, t.indexOf(cuoi, i));
};
const GHI_CO_KIEM = /const upd = await tx\.hoaDonDienTu\.updateMany\(\{[^;]*\}\);\s*if \(upd\.count !== 1\) throw/g;

describe("[GHL] lớp phòng vệ thứ hai của ghi-hoa-don.ts", () => {
  it("[GHL-01] huỷ: tiền-kiểm `findFirst` chỉ nhận bản ĐÃ XÁC NHẬN", () => {
    const tien = doan(than("huyHoaDonDaXacNhan"), "tx.hoaDonDienTu.findFirst(", "select:");
    expect(tien).toMatch(/trangThai: "DA_XAC_NHAN"/);
  });

  it("[GHL-02] huỷ: ghi có điều kiện trạng thái + đếm đúng MỘT dòng rồi mới đi tiếp", () => {
    const t = than("huyHoaDonDaXacNhan");
    expect(t.match(GHI_CO_KIEM)?.length).toBe(1);
    expect(doan(t, "tx.hoaDonDienTu.updateMany(", "data:")).toMatch(/trangThai: "DA_XAC_NHAN"/);
  });

  it("[GHL-03] không trùng: `updateMany` giữ CẢ phiên bản LẪN `khongTrungLyDo: null`, và đếm đúng MỘT dòng", () => {
    const t = than("ghiKhongTrung");
    expect(t.match(GHI_CO_KIEM)?.length).toBe(1);
    const dk = doan(t, "tx.hoaDonDienTu.updateMany(", "data:");
    expect(dk).toMatch(/updatedAt: input\.phienBan/);
    expect(dk).toMatch(/khongTrungLyDo: null/);
  });

  it("[GHL-04] tra 'tệp đang bị giữ' KHÔNG qua scopedDb — bản báo sớm gọi bằng `db` trần", () => {
    // Tra qua client có scope thì tờ đang nằm ở cơ sở khác bị lọc mất ⇒ cổng mở đúng ca cần chặn.
    // Fixture DB hiện chỉ có một cơ sở nên ca hành vi không đo được vế này (lượt cấy #76).
    expect(ma).not.toMatch(/scopedDb|from "@\/lib\/db-scope"/);
    expect(ma.match(/return hoaDonDangGiuTepPdf\(db, sha256, truHoaDonId\)/g)?.length).toBe(1);
  });
});
