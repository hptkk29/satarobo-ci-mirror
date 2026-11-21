// lib/finance/doi-soat-thu-tien-wiring.test.ts — `[DNT-W*]` lưới GHIM MÃ NGUỒN cho các sửa của đợt đối soát T9–T10/2026.
//
// Dùng lưới ghim mã (mẫu CLAUDE.md) vì thứ cần khoá là "lời gọi này truyền tham số kia" — test thuần của hàm không chạm tới được
// việc `ghi-tien-don.ts` / `payos-ingest.ts` có GỌI nó đúng chỗ hay không. Hành vi thật được phủ ở `tests/finance/doi-soat-ngay-thu-db.test.ts`.
//
// ⚠️ Bóc chú thích TRƯỚC khi khớp (luật 11): chú thích giải thích bản vá chứa đúng chuỗi đang canh. Đếm SỐ LẦN khớp.
// ⚠️ Mỗi ca ở đây đã được CẤY LẠI lỗi gốc và thấy ĐỎ (luật 14) — xem docs/doi-soat-thu-tien/THIET-KE-SUA-GOC.md §9.
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

/** Thân một hàm: từ chỗ khai báo tới `export` kế tiếp. */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau === -1 ? undefined : sau);
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

const GHI_TIEN = () => docMa("lib/finance/ghi-tien-don.ts");
const INGEST = () => docMa("lib/payments/payos-ingest.ts");

describe("[DNT-W] bút toán ĐẢO kế thừa ngày thu của dòng gốc", () => {
  it("[DNT-W1] gỡ gắn: dòng ADJUSTMENT mang `paidDate: g.paidDate` — không phải lúc bấm gỡ", () => {
    const t = than(GHI_TIEN(), "goGanTheoCon");
    // Chỉ MỘT chỗ ghi `paidDate` trong cả hàm: bút toán đảo.
    expect(dem(t, /paidDate:/), "đúng một chỗ ghi paidDate").toBe(2); // 1 ở select (true) + 1 ở create
    expect(dem(t, /paidDate: g\.paidDate,/)).toBe(1);
    expect(dem(t, /paidDate: true,/), "select phải đọc paidDate của dòng gốc").toBe(1);
    expect(t).not.toMatch(/paidDate: new Date\(\)/);
  });

  it("[DNT-W2] tách khoản: cả bút toán ĐẢO lẫn các dòng + mang `paidDate: khoan.paidDate`", () => {
    const t = than(GHI_TIEN(), "tachKhoanChoCon");
    expect(dem(t, /paidDate: khoan\.paidDate,/), "đảo + các phần = 2").toBe(2);
    expect(t).not.toMatch(/paidDate: new Date\(\)/);
  });
});

