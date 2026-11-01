// lib/finance/payment-markers.test.ts — NHÓM 1: DS-03 + R-01 gộp.
//
// Hai lỗi, MỘT gốc: quyền sở hữu một dòng `Payment` tự động được quyết định bằng phép
// so chuỗi `note` rải ở 3 nơi độc lập, không có sổ đăng ký chung.
//
//  · DS-03 — `lib/orders/installments.ts:102` xoá mềm theo `note contains "[auto:"`,
//    mà `payos-ingest.ts:1037-1052` ghi TIỀN THẬT TỪ NGÂN HÀNG với `[auto:<provider>:<txn>]`
//    ⇒ lưu lại kế hoạch là xoá mềm dòng ledger duy nhất của khoản khách đã chuyển.
//
//  · R-01 — `[backfill-import]` (`lib/crm/backfill-order.ts:14`) nằm NGOÀI cả điều kiện
//    xoá mềm lẫn idempotency của `ensureOrderPaymentRecorded` (`payment.ts:82-86`)
//    ⇒ lưu kế hoạch trên đơn backfill sinh thêm một khoản bằng đúng số khách đã đóng.
//
// ⚠️ VÌ SAO PHẢI VÁ CÙNG LƯỢT: thu hẹp xoá mềm (vá DS-03) làm khoản cổng SỐNG SÓT, và
// khoản sống sót đó rơi thẳng vào đúng cái bẫy của R-01 — bước ghi đợt 1 sau đó cộng
// thêm một lần nữa. Vá DS-03 một mình là ĐỔI "mất tiền" thành "cộng đôi tiền".
// Vì thế nhóm này có hai vế: (1) thu hẹp điều kiện xoá mềm, (2) ghi PHẦN CHÊNH.

import { describe, it, expect } from "vitest";
import {
  AUTO_ORDER_CONFIRM_MARKER,
  BACKFILL_PAYMENT_MARKER,
  installmentMarker,
  gatewayMarker,
  isPlanOwnedNote,
  isGatewayNote,
  planOwnedNoteOr,
  phanConPhaiGhi,
  dauDongSheet,
} from "./payment-markers";

describe("[MK-01] sổ đăng ký marker — ba HỌ, không trộn", () => {
  it("marker của KẾ HOẠCH ĐỢT: chỉ 'xác nhận đơn' và 'đợt N'", () => {
    expect(AUTO_ORDER_CONFIRM_MARKER).toBe("[auto:order-confirm]");
    expect(installmentMarker(1)).toBe("[auto:order-installment:dot1]");
    expect(installmentMarker(2)).toBe("[auto:order-installment:dot2]");
    // PHA 3 bỏ trần 2 đợt — sổ đăng ký phải sinh được đợt n, không cứng 1|2.
    expect(installmentMarker(7)).toBe("[auto:order-installment:dot7]");
  });

  it("marker của CỔNG THANH TOÁN dựng đúng như payos-ingest.ts:1038", () => {
    expect(gatewayMarker("SEPAY", "TX123")).toBe("[auto:sepay:TX123]");
    expect(gatewayMarker("PAYOS", "TX123")).toBe("[auto:payos:TX123]");
  });

  it("marker NHẬP LỊCH SỬ giữ nguyên chuỗi cũ", () => {
    // Đổi chuỗi này là làm mù `backfill-order.ts:55` (chống nhập trùng) và vỡ
    // `tests/e2e/r7/bulk-convert.spec.ts:135,194,272`. Giá trị phải y nguyên.
    expect(BACKFILL_PAYMENT_MARKER).toBe("[backfill-import]");
  });
});

