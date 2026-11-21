// R-02 — chặn việc lưu kế hoạch đợt LÀM MẤT DẤU tiền khách đã đóng.
//
// Hai đường hại, cùng một hậu quả là ĐÒI KHÁCH TRẢ LẦN HAI:
//  (a) `materializeInstallmentRequests` VOID phiếu "thu toàn đơn" VÔ ĐIỀU KIỆN
//      (`payment-request.ts:289-294`) kể cả khi phiếu đó đã có allocation. `outstandingOf`
//      trả 0 cho phiếu VOID (`allocation.ts:43`) ⇒ tiền rơi khỏi mọi phép tính còn-thiếu,
//      trong khi phiếu đợt 1 mới sinh ở PENDING nên `_qr-core.ts:399-408` in QR đòi lại
//      đúng khoản khách vừa đóng.
//  (b) Đơn có tiền ở Ledger-A NHIỀU HƠN phần kế hoạch nhận là "đợt 1 đã thu". Phần dư đó
//      không được phiếu nào phản ánh ⇒ cũng bị đòi lại. Đây đúng hình dạng đơn prod
//      ORD-260808-000001 (3.686.000đ ở Payment, 0 PaymentAllocation — cờ
//      UNALLOCATED_PAYMENT của shadow-compare, phát ra khi `allocated < recordedPaid`).
//
// ⚠️ CÁI KHÓ CỦA CỔNG NÀY LÀ KHÔNG ĐƯỢC CHẶN LUỒNG BÌNH THƯỜNG. Sale thu tiền mặt rồi
// lưu kế hoạch với đợt 1 = đúng số đã thu là nghiệp vụ HÀNG NGÀY; một cổng gác thô theo
// "đơn có tiền thì chặn" sẽ khoá cứng màn đơn. Mọi ca dưới đây có một cặp: ca PHẢI CHẶN
// và ca PHẢI CHO QUA ngay cạnh nó.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keHoachLamMatTien, doiTienDotDaThu } from "./plan-money-guard";

const nen = { fullOrderAllocated: 0, recordedPaid: 0, allocated: 0, tienCacDotDaThu: 0 };

describe("[R02-01] phiếu 'thu toàn đơn' ĐÃ CÓ TIỀN thì không được huỷ", () => {
  it("có allocation trên phiếu toàn đơn → CHẶN", () => {
    const r = keHoachLamMatTien({ ...nen, fullOrderAllocated: 3_000_000, recordedPaid: 3_000_000, allocated: 3_000_000, tienCacDotDaThu: 3_000_000 });
    expect(r.chan).toBe(true);
    expect(r.soTien).toBe(3_000_000);
  });

  it("phiếu toàn đơn CHƯA có đồng nào → cho qua (đây là ca thường nhất)", () => {
    expect(keHoachLamMatTien({ ...nen, tienCacDotDaThu: 3_000_000 }).chan).toBe(false);
  });
});

describe("[R02-02] tiền ở Ledger-A mà kế hoạch không nhận hết → CHẶN", () => {
  it("đơn prod ORD-260808-000001: đã thu 3.686.000, kế hoạch chỉ nhận đợt 1 = 3.000.000", () => {
    // 0 allocation ⇒ cổng đo theo `fullOrderAllocated` KHÔNG bắt được ca này. Đó là lý do
    // phải có vế thứ hai: `allocated < recordedPaid`.
    const r = keHoachLamMatTien({ ...nen, recordedPaid: 3_686_000, allocated: 0, tienCacDotDaThu: 3_000_000 });
    expect(r.chan).toBe(true);
    expect(r.soTien).toBe(686_000); // phần sẽ bị đòi lại
  });

  it("LUỒNG BÌNH THƯỜNG — sale thu tiền mặt 3.000.000 rồi lưu kế hoạch đợt 1 = 3.000.000 → CHO QUA", () => {
    // Ca này là nghiệp vụ hàng ngày. Chặn nó là khoá cứng màn đơn.
    expect(keHoachLamMatTien({ ...nen, recordedPaid: 3_000_000, allocated: 0, tienCacDotDaThu: 3_000_000 }).chan).toBe(false);
  });

  it("kế hoạch nhận NHIỀU HƠN số đã thu → cho qua (khách hẹn đóng thêm, không mất gì)", () => {
    expect(keHoachLamMatTien({ ...nen, recordedPaid: 2_000_000, allocated: 0, tienCacDotDaThu: 3_000_000 }).chan).toBe(false);
  });

  it("tiền đã rót đủ vào sổ mới → cho qua (sổ mới đang giữ dấu, không mất)", () => {
    expect(keHoachLamMatTien({ ...nen, recordedPaid: 3_686_000, allocated: 3_686_000, tienCacDotDaThu: 3_000_000 }).chan).toBe(false);
  });
});

describe("[R02-03] câu từ chối phải nói được cho sale làm gì tiếp", () => {
  it("nêu SỐ TIỀN và VIỆC PHẢI LÀM, không phải chỉ 'thao tác thất bại'", () => {
    const r = keHoachLamMatTien({ ...nen, fullOrderAllocated: 3_686_000, recordedPaid: 3_686_000, allocated: 3_686_000, tienCacDotDaThu: 3_000_000 });
    expect(r.chan).toBe(true);
    expect(r.lyDo).toMatch(/3\.686\.000/);
    expect(r.lyDo).toMatch(/kế toán/i);
  });
});

describe("[R02-04] đầu vào rác không được mở cổng", () => {
  it("NaN/âm → coi như 0, không ném, không cho qua sai", () => {
    expect(keHoachLamMatTien({ ...nen, fullOrderAllocated: Number.NaN, tienCacDotDaThu: 1 }).chan).toBe(false);
    expect(keHoachLamMatTien({ ...nen, recordedPaid: Number.NaN, tienCacDotDaThu: 1 }).chan).toBe(false);
    expect(keHoachLamMatTien({ ...nen, fullOrderAllocated: -5, tienCacDotDaThu: 1 }).chan).toBe(false);
  });
});

