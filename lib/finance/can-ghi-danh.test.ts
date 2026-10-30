// Ca [CGD-*] — loại đơn nào PHẢI có ghi danh mới xác nhận được khoản (chốt 29/09/2026). THUẦN.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { donCanGhiDanh, thieuGhiDanh } from "./can-ghi-danh";

describe("[CGD-01] chỉ KIT (PRODUCT) và THI (EXAM) được miễn ghi danh", () => {
  it("PRODUCT / EXAM ⇒ không cần", () => {
    expect(donCanGhiDanh("PRODUCT")).toBe(false);
    expect(donCanGhiDanh("EXAM")).toBe(false);
  });
  it("COURSE ⇒ vẫn cần (đối chứng dương: cổng cũ không bị gỡ)", () => {
    expect(donCanGhiDanh("COURSE")).toBe(true);
  });
  it("fail-closed: PACKAGE / COMBO / loại lạ / null ⇒ vẫn cần", () => {
    for (const t of ["PACKAGE", "COMBO", "product", "", "LA"]) expect(donCanGhiDanh(t), t).toBe(true);
    expect(donCanGhiDanh(null)).toBe(true);
  });
});

describe("[CGD-02] thieuGhiDanh = chưa gắn VÀ loại đơn cần", () => {
  it("bảng chân trị", () => {
    expect(thieuGhiDanh({ enrollmentId: null }, "COURSE")).toBe(true);
    expect(thieuGhiDanh({ enrollmentId: null }, null)).toBe(true);
    expect(thieuGhiDanh({ enrollmentId: null }, "PRODUCT")).toBe(false);
    expect(thieuGhiDanh({ enrollmentId: null }, "EXAM")).toBe(false);
    expect(thieuGhiDanh({ enrollmentId: "gd" }, "COURSE")).toBe(false);
    expect(thieuGhiDanh({ enrollmentId: "gd" }, "PRODUCT")).toBe(false);
  });
});

// LƯỚI GHIM DÂY NỐI — test hành vi của từng nơi gọi chạm DB hoặc mock lõi, nên gỡ lời gọi ở một nơi
// thì không ca hành vi thuần nào đỏ. Trước bản vá cả năm nơi viết `!x.enrollmentId` trần.
describe("[CGD-W] mọi nơi quyết 'thiếu ghi danh' đi qua thieuGhiDanh, không còn điều kiện trần", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const NOI: [string, number][] = [
    // cổng sớm của confirmPayment + lõi xacNhanKhoanTrongTx + adjustPayment (29/09 — nút "Điều chỉnh")
    ["lib/finance/payment.ts", 3],
    ["lib/finance/hoa-don/chot-hoa-don.ts", 1],
    ["lib/finance/hoa-don/dong-hang-cho.ts", 1],
    ["app/(admin)/admin/payments/_actions.ts", 1],
    ["lib/finance/backfill-confirm.ts", 1], // xác nhận hàng loạt khoản nhập liệu ban đầu
    ["lib/finance/gan-ghi-danh-khoan.ts", 1], // danh sách "khoản bị bỏ / chờ gắn"
  ];
  for (const [f, n] of NOI) {
    it(f, () => {
      const src = boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
      expect(src.match(/\bthieuGhiDanh\(/g)?.length ?? 0).toBe(n);
    });
  }
  it("lõi + chốt hoá đơn + hàng chờ không còn `!p.enrollmentId` trần làm cổng", () => {
    for (const f of ["lib/finance/hoa-don/chot-hoa-don.ts", "lib/finance/hoa-don/dong-hang-cho.ts"]) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
      expect(src, f).not.toMatch(/if \(!p\.enrollmentId\)/);
    }
    const pay = boChuThich(readFileSync(resolve(process.cwd(), "lib/finance/payment.ts"), "utf8"));
    expect(pay).not.toMatch(/if \(!p\.enrollmentId\) throw new LoiXacNhanKhoan/);
    expect(pay).not.toMatch(/if \(!existing\.enrollmentId\) \{\s*return fail\("Khoản chưa gắn ghi danh, không thể/);
  });
});

// Ba chỗ CÒN SÓT sau bản nối đầu (29/09/2026): điều chỉnh · xác nhận hàng loạt · thông báo PH.
describe("[CGD-W2] adjustPayment · backfill-confirm · handler payment.confirmed hỏi CÙNG luật", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));

  it("adjustPayment không còn cổng `!original.enrollmentId` trần", () => {
    expect(doc("lib/finance/payment.ts")).not.toMatch(/if \(!original\.enrollmentId\)/);
    expect(doc("lib/finance/payment.ts")).toMatch(/thieuGhiDanh\(original, original\.order\?\.type \?\? null\)/);
  });
  it("backfill-confirm + gan-ghi-danh-khoan không còn cổng enrollmentId trần", () => {
    expect(doc("lib/finance/backfill-confirm.ts")).not.toMatch(/if \(!p\.enrollmentId\)/);
    expect(doc("lib/finance/gan-ghi-danh-khoan.ts")).not.toMatch(/if \(p\.enrollmentId\) return \{ hien: false \}/);
  });
  it("hai màn gọi truyền loaiDon từ `Order.type`", () => {
    const a = doc("app/(admin)/admin/payments/_actions.ts");
    expect(a.match(/loaiDon: (r\.)?order\?\.type \?\? null/g)?.length ?? 0).toBe(2);
  });
  it("handler payment.confirmed: khoản không ghi danh hỏi donCanGhiDanh, không bỏ ngang", () => {
    const h = doc("lib/_handlers/r7-notifications.ts");
    expect(h.match(/\bdonCanGhiDanh\(/g)?.length ?? 0).toBe(1);
    expect(h).not.toMatch(/if \(!paymentId \|\| !enrollmentId\) return;\s*\n\s*const enr = await db\.enrollment\.findFirst/);
  });
});
