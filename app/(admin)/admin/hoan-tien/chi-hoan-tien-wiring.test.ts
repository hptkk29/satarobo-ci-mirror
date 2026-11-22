// [CHT-W*] — LƯỚI GHIM DÂY NỐI của nút "Đánh dấu đã chi" (/admin/hoan-tien).
//
// Luật 12 (affordance nói thật): nút chỉ được vẽ khi action SẼ nhận. Action gác `payments:confirm`
// (ca hành vi `[CHT-A1]`, tests/finance/chi-hoan-tien.test.ts); ca hành vi KHÔNG chạm được trang RSC
// hay bảng client, nên dây nối "trang hỏi đúng quyền đó → bảng vẽ nút theo đúng cờ đó, chỉ cho dòng
// ĐÃ DUYỆT" được ghim ở đây bằng mã nguồn. Mã TRƯỚC bản vá: không có nút, không có action.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    // Bỏ chú thích TRƯỚC khi so khớp — chú thích giải thích bản vá hay chứa đúng chuỗi đang tìm.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DIR = "app/(admin)/admin/hoan-tien";

describe("[CHT-W] dây nối nút 'Đánh dấu đã chi'", () => {
  it("[CHT-W1] action hỏi payments:confirm ở đầu hàm; trang tính canApprove bằng CHÍNH quyền đó", () => {
    const act = doc(`${DIR}/_actions.ts`);
    const than = act.slice(act.indexOf("export async function chiHoanTienAction"));
    expect(than.indexOf('checkPermission("payments:confirm")')).toBeGreaterThan(-1);
    expect(than.indexOf('checkPermission("payments:confirm")')).toBeLessThan(than.indexOf("chiHoanTien({"));
    expect(than.match(/passesScope\("Order", don, actor\)/g)).toHaveLength(1);

    const page = doc(`${DIR}/page.tsx`);
    expect(page.match(/const canApprove = await checkPermission\("payments:confirm"\);/g)).toHaveLength(1);
    expect(page.match(/<RefundTable rows=\{rows\} canApprove=\{canApprove\} phuongThuc=\{phuongThuc\} \/>/g)).toHaveLength(1);
  });

  it("[CHT-W2] bảng vẽ nút CHỈ khi canApprove VÀ dòng ĐÃ DUYỆT, và nút gọi chiHoanTienAction", () => {
    const bang = doc(`${DIR}/_components/refund-table.tsx`);
    expect(bang.match(/canApprove && r\.status === "APPROVED" \?/g)).toHaveLength(1);
    expect(bang.match(/onClick=\{\(\) => moChi\(r\)\}/g)).toHaveLength(1);
    expect(bang.match(/await chiHoanTienAction\(\{/g)).toHaveLength(1);
  });
});