describe("[MK-02] isPlanOwnedNote — 'khoản này có phải do KẾ HOẠCH ĐỢT tự sinh không'", () => {
  it("nhận đúng khoản của kế hoạch", () => {
    expect(isPlanOwnedNote(`Ghi nhận tự động đợt 1 ${installmentMarker(1)}`)).toBe(true);
    expect(isPlanOwnedNote(`Ghi nhận tự động đợt 2 ${installmentMarker(2)}`)).toBe(true);
    expect(isPlanOwnedNote(`Ghi nhận tự động (xác nhận đơn) ${AUTO_ORDER_CONFIRM_MARKER}`)).toBe(true);
  });

  it("KHÔNG nhận tiền thật từ cổng — đây là vế DS-03", () => {
    // Trước bản vá, cả hai dòng này khớp `contains "[auto:"` và bị xoá mềm.
    expect(isPlanOwnedNote(`Tiền về qua SEPAY TX9 ${gatewayMarker("SEPAY", "TX9")}`)).toBe(false);
    expect(isPlanOwnedNote(`Tiền về qua PAYOS TX9 ${gatewayMarker("PAYOS", "TX9")}`)).toBe(false);
  });

  it("KHÔNG nhận khoản nhập lịch sử và khoản kế toán gõ tay", () => {
    expect(isPlanOwnedNote(`Thu học phí đợt 1 ${BACKFILL_PAYMENT_MARKER}`)).toBe(false);
    expect(isPlanOwnedNote("CK Vietcombank 05/09 chị Hằng")).toBe(false);
    expect(isPlanOwnedNote(null)).toBe(false);
    expect(isPlanOwnedNote(undefined)).toBe(false);
    expect(isPlanOwnedNote("")).toBe(false);
  });

  it("KHÔNG bị lừa bởi ghi chú người dùng tự gõ chứa chuỗi giống marker", () => {
    // Kế toán gõ tay có thể chép nhầm cả marker vào ghi chú. Khoản đó vẫn là khoản
    // THẬT của họ; xoá mềm nó là mất tiền. Nhưng phân biệt được bằng chuỗi thì không
    // đủ — đó là lý do bản vá CÒN gác thêm enrollmentId/accountantStatus/receipts.
    // Test này chỉ ghim: hàm thuần chỉ trả lời về CHUỖI, không phải về quyền sở hữu.
    expect(isPlanOwnedNote(`khách bảo giống ${installmentMarker(1)}`)).toBe(true);
  });
});

describe("[MK-03] isGatewayNote — nhận diện tiền thật từ ngân hàng", () => {
  it("nhận mọi provider, không cứng danh sách", () => {
    expect(isGatewayNote(gatewayMarker("SEPAY", "TX1"))).toBe(true);
    expect(isGatewayNote(gatewayMarker("PAYOS", "TX1"))).toBe(true);
    // Cổng mới thêm sau này cũng phải nhận ra mà không sửa hàm.
    expect(isGatewayNote(gatewayMarker("VNPAY", "TX1"))).toBe(true);
  });

  it("KHÔNG nhầm khoản của kế hoạch thành tiền cổng", () => {
    expect(isGatewayNote(installmentMarker(1))).toBe(false);
    expect(isGatewayNote(AUTO_ORDER_CONFIRM_MARKER)).toBe(false);
    expect(isGatewayNote(BACKFILL_PAYMENT_MARKER)).toBe(false);
    expect(isGatewayNote(null)).toBe(false);
  });

  it("hai họ LOẠI TRỪ NHAU — không chuỗi nào thuộc cả hai", () => {
    const mau = [
      installmentMarker(1),
      installmentMarker(2),
      AUTO_ORDER_CONFIRM_MARKER,
      gatewayMarker("SEPAY", "TX1"),
      gatewayMarker("PAYOS", "TX2"),
      BACKFILL_PAYMENT_MARKER,
    ];
    for (const note of mau) {
      expect(isPlanOwnedNote(note) && isGatewayNote(note), `chuỗi ${note}`).toBe(false);
    }
  });
});

describe("[MK-04] planOwnedNoteOr — điều kiện Prisma cho đường xoá mềm", () => {
  it("liệt kê TƯỜNG MINH từng marker, không dùng tiền tố '[auto:'", () => {
    const or = planOwnedNoteOr([1, 2]);
    const chuoi = or.map((o) => o.note.contains);
    expect(chuoi).toContain(AUTO_ORDER_CONFIRM_MARKER);
    expect(chuoi).toContain(installmentMarker(1));
    expect(chuoi).toContain(installmentMarker(2));
    // Đây là vế quyết định của DS-03: không được có mảnh nào khớp tiền cổng.
    expect(chuoi).not.toContain("[auto:");
    for (const c of chuoi) {
      expect(isGatewayNote(`x ${c} y`), `mảnh ${c} không được trúng tiền cổng`).toBe(false);
    }
  });

  it("theo đúng số đợt truyền vào — PHA 3 thêm đợt không phải sửa hàm", () => {
    expect(planOwnedNoteOr([1, 2, 3]).map((o) => o.note.contains)).toContain(installmentMarker(3));
    expect(planOwnedNoteOr([1]).map((o) => o.note.contains)).not.toContain(installmentMarker(2));
  });
});

