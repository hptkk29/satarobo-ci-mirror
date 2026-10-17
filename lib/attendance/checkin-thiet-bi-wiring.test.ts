// lib/attendance/checkin-thiet-bi-wiring.test.ts — LƯỚI GHIM DÂY NỐI P2.3 trong `checkin-action.ts`.
//
// Action chạm phiên + cookie + vé nên test hành vi phải dựng cả chuỗi; luật cần khoá ở đây có dạng "lời gọi
// này phải đứng đúng chỗ" — đúng mẫu lưới ghim mã nguồn (CLAUDE.md). Ghim:
//   1. khối thiết bị chạy SAU khi tiêu vé và TRƯỚC `recordTimeLog`;
//   2. chế độ OFF không đụng cookie / DB (lời gọi nằm trong `if (cauHinhTB.cheDo !== "OFF")`);
//   3. bị chặn ⇒ ghi lượt REJECTED + HOÀN VÉ (không để vé chết như bẫy 16/09);
//   4. cờ của thiết bị đi vào `recordTimeLog({ … coThem … })`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "lib/attendance/checkin-action.ts"), "utf8")
  .split(/\r?\n/)
  .filter((d) => !/^\s*\/\//.test(d))
  .join("\n");

describe("[TB-W] dây nối thiết bị trong recordCheckin", () => {
  it("[TB-W1] kiểm thiết bị đúng MỘT lần, nằm trong nhánh chế độ ≠ OFF", () => {
    expect(src.match(/kiemThietBiKhiCham\(/g)).toHaveLength(1);
    const i = src.indexOf('if (cauHinhTB.cheDo !== "OFF") {');
    const j = src.indexOf("kiemThietBiKhiCham(");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(src.indexOf("jar.set(COOKIE_THIET_BI")).toBeGreaterThan(i);
  });

  it("[TB-W2] thứ tự: tiêu vé → kiểm thiết bị → ghi lượt", () => {
    const tieuVe = src.indexOf("await consumeTicket(");
    const kiem = src.indexOf("kiemThietBiKhiCham(");
    const ghi = src.indexOf("await recordTimeLog(");
    expect(tieuVe).toBeGreaterThan(-1);
    expect(kiem).toBeGreaterThan(tieuVe);
    expect(ghi).toBeGreaterThan(kiem);
  });

  it("[TB-W3] bị chặn ⇒ ghi REJECTED 'DEVICE_BLOCKED' rồi HOÀN VÉ, trước khi trả lỗi", () => {
    const chan = src.indexOf("if (!tb.quyetDinh.cho) {");
    expect(chan).toBeGreaterThan(-1);
    const khoi = src.slice(chan, src.indexOf("}", src.indexOf("return { ok: false, error: tb.quyetDinh.loi", chan)));
    expect(khoi).toMatch(/recordRejectedLog\(\{[^}]*reason: "DEVICE_BLOCKED"/);
    expect(khoi).toMatch(/await hoanVe\(d\.ticketId\)/);
  });

  it("[TB-W4] cờ thiết bị đi vào recordTimeLog qua coThem", () => {
    const ghi = src.indexOf("await recordTimeLog(");
    const den = src.indexOf("});", ghi);
    expect(src.slice(ghi, den)).toMatch(/\bcoThem,/);
  });

  it("[IP-W1] P2.4 — recordTimeLog nhận IP TIN CẬY (ipNguonTinCay, fail-closed), KHÔNG phải khoá rate-limit", () => {
    const ghi = src.indexOf("await recordTimeLog(");
    const den = src.indexOf("});", ghi);
    expect(src.slice(ghi, den)).toMatch(/ipTinCay:\s*ipNguonTinCay\(h\)/);
    expect(src.match(/ipNguonTinCay\(/g)).toHaveLength(1);
  });
});