/**
 * A6 — `amountDue` của phiếu ĐÃ CÓ TIỀN là BẤT BIẾN.
 *
 * Chốt chủ dự án: *"KHÔNG sửa `amountDue` của phiếu đã có allocation"* và 15/09/2026:
 * *"khi PH đã thanh toán thì phải khoá phần đã thu lại, chỉ cho sửa các đợt sau đó với
 * số tiền còn thiếu"* — cùng một luật, phát biểu từ hai phía.
 *
 * ⚠️ Bộ ca này phải khoá CẢ HAI CHIỀU. Chỉ có ca CHẶN thì một cổng cài quá rộng (chặn
 * mọi lượt lưu khi đơn đã có tiền) vẫn xanh — mà cổng đó khoá cứng màn đơn, tức đổi một
 * bug tiền thành một bug vận hành.
 */
describe("[A6] doiTienDotDaThu — đợt đã thu thì số tiền bất biến", () => {
  it("[A6-01] chưa rót đồng nào ⇒ CHO QUA, đổi số thoải mái", () => {
    expect(
      doiTienDotDaThu({ soDot: 2, tienHienTai: 4_000_000, tienMuonDat: 9_000_000, daRot: 0 }).chan,
    ).toBe(false);
  });

  it("[A6-02] đã rót mà số KHÔNG đổi ⇒ CHO QUA (luồng sửa đợt sau, hằng ngày)", () => {
    // Sale sửa đợt 3/4 thì payload đợt 1 giữ nguyên số ⇒ không được chặn. Đây là ca
    // quyết định cổng có dùng được hay không.
    expect(
      doiTienDotDaThu({ soDot: 1, tienHienTai: 6_000_000, tienMuonDat: 6_000_000, daRot: 6_000_000 })
        .chan,
    ).toBe(false);
  });

  it("[A6-03] đã rót ĐỦ mà đổi số ⇒ CHẶN, kèm số tiền và việc phải làm", () => {
    const v = doiTienDotDaThu({
      soDot: 1,
      tienHienTai: 6_000_000,
      tienMuonDat: 1_000_000,
      daRot: 6_000_000,
    });
    expect(v.chan).toBe(true);
    expect(v.soTien).toBe(6_000_000);
    // Câu nói phải nêu SỐ TIỀN đang bị đe doạ — người đọc cần biết mất mát cỡ nào.
    expect(v.lyDo ?? "").toContain("6.000.000");
    expect(v.lyDo ?? "").toContain("Đợt 1");
  });

  it("[A6-04] rót MỘT PHẦN cũng chặn — A6 nói \"đã có allocation\", không phải \"đã đủ\"", () => {
    // Và một đợt đang dở không phải "đợt sau" theo lời chủ dự án. Nới thành
    // "cho đổi miễn là ≥ số đã rót" là tự đặt thêm luật không ai chốt.
    expect(
      doiTienDotDaThu({ soDot: 1, tienHienTai: 6_000_000, tienMuonDat: 4_000_000, daRot: 3_000_000 })
        .chan,
    ).toBe(true);
    // Kể cả đổi LÊN.
    expect(
      doiTienDotDaThu({ soDot: 1, tienHienTai: 6_000_000, tienMuonDat: 8_000_000, daRot: 3_000_000 })
        .chan,
    ).toBe(true);
  });

  it("[A6-05] `daRot` rác KHÔNG được mở cổng cũng không được đóng oan", () => {
    // Rác ⇒ coi như chưa rót ⇒ cho qua. Fail-OPEN ở đây là đúng: nếu quy rác thành
    // "có tiền" thì một hàng allocation lỗi khoá cứng mọi lượt sửa kế hoạch của đơn.
    for (const rac of [Number.NaN, -5, 0]) {
      expect(
        doiTienDotDaThu({ soDot: 1, tienHienTai: 6_000_000, tienMuonDat: 1, daRot: rac }).chan,
      ).toBe(false);
    }
  });

  it("[A6-06] LƯỚI GHIM — cổng phải được cắm trong vòng UPSERT của materialize", () => {
    // Năm ca trên vẫn XANH nếu `doiTienDotDaThu` đúng mà KHÔNG AI GỌI nó — đúng lớp bug
    // mà mẫu LƯỚI GHIM MÃ NGUỒN sinh ra để chặn (CLAUDE.md). Và phải cắm ở
    // `materializeInstallmentRequests`, không phải ở đường gọi: một chỗ che cả ba cửa.
    const src = readFileSync(
      resolve(process.cwd(), "lib/payments/payment-request.ts"),
      "utf8",
    );
    expect(src).toMatch(/doiTienDotDaThu\(\{/);
    expect(src).toMatch(/daRot: soCuaPhieu\(allocated, cur\.id\)\.allocated,/);
    // Và phải NÉM (rollback), không phải trả cờ — xem chú thích ở lớp lỗi.
    expect(src).toMatch(/throw new InstallmentMoneyBlocked\(/);
    // Cổng phải đứng TRƯỚC dòng ghi đè, kẻo nó chạy sau khi số đã vào `patch`.
    const iCong = src.indexOf("const aSauA6 = doiTienDotDaThu({");
    const iGhi = src.indexOf("if (cur.amountDue !== dot.amount) patch.amountDue");
    expect(iCong).toBeGreaterThanOrEqual(0);
    expect(iGhi).toBeGreaterThanOrEqual(0);
    expect(iCong).toBeLessThan(iGhi);
  });
});
