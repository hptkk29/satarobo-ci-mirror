// [GGK-*] — lưới ghim hai nửa của cặp khoá "gỡ gắn ‖ import dòng hủy" (rà vòng 3, `[V3-40]`).
//
// Ca DB `[V3-40]` giả lượt gỡ bằng một transaction TỰ giữ khoá dòng, nên nó chỉ chứng minh nửa
// IMPORT (đọc lại dưới khoá). Nửa GỠ GẮN — `goGanTheoCon` lấy khoá dòng giao dịch TRƯỚC khi đọc
// trạng thái / tín hiệu hủy — không tái hiện được bằng ca tất định, nên ghim bằng mã nguồn.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function ma(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function than(nguon: string, dau: string): string {
  const i = nguon.indexOf(dau);
  expect(i, dau).toBeGreaterThanOrEqual(0);
  const j = nguon.indexOf("\nexport ", i + 10);
  return nguon.slice(i, j < 0 ? undefined : j);
}

describe("[GGK] khoá dòng giao dịch: gỡ gắn ‖ import dòng hủy", () => {
  it("[GGK-01] `goGanTheoCon` khoá dòng giao dịch TRƯỚC khi đọc nó", () => {
    const t = than(ma("lib/finance/ghi-tien-don.ts"), "export async function goGanTheoCon(");
    const iKhoa = t.indexOf("khoaGiaoDichTrongTx(tx, input.bankTransactionId)");
    const iDoc = t.indexOf("tx.bankTransaction.findUnique(");
    expect(iKhoa).toBeGreaterThan(0);
    expect(iDoc).toBeGreaterThan(iKhoa);
  });

  it("[GGK-02] import: nhánh gốc MATCHED đọc lại trạng thái DƯỚI khoá dòng, SAU khi ghi dòng hủy", () => {
    const t = than(ma("lib/payments/pos/nhap-lo-pos.ts"), "async function xetDongHuy(");
    const iGhi = t.indexOf('const kl = await ketLuan("CAN_XU_LY", LY_DO_HUY_SAU_GHI_NHAN)');
    const iKhoa = t.indexOf("khoaGiaoDichTrongTx(tx, btGoc.id)");
    expect(iGhi).toBeGreaterThan(0);
    expect(iKhoa).toBeGreaterThan(iGhi);
  });
});

// [GGK-03..06] PR4a (11/11/2026) — gỡ gắn THU HỒI phiếu thu thay vì chặn, và nối đuôi với bộ quét tự xác nhận.
describe("[GGK] gỡ gắn sau khi khoản đã có phiếu thu (PR4a)", () => {
  const goGan = () => than(ma("lib/finance/ghi-tien-don.ts"), "export async function goGanTheoCon(");

  it("[GGK-03] `goGanTheoCon` khoá DÒNG các khoản gốc TRƯỚC khi đọc trạng thái + phiếu thu của chúng (đúng MỘT chỗ)", () => {
    const t = goGan();
    expect(t.match(/khoaDongKhoanTrongTx\(tx, /g)?.length).toBe(1);
    // Câu đọc `goc` (có `receipts`) phải đứng SAU lượt khoá — đọc trước khoá là đọc cái bộ quét còn có thể đổi.
    expect(t.indexOf("khoaDongKhoanTrongTx(tx, ")).toBeLessThan(t.indexOf("const goc = await tx.payment.findMany("));
    expect(ma("lib/finance/ghi-tien-don.ts")).toMatch(/FOR UPDATE/);
  });

  it("[GGK-04] `xacNhanKhoanTrongTx` khoá dòng khoản NGAY ĐẦU hàm, TRƯỚC khi đọc khoản và tính tiền ròng", () => {
    const t = than(ma("lib/finance/payment.ts"), "export async function xacNhanKhoanTrongTx(");
    const iKhoa = t.indexOf("FOR UPDATE");
    expect(iKhoa).toBeGreaterThan(0);
    expect(iKhoa).toBeLessThan(t.indexOf("const p = await tx.payment.findUnique("));
    expect(iKhoa).toBeLessThan(t.indexOf("TIEN_RONG_KHONG_DUONG"));
  });

  it("[GGK-05] thu hồi phiếu: cổng xác nhận mã phiếu + cổng hoá đơn đứng TRƯỚC lượt VOID, lượt VOID đứng TRƯỚC khi xoá phân bổ", () => {
    const t = goGan();
    const iCong = t.indexOf("canThuHoiPhieu: ma");
    const iHoaDon = t.indexOf("khoanDaKhoaHoaDon(tx, ");
    const iVoid = t.indexOf('data: { status: "VOID" }');
    const iXoa = t.indexOf("tx.paymentAllocation.deleteMany(");
    expect(iCong).toBeGreaterThan(0);
    expect(iHoaDon).toBeGreaterThan(0);
    expect(iVoid).toBeGreaterThan(Math.max(iCong, iHoaDon));
    expect(iXoa).toBeGreaterThan(iVoid);
    // VOID có điều kiện ACTIVE: phiếu đã VOID bởi đường khác không bị ghi đè / ghi nhật ký lần hai.
    expect(t).toMatch(/updateMany\(\{ where: \{ id: r\.id, status: "ACTIVE" \}, data: \{ status: "VOID" \} \}\)/);
    // Cổng so mã người bấm đã thấy với phiếu THẬT; không có cờ «thu hồi hết».
    expect(t).toMatch(/phieuDangCo\.filter\(\(r\) => !daXacNhan\.has\(r\.code\)\)/);
  });

  it("[GGK-06] đơn hết «trả đủ» thì xoá Order.paidAt (chỉ khi recompute báo CHƯA settled), và KHÔNG hạ Order.status", () => {
    const t = goGan();
    expect(t).toMatch(/if \(!sauTinh\.settled\) \{\s*await tx\.order\.updateMany\(\{ where: \{ id: input\.orderId, paidAt: \{ not: null \} \}, data: \{ paidAt: null \} \}\);/);
    expect(t).not.toMatch(/tx\.order\.update(?:Many)?\([^)]*status/);
  });
});
