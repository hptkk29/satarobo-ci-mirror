import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Lưới ghim DÂY NỐI (QA-08): `[HTQ-K1]` (tests/mobile-api) tự tính `gomOnline` nên KHÔNG đỏ nếu trang truyền `true` — và bộ đó cần Postgres. Ở đây ghim đúng chỗ nối.
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const TRANG = boChuThich(doc("app/(admin)/admin/hoan-tien/page.tsx"));
const BANG = boChuThich(doc("app/(admin)/admin/hoan-tien/_components/refund-table.tsx"));

describe("[HTW] màn hoàn tiền offline × đơn Online", () => {
  it("[HTW-1] trang chỉ đưa yêu cầu Online vào danh sách khi có `payments:confirm` VÀ qua cổng hoàn tiền Online", () => {
    expect(TRANG.match(/listRefundRequests\(/g)).toHaveLength(1);
    expect(TRANG.match(/gomOnline:/g)).toHaveLength(1);
    expect(TRANG).toContain("gomOnline: canApprove && duocQuanLyHoanOnline(actor)");
    expect(TRANG).toContain('const canApprove = await checkPermission("payments:confirm");');
  });

  it("[HTW-2] bảng không vẽ nút xử lý cho dòng Online: nhánh `laOnline` đứng TRƯỚC mọi nhánh có nút", () => {
    const nhanhOnline = BANG.indexOf('r.laOnline && (r.status === "PENDING" || r.status === "APPROVED") ? (');
    expect(nhanhOnline).toBeGreaterThan(-1);
    for (const nut of ['canApprove && r.status === "APPROVED" ? (', 'canApprove && r.status === "PENDING" ? (']) {
      expect(BANG.indexOf(nut), nut).toBeGreaterThan(nhanhOnline);
    }
  });
});
