import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { tinhKhaDung } from "./giu-kho";

/**
 * [GK-W] Lưới ghim dây nối + hàm thuần của giữ kho Online (V8.42). Test đọc mã nguồn là loại mong manh — neo vào BIỂU THỨC, không vào chỗ đặt chữ.
 *   [GK-W1] đường bán Offline (`orders/_actions.ts`) PHẢI trừ phần đang giữ cho Online: nếu gỡ, bán tại quầy cắt vào hàng khách Online đã giữ và đơn Online thanh toán xong mới biết hết hàng.
 *   [GK-W2] mọi nơi khoá hàng Product trong module đều ORDER BY id (khoá lộn thứ tự ⇒ deadlock khi nhiều sản phẩm × nhiều giao dịch).
 *   [GK-W3] module KHÔNG tự đọc đồng hồ (luật 19) — mọi hàm nhận `now`.
 */
const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[GK-W] giữ kho Online — dây nối và hàm thuần", () => {
  it("[GK-01p] tinhKhaDung không bao giờ âm", () => {
    expect(tinhKhaDung(10, 3)).toBe(7);
    expect(tinhKhaDung(3, 3)).toBe(0);
    expect(tinhKhaDung(2, 5)).toBe(0);
    expect(tinhKhaDung(-1, 0)).toBe(0);
  });

  it("[GK-W1] đường bán Offline trừ phần đang giữ cho Online sau khi trừ kho", () => {
    const s = doc("app/(admin)/admin/orders/_actions.ts");
    expect(s.match(/tongDangGiu\(tx,/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/updated\.stockOnHand\s*<\s*dangGiuOnline/);
    // vẫn phải nằm SAU phép trừ kho của chính nó (cùng khối, cùng giao dịch)
    expect(s.indexOf("stockOnHand: { decrement: productSnapshot.quantityRequested }")).toBeGreaterThan(-1);
    expect(s.indexOf("tongDangGiu(tx,")).toBeGreaterThan(s.indexOf("stockOnHand: { decrement: productSnapshot.quantityRequested }"));
  });

  it("[GK-W2] khoá Product luôn ORDER BY id; đúng một chỗ khoá", () => {
    const s = doc("lib/inventory/giu-kho.ts");
    expect(s.match(/FOR UPDATE/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/ORDER BY "id" FOR UPDATE/);
  });

  it("[GK-W3] module không đọc đồng hồ thật", () => {
    const s = doc("lib/inventory/giu-kho.ts");
    expect(s).not.toMatch(/new Date\(\)/);
    expect(s).not.toMatch(/Date\.now\(\)/);
  });
});
