// lib/payments/trang-thai-dot.test.ts — một đợt, một câu trả lời, suy từ CẢ HAI SỔ.
//
// Số liệu là SỐ ĐO THẬT trên đơn ORD-260915-000007 ngày 15/09/2026:
//   đợt 1  2.000.000đ  sale đánh dấu tay  ⇒ OrderInstallment PAID  · PaymentRequest PENDING
//   đợt 2  2.617.000đ  khách quét QR      ⇒ OrderInstallment PENDING · PaymentRequest PAID
// Cùng một đơn, cùng một lúc, hai sổ nói ngược nhau — và màn in cả hai giọng.
import { describe, it, expect } from "vitest";
import { conXuatQr, dotSapThu, trangThaiDot } from "./trang-thai-dot";

describe("[TTD-01] SALE THU TAY — cổng chưa thấy đồng nào, vẫn là ĐÃ THU", () => {
  const dot1 = { soDot: 1, amountDue: 2_000_000, daRot: 0, keHoachDaThu: true };

  it("đúng ca đợt 1 của ORD-…007", () => {
    const r = trangThaiDot(dot1);
    expect(r.ma).toBe("DA_THU");
    expect(r.nguon).toBe("SALE_THU_TAY");
  });

  it("⚠️ conThieu = 0, KHÔNG phải 2.000.000đ", () => {
    // Đây đúng con số đã làm chủ dự án nói "hệ thống ghi nhận sai số tiền": bảng phiếu thu
    // in "còn thiếu 2.000.000đ" trên một đợt đã thu xong.
    expect(trangThaiDot(dot1).conThieu).toBe(0);
  });

  it("KHÔNG còn mời quét QR — mời nữa là mời khách trả lần hai", () => {
    expect(conXuatQr(dot1)).toBe(false);
  });

  it("nhãn nói RÕ tiền vào bằng đường nào, để kế toán đối soát được", () => {
    expect(trangThaiDot(dot1).nhan).toContain("sale thu tay");
  });
});

describe("[TTD-02] TIỀN VỀ QUA CỔNG — kế hoạch chưa đánh dấu, vẫn là ĐÃ THU", () => {
  const dot2 = { soDot: 2, amountDue: 2_617_000, daRot: 2_617_000, keHoachDaThu: false };

  it("đúng ca đợt 2 của ORD-…007", () => {
    const r = trangThaiDot(dot2);
    expect(r.ma).toBe("DA_THU");
    expect(r.nguon).toBe("CONG");
    expect(r.conThieu).toBe(0);
  });

  it("KHÔNG còn bày nút 'Đánh dấu đã đóng' nữa", () => {
    expect(conXuatQr(dot2)).toBe(false);
  });
});

describe("[TTD-03] CẢ HAI SỔ đều nói đã thu", () => {
  it("nguồn = CA_HAI", () => {
    const r = trangThaiDot({ soDot: 1, amountDue: 1_000_000, daRot: 1_000_000, keHoachDaThu: true });
    expect(r.ma).toBe("DA_THU");
    expect(r.nguon).toBe("CA_HAI");
  });
});

describe("[TTD-04] THU MỘT PHẦN", () => {
  it("tiền về thiếu ⇒ MOT_PHAN, còn thiếu đúng phần chênh, VẪN mời quét tiếp", () => {
    const dot = { soDot: 3, amountDue: 4_617_000, daRot: 1_000_000, keHoachDaThu: false };
    const r = trangThaiDot(dot);
    expect(r.ma).toBe("MOT_PHAN");
    expect(r.conThieu).toBe(3_617_000);
    expect(conXuatQr(dot)).toBe(true);
  });

  it("về thừa (khách chuyển nhiều hơn) vẫn là ĐÃ THU, conThieu 0", () => {
    const r = trangThaiDot({ soDot: 3, amountDue: 1_000_000, daRot: 1_500_000, keHoachDaThu: false });
    expect(r.ma).toBe("DA_THU");
    expect(r.conThieu).toBe(0);
  });
});

describe("[TTD-05] CHƯA THU", () => {
  it("hai sổ đều trống", () => {
    const r = trangThaiDot({ soDot: 4, amountDue: 4_617_000, daRot: 0, keHoachDaThu: false });
    expect(r.ma).toBe("CHUA_THU");
    expect(r.conThieu).toBe(4_617_000);
    expect(r.nhan).toBe("Chờ thu");
  });

  it("phiếu 0đ mà chưa ai đánh dấu ⇒ vẫn CHƯA THU, không tự nhận là xong", () => {
    // `duCong` đòi `amountDue > 0`: nếu không thì phiếu 0đ tự thành PAID và một đợt chưa
    // hề được lập kế hoạch sẽ báo đã thu.
    expect(trangThaiDot({ soDot: 5, amountDue: 0, daRot: 0, keHoachDaThu: false }).ma).toBe("CHUA_THU");
  });
});

describe("[TTD-06] ĐỢT SẮP THU — thay phép 'PaymentRequest PENDING đầu tiên'", () => {
  // Đúng hiện trạng đơn ORD-260915-000007 sau khi thu đợt 1 (tay) và đợt 2 (QR).
  const cacDot = [
    { soDot: 1, amountDue: 2_000_000, daRot: 0, keHoachDaThu: true },
    { soDot: 2, amountDue: 2_617_000, daRot: 2_617_000, keHoachDaThu: false },
    { soDot: 3, amountDue: 4_617_000, daRot: 0, keHoachDaThu: false },
    { soDot: 4, amountDue: 4_617_000, daRot: 0, keHoachDaThu: false },
  ];

  it("trả ĐỢT 3, không phải đợt 1", () => {
    // Phép cũ (`PaymentRequest` PENDING đầu tiên) trả đợt 1 — thẻ trên trang lead mời
    // "Đóng đợt 1 · 2.000.000đ" cho một đợt đã thu xong.
    const d = dotSapThu(cacDot);
    expect(d?.soDot).toBe(3);
    expect(d?.conThieu).toBe(4_617_000);
  });

  it("thứ tự đầu vào lộn xộn vẫn ra đợt 3 — sắp theo soDot, không theo mảng", () => {
    expect(dotSapThu([...cacDot].reverse())?.soDot).toBe(3);
  });

  it("thu hết ⇒ null", () => {
    expect(dotSapThu(cacDot.map((d) => ({ ...d, keHoachDaThu: true })))).toBeNull();
  });

  it("danh sách rỗng ⇒ null, không ném", () => {
    expect(dotSapThu([])).toBeNull();
  });
});

describe("[TTD-07] số xấu không làm sập màn", () => {
  it("NaN / âm quy về 0", () => {
    const r = trangThaiDot({ soDot: 1, amountDue: Number.NaN, daRot: -5, keHoachDaThu: false });
    expect(r.ma).toBe("CHUA_THU");
    expect(r.conThieu).toBe(0);
  });
});
