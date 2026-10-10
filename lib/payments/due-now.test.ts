// Số phải thu NGAY quyết định CẢ số tiền in trên QR LẪN ngưỡng đối khớp của
// webhook SePay. Sai ở đây = khách trả đúng vẫn bị xếp "trả thiếu → xử lý tay",
// tức luồng tự xác nhận coi như không tồn tại với người đóng 2 đợt.
import { describe, it, expect } from "vitest";
import { computeDueNow } from "./due-now";

const noPlan = { installments: [] };

describe("computeDueNow — đơn KHÔNG chia đợt", () => {
  it("chưa thu gì → thu toàn bộ đơn", () => {
    expect(computeDueNow({ totalAmount: 5_000_000, paidAmount: 0, ...noPlan })).toEqual({
      amount: 5_000_000,
      label: "Toàn bộ đơn",
      soDot: null,
    });
  });

  it("đã thu một phần → chỉ còn phần thiếu", () => {
    expect(computeDueNow({ totalAmount: 5_000_000, paidAmount: 2_000_000, ...noPlan })).toEqual({
      amount: 3_000_000,
      label: "Còn thiếu",
      soDot: null,
    });
  });

  it("đã thu đủ/thừa → 0đ, không âm", () => {
    expect(computeDueNow({ totalAmount: 5_000_000, paidAmount: 6_000_000, ...noPlan }).amount).toBe(0);
  });
});

describe("computeDueNow — đơn CHIA 2 ĐỢT (ca gãy trước bản vá)", () => {
  const plan = [
    { soDot: 1, amount: 3_000_000, status: "PENDING" },
    { soDot: 2, amount: 2_000_000, status: "PENDING" },
  ];

  it("chưa đóng đợt nào → QR thu ĐỢT 1, không phải tổng đơn", () => {
    expect(
      computeDueNow({ totalAmount: 5_000_000, paidAmount: 0, installments: plan }),
    ).toEqual({ amount: 3_000_000, label: "Đợt 1", soDot: 1 });
  });

  it("đóng xong đợt 1 → chuyển sang thu đợt 2", () => {
    const after = [{ ...plan[0]!, status: "PAID" }, plan[1]!];
    expect(
      computeDueNow({ totalAmount: 5_000_000, paidAmount: 3_000_000, installments: after }),
    ).toEqual({ amount: 2_000_000, label: "Đợt 2", soDot: 2 });
  });

  it("đóng xong cả 2 đợt → hết nợ", () => {
    const done = plan.map((p) => ({ ...p, status: "PAID" }));
    expect(
      computeDueNow({ totalAmount: 5_000_000, paidAmount: 5_000_000, installments: done }).amount,
    ).toBe(0);
  });

  it("thứ tự đợt trong mảng lộn xộn vẫn lấy đúng đợt sớm nhất", () => {
    expect(
      computeDueNow({ totalAmount: 5_000_000, paidAmount: 0, installments: [plan[1]!, plan[0]!] }).soDot,
    ).toBe(1);
  });

  it("[DUE-01] kế hoạch CHỜ DUYỆT → VẪN thu theo đợt (đảo luật 13/09/2026)", () => {
    // Test cũ ở đây khoá hành vi ngược lại ("chưa duyệt → thu toàn bộ đơn") với lý do
    // "mở đường lách duyệt trả góp". Lý do đó đến từ QĐ-1 bản ĐẦU, mà chủ dự án đã ĐẢO
    // ngày 03/08/2026: `materializeInstallmentRequests` gỡ hẳn cái chặn "chưa APPROVED
    // thì ném lỗi", vì "bấm Lưu kế hoạch là phiếu thu + QR theo đợt phải có NGAY, không
    // bắt khách đứng ở quầy chờ quản lý duyệt mới quét được mã".
    //
    // File này không được đảo theo ⇒ trên prod: `PaymentRequest` đã có phiếu đợt 1
    // 3.000.000đ, mà QR in ra 5.000.000đ. Đây là bug tiền thật, không phải cổng an toàn.
    // Cổng thật vẫn còn nguyên ở chỗ khác: `confirmSettledOrder` +
    // `payos-ingest.ts:1169-1181` vẫn từ chối TỰ CHỐT đơn khi giảm giá chưa duyệt.
    expect(
      computeDueNow({
        totalAmount: 5_000_000,
        paidAmount: 0,
        installments: plan,
        installmentApprovalStatus: "PENDING_APPROVAL",
      }),
    ).toEqual({ amount: 3_000_000, label: "Đợt 1", soDot: 1 });
  });

  it("[DUE-02] kế hoạch ĐÃ DUYỆT → dùng bình thường", () => {
    expect(
      computeDueNow({
        totalAmount: 5_000_000,
        paidAmount: 0,
        installments: plan,
        installmentApprovalStatus: "APPROVED",
      }).soDot,
    ).toBe(1);
  });

  it("[DUE-03] kế hoạch BỊ BÁC → quay về thu toàn bộ đơn", () => {
    // Đây là ca DUY NHẤT loại kế hoạch, và không phải ngoại lệ tuỳ ý: khi QLCS bác,
    // `rejectInstallmentPlan` gọi `revertInstallmentRequests` → VOID phiếu theo đợt +
    // dựng lại phiếu "thu toàn đơn". Số tiền cần thu ngay phải khớp sổ phiếu đó.
    expect(
      computeDueNow({
        totalAmount: 5_000_000,
        paidAmount: 0,
        installments: plan,
        installmentApprovalStatus: "REJECTED",
      }),
    ).toEqual({ amount: 5_000_000, label: "Toàn bộ đơn", soDot: null });
  });

  it("đợt 0đ (đóng đủ 1 lần, dot2 = 0) bị bỏ qua, không sinh QR 0đ", () => {
    const oneShot = [
      { soDot: 1, amount: 5_000_000, status: "PAID" },
      { soDot: 2, amount: 0, status: "PENDING" },
    ];
    expect(
      computeDueNow({ totalAmount: 5_000_000, paidAmount: 5_000_000, installments: oneShot }),
    ).toEqual({ amount: 0, label: "Còn thiếu", soDot: null });
  });
});