describe("[DNT-W] gắn tay lấy giờ NGÂN HÀNG", () => {
  it("[DNT-W3] `ganTienTheoCon` ghi `paidDate` qua `ngayThuCuaGiaoDich` và đọc `createdAt` để vá dòng lệch +7h", () => {
    const t = than(GHI_TIEN(), "ganTienTheoCon");
    expect(dem(t, /paidDate: ngayThuCuaGiaoDich\(txn, new Date\(\)\),/)).toBe(1);
    expect(t).toMatch(/createdAt: true,/);
  });

  it("[DNT-W4] `parseTransferredAt` đi qua `parseGioNganHang`, KHÔNG còn `new Date(chuỗi)` phụ thuộc múi giờ máy", () => {
    const t = INGEST();
    const dau = t.indexOf("function parseTransferredAt(");
    expect(dau).toBeGreaterThan(-1);
    const hamThan = t.slice(dau, t.indexOf("\n}", dau) + 2);
    expect(hamThan).toMatch(/parseGioNganHang\(raw\)/);
    expect(hamThan).not.toMatch(/new Date\(raw/);
    expect(hamThan).not.toMatch(/new Date\(\w+\.trim\(\)\)/);
  });

  it("[DNT-W5] đường phiếu gộp truyền ngày thu = giờ ngân hàng (`ngayThuCuaGiaoDich(txn, …)`), không phải lúc xử lý", () => {
    const t = than(INGEST(), "ingestPayosWebhook");
    const goi = t.slice(t.indexOf("await thuTheoPhieuGop("));
    const thanGoi = goi.slice(0, goi.indexOf("});"));
    expect(dem(thanGoi, /ngayThu: ngayThuCuaGiaoDich\(txn, new Date\(\)\),/)).toBe(1);
  });
});

describe("[DNT-W] chống trùng khoản ghi tay ↔ webhook", () => {
  it("[DNT-W6] ingest tra marker `[ma-gd:…]` TRƯỚC mọi đường đối khớp (phiếu gộp · mã · VA · SĐT)", () => {
    const t = than(INGEST(), "ingestPayosWebhook");
    const iKiem = t.indexOf("maGiaoDichMarker(maChuan)");
    const iGop = t.indexOf("await thuTheoPhieuGop(");
    expect(iKiem, "phải có phép tra marker").toBeGreaterThan(-1);
    expect(iGop).toBeGreaterThan(-1);
    expect(iKiem, "phép tra marker phải đứng TRƯỚC thuTheoPhieuGop").toBeLessThan(iGop);
    // Thấy marker ⇒ UNMATCHED + lý do, không rót.
    const khoi = t.slice(iKiem, iGop);
    expect(khoi).toMatch(/status: "UNMATCHED"/);
    expect(khoi).toMatch(/TIEN_TO_TRUNG_GHI_TAY/);
    expect(khoi).not.toMatch(/paymentAllocation|payment\.create/);
  });

  it("[DNT-W7] `recordPayment` khoá đơn rồi mới kiểm trùng, và mọi cổng đứng TRƯỚC `tx.payment.create` đầu tiên", () => {
    const t = docMa("lib/finance/payment.ts");
    const dau = t.indexOf("async function ghiNhanKhoanTrongTx(");
    expect(dau).toBeGreaterThan(-1);
    const hamThan = t.slice(dau, t.indexOf("// ─── AC2/AC8", dau));
    const iKhoa = hamThan.indexOf("pg_advisory_xact_lock");
    const iTrung = hamThan.indexOf("LoiGhiNhanTrung(");
    const iGhi = hamThan.indexOf("tx.payment.create(");
    expect(iKhoa).toBeGreaterThan(-1);
    expect(iTrung).toBeGreaterThan(iKhoa);
    expect(iGhi).toBeGreaterThan(iTrung);
    // Có tra cả hai nguồn: khoản ghi tay mang marker VÀ giao dịch ngân hàng đã có trong hệ thống.
    expect(hamThan).toMatch(/maGiaoDichMarker\(ma\)/);
    expect(hamThan).toMatch(/bankTransaction\.findFirst\(\{ where: \{ providerTxnId: ma \}/);
  });

  it("[DNT-W8] `recordPaymentAction` chuyển mã giao dịch + bật cổng trùng cùng số tiền/ngày (trừ khi người ghi xác nhận)", () => {
    const t = docMa("app/(admin)/admin/payments/_actions.ts");
    const dau = t.indexOf("export async function recordPaymentAction(");
    const hamThan = t.slice(dau, t.indexOf("// ─── Helper: load Payment by id", dau));
    expect(dem(hamThan, /maGiaoDichNganHang: maKhai\.loai === "HOP_LE" \? maKhai\.ma : null,/)).toBe(1);
    expect(dem(hamThan, /chanTrungCungSoTienNgay: !data\.khongPhaiKhoanTrung,/)).toBe(1);
    expect(hamThan).toMatch(/SAI_DINH_DANG/);
  });
});

describe("[DNT-W] bất biến dòng đơn ↔ ghi danh đứng TRƯỚC phép ghi đầu tiên", () => {
  it("[DNT-W9] gắn tay: cổng chéo học viên đứng trước `paymentAllocation.create`", () => {
    const t = than(GHI_TIEN(), "ganTienTheoCon");
    const iCong = t.indexOf("dongDangCheoGhiDanh(");
    const iGhi = t.indexOf("tx.paymentAllocation.create(");
    expect(iCong).toBeGreaterThan(-1);
    expect(iGhi).toBeGreaterThan(iCong);
    expect(t.slice(iCong, iGhi)).toMatch(/CAU_CHEO_HOC_VIEN/);
  });

  it("[DNT-W10] tách khoản: cổng chéo học viên đứng trước `tx.payment.create` đầu tiên", () => {
    const t = than(GHI_TIEN(), "tachKhoanChoCon");
    const iCong = t.indexOf("dongDangCheoGhiDanh(");
    const iGhi = t.indexOf("tx.payment.create(");
    expect(iCong).toBeGreaterThan(-1);
    expect(iGhi).toBeGreaterThan(iCong);
    expect(t.slice(iCong, iGhi)).toMatch(/CAU_CHEO_HOC_VIEN/);
  });
});
