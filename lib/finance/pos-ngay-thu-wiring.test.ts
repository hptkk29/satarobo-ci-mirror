// lib/finance/pos-ngay-thu-wiring.test.ts — `[POS-NT-01*]`: NGÀY THU của khoản quẹt thẻ = GIỜ QUẸT.
//
// Chủ dự án chốt Q-C (29/09/2026, `docs/pos-the-smartpos.md`). Hàm thuần `ngayThuCuaGiaoDich`
// có test hành vi riêng (`lib/payments/pos/ngay-thu.test.ts`, `[POS-N01/N02]`) — nhưng test đó
// xanh vĩnh viễn dù không đường ghi nào GỌI hàm. Thứ cần khoá ở đây là "lời gọi
// `tx.payment.create` ghi `paidDate` bằng gì", nên dùng LƯỚI GHIM MÃ NGUỒN (mẫu CLAUDE.md).
//
// MÃ TRƯỚC bản vá, ở cả ba đường tiền thẻ có thể đi qua (`thuTheoPhieuGop` · gắn tay
// `ganTienTheoCon` · đường cờ tắt `allocateToOrder`): `paidDate: new Date(),` — tức khoản quẹt
// thẻ import hôm sau mang ngày IMPORT, lệch sổ ngày và báo cáo theo kỳ.
//
// ⚠️ Bóc chú thích TRƯỚC khi khớp (luật 11): chú thích giải thích bản vá chứa đúng chuỗi
// `new Date()`. Khẳng định cả SỐ LẦN khớp, không chỉ sự có mặt.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function docMa(duong: string): string {
  return readFileSync(resolve(process.cwd(), duong), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Thân một hàm: từ chỗ khai báo tới `export` kế tiếp (không tới `}` đầu dòng — xem quyen-doi-soat.test.ts). */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau === -1 ? undefined : sau);
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[POS-NT] ngày thu của khoản quẹt thẻ = giờ quẹt — dây nối", () => {
  it("[POS-NT-01] `thuTheoPhieuGop` ghi `paidDate = input.ngayThu` — tham số BẮT BUỘC", () => {
    const t = than(docMa("lib/finance/phieu-gop.ts"), "thuTheoPhieuGop");
    expect(t, "ngayThu phải là tham số BẮT BUỘC (không `?`)").toMatch(/\n\s*ngayThu: Date;/);
    expect(dem(t, /paidDate:/), "đúng một chỗ ghi paidDate").toBe(1);
    expect(dem(t, /paidDate: input\.ngayThu,/)).toBe(1);
    expect(t).not.toMatch(/paidDate: new Date\(\)/);
  });

  it("[POS-NT-01b] webhook truyền `ngayThu: new Date()` — giữ hành vi chuyển khoản", () => {
    const t = than(docMa("lib/payments/payos-ingest.ts"), "ingestPayosWebhook");
    const goi = t.slice(t.indexOf("await thuTheoPhieuGop("));
    const thanGoi = goi.slice(0, goi.indexOf("});"));
    expect(dem(thanGoi, /ngayThu: new Date\(\),/)).toBe(1);
  });

  it("[POS-NT-01c] gắn tay `ganTienTheoCon` dùng `ngayThuCuaGiaoDich` + đọc `transferredAt`", () => {
    const t = than(docMa("lib/finance/ghi-tien-don.ts"), "ganTienTheoCon");
    expect(dem(t, /paidDate:/)).toBe(1);
    expect(dem(t, /paidDate: ngayThuCuaGiaoDich\(txn, new Date\(\)\),/)).toBe(1);
    // Quên `select` cột nguồn thì `txn.transferredAt` là lỗi biên dịch — khoá thêm cho rõ.
    expect(t).toMatch(/transferredAt: true,/);
    expect(t).toMatch(/provider: true,/);
  });

  it("[POS-NT-01d] đường cờ tắt `allocateToOrder` dùng `ngayThuCuaGiaoDich`", () => {
    const t = than(docMa("lib/payments/payos-ingest.ts"), "allocateToOrder");
    expect(dem(t, /paidDate:/)).toBe(1);
    expect(dem(t, /paidDate: ngayThuCuaGiaoDich\(fresh, new Date\(\)\),/)).toBe(1);
    expect(t).toMatch(/select: \{ status: true, provider: true, transferredAt: true \}/);
  });
});
