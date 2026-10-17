// [SPG-*] — phiếu gộp OPEN trên đợt ĐÃ VOID (rà vòng 3). THUẦN + lưới ghim mã nguồn.
// Hành vi thật (Postgres) ở `tests/finance/pos-vong3.test.ts` `[V3-0x]`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canhBaoTruocVoidDot, nhanNutKemPhieu, quyetPhieuMo, thongDiepPhieuDaSoat } from "./soat-phieu-gop";

function ma(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
}

/** Thân một hàm `export async function <ten>(` tới hàm export kế tiếp. */
function than(nguon: string, ten: string): string {
  const i = nguon.indexOf(`export async function ${ten}(`);
  expect(i, ten).toBeGreaterThanOrEqual(0);
  const j = nguon.indexOf("\nexport ", i + 10);
  return nguon.slice(i, j < 0 ? undefined : j);
}

describe("[SPG] quyết phiếu OPEN có đợt đã huỷ", () => {
  it("[SPG-01] có đợt VOID: chưa nhận ⇒ VOID, đã nhận ⇒ CLOSED; không đợt VOID ⇒ để nguyên", () => {
    expect(quyetPhieuMo({ daNhan: 0, coDotDaHuy: true })?.dich).toBe("VOID");
    expect(quyetPhieuMo({ daNhan: 1, coDotDaHuy: true })?.dich).toBe("CLOSED");
    expect(quyetPhieuMo({ daNhan: 0, coDotDaHuy: false })).toBeNull();
    // KHÔNG tự đặt PAID cho phiếu đủ tiền từ đường khác (xem chú thích tệp — `[POS-DB-21b]`).
    expect(quyetPhieuMo({ daNhan: 6_732_000, coDotDaHuy: false })).toBeNull();
  });

  it("[SPG-02] câu báo sau soát: nêu mã + HUỶ/ĐÓNG + việc phải làm; rỗng ⇒ null (rà vòng 4, luật 12)", () => {
    expect(thongDiepPhieuDaSoat([])).toBeNull();
    expect(thongDiepPhieuDaSoat([{ ma: "K7M2N", dich: "VOID" }])).toBe(
      "Phiếu gộp K7M2N đã HUỶ — phát mã mới cho phần còn nợ, báo phụ huynh bỏ QR cũ.",
    );
    const hai = thongDiepPhieuDaSoat([
      { ma: "K7M2N", dich: "VOID" },
      { ma: "AB12C", dich: "CLOSED" },
    ]);
    expect(hai).toContain("Phiếu gộp K7M2N đã HUỶ · Phiếu gộp AB12C đã ĐÓNG");
  });

  it("[SPG-03] nói TRƯỚC khi VOID đợt: chỉ khi đợt thuộc phiếu; chưa nhận ⇒ HUỶ, đã nhận ⇒ ĐÓNG", () => {
    const phieu = { ma: "K7M2N", daNhan: 0, dong: [{ paymentRequestId: "a" }, { paymentRequestId: "b" }] };
    expect(canhBaoTruocVoidDot(null, ["a"])).toBeNull();
    expect(canhBaoTruocVoidDot(phieu, []), "thao tác không VOID đợt nào").toBeNull();
    expect(canhBaoTruocVoidDot(phieu, ["c", "d"]), "đợt không thuộc phiếu").toBeNull();
    const huy = canhBaoTruocVoidDot(phieu, ["c", "b"]);
    expect(huy?.tieuDe).toBe("Mã phiếu K7M2N của cả nhà sẽ bị HUỶ");
    expect(huy?.dich).toBe("VOID");
    expect(huy?.soDotCham, "chỉ đếm đợt NẰM TRONG phiếu").toBe(1);
    expect(huy?.chiTiet).toContain("huỷ 1/2 đợt của phiếu");
    expect(huy?.cau).toContain("báo phụ huynh bỏ QR cũ");
    const dong = canhBaoTruocVoidDot({ ...phieu, daNhan: 3_168_000 }, ["a", "b"]);
    expect(dong?.tieuDe).toBe("Mã phiếu K7M2N của cả nhà sẽ bị ĐÓNG");
    expect(dong?.chiTiet).toContain("huỷ mọi đợt của phiếu");
    expect(dong?.chiTiet).toContain("đã nhận 3.168.000đ");
  });

  it("[SPG-03b] nhãn nút KÈM hệ quả — không chạm phiếu thì nhãn giữ nguyên", () => {
    const phieu = { ma: "K7M2N", daNhan: 0, dong: [{ paymentRequestId: "a" }] };
    expect(nhanNutKemPhieu("Miễn giảm", null)).toBe("Miễn giảm");
    expect(nhanNutKemPhieu("Miễn giảm", canhBaoTruocVoidDot(phieu, ["a"]))).toBe("Miễn giảm · huỷ mã K7M2N");
    expect(nhanNutKemPhieu("Lưu", canhBaoTruocVoidDot({ ...phieu, daNhan: 1 }, ["a"]))).toBe("Lưu · đóng mã K7M2N");
  });

  it("[SPG-W4] bốn đường VOID đợt không VỨT kết quả soát — mỗi đường đưa nó vào `thongDiepPhieuDaSoat`", () => {
    const moiDuong: [string, string][] = [
      ["lib/finance/ghi-tien-don.ts", "thongDiepPhieuDaSoat(phieuDaSoat)"],
      // Q-L (30/09/2026): miễn giảm soát ở ba bước (VOID phiếu cấp đơn · `materialize` · recompute cuối)
      // và GOM cả ba vào `phieuDaSoat` — lưới `[V6-W2]` đếm đủ ba lần `push`.
      ["lib/finance/mien-giam-db.ts", "thongDiepPhieuDaSoat(phieuDaSoat)"],
      ["lib/finance/them-con-vao-don.ts", "thongDiepPhieuDaSoat(phieuGopDaSoat)"],
      ["lib/orders/installments.ts", "thongDiepPhieuDaSoat(phieuDaSoat)"],
    ];
    for (const [tep, loiGoi] of moiDuong) {
      expect(ma(tep).split(loiGoi).length - 1, tep).toBe(1);
    }
    // Rà vòng 4 — nút duyệt/từ chối đơn: CẢ HAI đường (`approveOrder`, `rejectOrder`) nhận kết quả
    // soát từ `applyInstallment*` rồi đưa vào câu báo — thiếu một đường là lỗi câm quay lại.
    const duyet = ma("lib/orders/approval.ts");
    expect(duyet.split("thongDiepPhieuDaSoat(phieuDaSoat)").length - 1, "approval.ts").toBe(2);
    expect(than(duyet, "approveOrder")).toMatch(/phieuDaSoat = await applyInstallmentApproval\(/);
    expect(than(duyet, "rejectOrder")).toMatch(/phieuDaSoat = await applyInstallmentRejection\(/);
    const kh = ma("lib/orders/installments.ts");
    expect(than(kh, "applyInstallmentApproval")).toMatch(
      /return \(await materializeInstallmentRequests\([^)]*\)\)\s*\.phieuGopDaSoat;/,
    );
    expect(than(kh, "applyInstallmentRejection")).toMatch(
      /return \(await revertInstallmentRequests\([^)]*\)\)\s*\.phieuGopDaSoat;/,
    );
    // Action chuyển tiếp — cắt ở đây thì lib nói mà màn không nghe.
    expect(
      ma("app/(admin)/admin/orders/duyet/_actions.ts").split("thongDiepPhieu: res.thongDiepPhieu ?? null").length - 1,
      "duyet/_actions.ts",
    ).toBe(2);
    // Và màn hình đọc nó (toast) — thiếu một chỗ là lỗi câm quay lại.
    const ui: [string, number][] = [
      ["app/(admin)/admin/orders/_components/cong-no-theo-con.tsx", 2],
      ["app/(admin)/admin/orders/_components/them-con-dialog.tsx", 1],
      ["app/(admin)/admin/orders/_components/order-payment-section.tsx", 1],
      ["app/(admin)/admin/orders/duyet/_components/order-approval-buttons.tsx", 2],
    ];
    for (const [tep, n] of ui) {
      expect(ma(tep).match(/toast\.warning\(r(?:es)?\.thongDiepPhieu/g)?.length ?? 0, tep).toBe(n);
    }
  });

  it("[SPG-W5] ba màn NÓI TRƯỚC: đợt sẽ VOID tính bằng đúng hàm đường ghi dùng, câu chữ qua MỘT hàm chung", () => {
    const cn = ma("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    // Miễn giảm: phiếu sẽ VOID lấy từ `keHoachMienGiam` — CHÍNH hàm `mienGiamNoChoCon` chạy (đợt theo con
    // của bé, hoặc phiếu CẤP ĐƠN dựng lại theo Q-L), với chính sách của cơ sở — không đoán.
    // ĐỔI CÁCH VIẾT 30/09/2026 (Q-L): bản vòng 4 ghim `keHoachHapThu({ dot: con.dotDangMo … }).doi.map(`
    // — lý lẽ giữ nguyên ("nói trước bằng đúng hàm đường ghi dùng"), chỉ hàm đổi.
    expect(cn.match(/canhBaoTruocVoidDot\(phieu, dotSeHuyKhiMienGiam\(keHoach\)\)/g)?.length ?? 0, "FormMienGiam").toBe(1);
    expect(cn).toMatch(
      /keHoachMienGiam\(\{ orderItemId: con\.orderItemId, phieuThu, keHoachDon, canGiam: soTien, cach: hapThu, daDungHoc, conNoDon, tongDon \}\)/,
    );
    expect(cn).toContain('nhanNutKemPhieu("Miễn giảm", canhBaoPhieu)');
    expect(cn.match(/<FormMienGiam[\s\S]*?phieu=\{phieu\}[\s\S]*?hapThu=\{hapThu\}/g)?.length ?? 0).toBe(1);
    // Huỷ đợt: cùng hàm, một đợt.
    expect(cn).toContain("canhBaoTruocVoidDot(phieu, [d.id])?.cau ?? null");

    const tc = ma("app/(admin)/admin/orders/_components/them-con-dialog.tsx");
    // Thêm con: danh sách đợt đổi do MÁY CHỦ tính trong bản xem trước.
    expect(tc).toContain("canhBaoTruocVoidDot(phieu, xem.con.flatMap((c) => c.doiDot.map((d) => d.id)))");
    expect(tc).toContain('nhanNutKemPhieu("Xác nhận thêm con", canhBaoPhieu)');
    expect(tc).toMatch(/<HopThoai[^>]*phieu=\{phieu\}/);

    const kh = ma("app/(admin)/admin/orders/_components/order-payment-section.tsx");
    // Lưu kế hoạch: CÙNG hàm `materializeInstallmentRequests` dùng (`[PSH-W1]`).
    // Rà vòng 5: thêm danh sách đợt ĐỔI SỐ (cùng hàm `materialize` dùng) và lời báo "chắc chắn bị
    // chặn" thay cho lời hứa "đóng mã" (`chanTruocKhiLuuKeHoach`, `[PSH-10..12]`).
    expect(kh).toContain("const cham = phieuSeChamKhiLuuKeHoach({ phieu: paymentRequests, dots });");
    expect(kh).toMatch(/const canhBaoPhieu = chanLuu \? null : canhBaoTruocVoidDot\(phieuGop, cham\.seHuy, cham\.doiSo\);/);
    expect(kh).toMatch(/nhanNutKemPhieu\(\s*`Lưu kế hoạch/);

    // Cả ba màn VẼ ô nói trước — tính mà không vẽ là lời hứa suông.
    for (const t of [cn, tc, kh]) expect(t.match(/<CanhBaoPhieuTruoc canhBao=\{canhBaoPhieu\} \/>/g)?.length ?? 0).toBe(1);
    // Không màn nào tự dựng luật HUỶ/ĐÓNG (nhân bản điều kiện là hai giọng ở lần sửa đầu tiên).
    for (const t of [cn, tc, kh]) expect(t).not.toMatch(/quyetPhieuMo|daNhan > 0/);

    // Dây nối từ trang — quên truyền là lỗi CÂM (luật 11): prop bắt buộc để `tsc` bắt, lưới này
    // bắt người gỡ "bắt buộc".
    const trang = ma("app/(admin)/admin/orders/[id]/page.tsx");
    expect(trang).toMatch(/<NutThemCon[^>]*phieu=\{phieuGop\}/);
    expect(trang).toContain("hapThu={hapThu}");
    expect(trang).toContain("docChinhSachUuDai(order.orgUnitId).then((cs) => cs.hapThu)");
    expect(
      ma("app/(admin)/admin/orders/_components/order-detail-client.tsx").match(/phieuGop=\{phieuGop\}/g)?.length ?? 0,
      "OrderDetailClient truyền phiếu cho CẢ bảng phiếu thu lẫn khối kế hoạch",
    ).toBe(2);
  });

  it("[SPG-W1] `recomputeRequestStatuses` gọi `soatPhieuGopMoTrongTx` đúng MỘT lần — năm đường VOID đợt đi qua đó", () => {
    const t = than(ma("lib/payments/payment-request.ts"), "recomputeRequestStatuses");
    expect(t.match(/\bsoatPhieuGopMoTrongTx\(tx, orderId\)/g)?.length ?? 0).toBe(1);
  });

  it("[SPG-W2] `huyDotChoCon` (không qua recompute) gọi `soatPhieuGopMoTrongTx` SAU khi VOID đợt", () => {
    const t = than(ma("lib/finance/ghi-tien-don.ts"), "huyDotChoCon");
    const iVoid = t.indexOf('data: { status: "VOID" }');
    const iSoat = t.indexOf("soatPhieuGopMoTrongTx(tx, input.orderId)");
    expect(iVoid).toBeGreaterThan(0);
    expect(iSoat, "phải gọi SAU phép VOID").toBeGreaterThan(iVoid);
  });

  it("[SPG-W3] `thuTheoPhieuGop` có cổng đợt VOID TRƯỚC phép ghi phân bổ", () => {
    const t = than(ma("lib/finance/phieu-gop.ts"), "thuTheoPhieuGop");
    const iCong = t.indexOf('l.paymentRequest.status === "VOID"');
    const iGhi = t.indexOf("tx.paymentAllocation.createMany(");
    expect(iCong).toBeGreaterThan(0);
    expect(iGhi).toBeGreaterThan(iCong);
  });
});
