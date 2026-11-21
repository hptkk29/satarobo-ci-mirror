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