describe("[MK-05] phanConPhaiGhi — vế R-01: ghi PHẦN CHÊNH, không ghi lại từ đầu", () => {
  // Trước bản vá, `recordInstallmentPlan` giữ bất biến "Ledger-A của đơn = dot1Amount"
  // bằng cách XOÁ SẠCH rồi ghi lại. Sau khi thu hẹp xoá mềm, cách đó không còn đúng:
  // khoản cổng và khoản backfill SỐNG SÓT, nên ghi lại nguyên `dot1Amount` là cộng đôi.
  // Giữ đúng bất biến cũ bằng cách ghi phần còn thiếu.

  it("chưa có gì trong sổ → ghi đủ số đợt 1", () => {
    expect(phanConPhaiGhi(3_000_000, 0)).toBe(3_000_000);
  });

  it("sổ đã có khoản backfill đúng bằng đợt 1 → KHÔNG ghi thêm (đây là R-01)", () => {
    expect(phanConPhaiGhi(3_000_000, 3_000_000)).toBe(0);
  });

  it("sổ đã có tiền cổng một phần → chỉ ghi phần còn thiếu (đây là DS-03 sau khi vá)", () => {
    expect(phanConPhaiGhi(3_000_000, 1_200_000)).toBe(1_800_000);
  });

  it("sổ đã có NHIỀU HƠN đợt 1 → không ghi, và KHÔNG ghi số âm", () => {
    // Khách chuyển dư, hoặc đợt 1 bị sửa xuống. Tiền thật vẫn nằm đó — không được
    // đẻ bút toán âm để "cho khớp", vì đó là sửa sổ chứ không phải ghi nhận.
    expect(phanConPhaiGhi(3_000_000, 5_000_000)).toBe(0);
  });

  it("đợt 1 bằng 0 (đóng đủ một lần) → không ghi gì", () => {
    expect(phanConPhaiGhi(0, 0)).toBe(0);
    expect(phanConPhaiGhi(0, 2_000_000)).toBe(0);
  });

  it("làm tròn về số nguyên đồng, không để lẻ trôi vào sổ", () => {
    expect(phanConPhaiGhi(3_000_000.4, 0)).toBe(3_000_000);
    expect(Number.isInteger(phanConPhaiGhi(1_000_000.6, 333_333.3))).toBe(true);
  });

  it("đầu vào rác → 0, không ném (đường tiền không được chết vì một số NaN)", () => {
    expect(phanConPhaiGhi(Number.NaN, 0)).toBe(0);
    expect(phanConPhaiGhi(3_000_000, Number.NaN)).toBe(3_000_000);
    expect(phanConPhaiGhi(-1, 0)).toBe(0);
  });
});

describe("[MK-05] dấu định danh dòng sheet — chống nhập đôi", () => {
  it("sinh dấu gọn, chỉ chữ và số", () => {
    expect(dauDongSheet("Tháng 82026 CS1", 12)).toBe("[sheet:Thang82026CS1#12]");
  });

  it("hai dòng khác nhau ra hai dấu khác nhau", () => {
    expect(dauDongSheet("Tháng 82026 CS1", 12)).not.toBe(dauDongSheet("Tháng 82026 CS1", 13));
  });

  it("hai sheet khác nhau ra hai dấu khác nhau", () => {
    expect(dauDongSheet("Tháng 82026 CS1", 12)).not.toBe(dauDongSheet("Tháng 82026 CS2", 12));
  });

  it("KHÔNG phá dấu [backfill-import] mà mọi câu tra đang dựa vào", () => {
    // Viết thành `[backfill-import:...]` là nút xác nhận hàng loạt ở /payments không
    // thấy khoản nào nữa, và không có lỗi nào báo ra.
    const note = `Nhập liệu ban đầu ${BACKFILL_PAYMENT_MARKER} ${dauDongSheet("Tháng 82026 CS1", 12)}`;
    expect(note.includes(BACKFILL_PAYMENT_MARKER)).toBe(true);
  });

  it("dấu KHÔNG bị coi là khoản của kế hoạch đợt hay của cổng thanh toán", () => {
    const note = `x ${BACKFILL_PAYMENT_MARKER} ${dauDongSheet("Tháng 82026 CS1", 12)}`;
    expect(isPlanOwnedNote(note)).toBe(false);
    expect(isGatewayNote(note)).toBe(false);
  });

  it("dấu dòng 1 KHÔNG khớp lem vào dòng 12 (contains là phép khớp con chuỗi)", () => {
    const note = `x ${dauDongSheet("Tháng 82026 CS1", 12)}`;
    expect(note.includes(dauDongSheet("Tháng 82026 CS1", 1))).toBe(false);
  });
});
