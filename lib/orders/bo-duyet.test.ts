// lib/orders/bo-duyet.test.ts — BỎ CƠ CHẾ DUYỆT ĐƠN HÀNG.
//
// Chủ dự án chốt: "ở phần đơn hàng thì bỏ phần duyệt đơn hàng luôn, không cần phải
// duyệt chính sách giảm giá hay duyệt kế hoạch thanh toán nữa" (nhắc lại 3 lượt).
//
// ⚠️ CỔNG Ở ĐƯỜNG NHẬN TIỀN KHÔNG PHẢI "MẤT MỘT CỬA KIỂM SOÁT" — GỠ NÓ LÀ ĐÓNG MỘT LỖ.
//
// Đo bằng mã nguồn: `decideSepayAction` trả `MANUAL` khi giảm giá chưa duyệt. Ở webhook,
// `app/api/public/webhook/sepay/route.ts:168` vào nhánh sớm với mọi action ≠ CONFIRM, và
// cửa ghi vào sổ mới (`:178`) CHỈ chạy `if (decision.action === "MANUAL" && !order)` —
// chú thích ngay đó nói thẳng: "CHỈ làm cho ca KHÔNG CÓ ĐƠN". Ca "có đơn + giảm giá chưa
// duyệt" tra RA đơn ⇒ không qua cửa đó ⇒ chỉ `logIntegration(MANUAL_REVIEW)` rồi return:
// KHÔNG BankTransaction (kể cả UNMATCHED), KHÔNG PaymentRequest/Allocation, KHÔNG Payment.
// Tiền vào tài khoản ngân hàng, ba sổ trống.
//
// Cổng này CHƯA TỪNG chạy thật trên prod (MANUAL_REVIEW do nó = 0; 9 đơn
// PENDING_APPROVAL đều đã COMPLETED + thu đủ ⇒ chưa ai từng bấm duyệt) — nên chưa ai
// đau. Nhưng mọi đơn có giảm giá thanh toán bằng QR sẽ đau.
//
// Cái THAY THẾ cổng duyệt không phải "không gì cả": là DẤU VẾT — `lib/orders/price-guard.ts`
// + AuditLog `ORDER_CREATED` ghi trong cùng transaction tạo đơn (commit trước).
import { describe, it, expect } from "vitest";
import { decideSepayAction } from "@/lib/payments/sepay";

const donCoGiamGia = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  status: "PENDING_PAYMENT" as const,
  totalAmount: 5_000_000,
  gatewayTxnId: null,
  discountApprovalStatus: "PENDING_APPROVAL" as string | null,
  ...over,
});

const tienVe = (amount: number) => ({
  id: 123,
  transferType: "in",
  transferAmount: amount,
});

describe("[BD-01] đường NHẬN TIỀN không còn hỏi giảm giá đã duyệt chưa", () => {
  it("đơn giảm giá 'chưa duyệt' + khách chuyển đủ → CONFIRM (trước đây MANUAL ⇒ tiền mất sổ)", () => {
    const r = decideSepayAction({
      payload: tienVe(5_000_000),
      order: donCoGiamGia(),
    } as never);
    expect(r.action).toBe("CONFIRM");
  });

  it("đơn giảm giá 'bị bác' + khách chuyển đủ → CONFIRM", () => {
    const r = decideSepayAction({
      payload: tienVe(5_000_000),
      order: donCoGiamGia({ discountApprovalStatus: "REJECTED" }),
    } as never);
    expect(r.action).toBe("CONFIRM");
  });
});

describe("[BD-02] các cổng CÒN LẠI phải nguyên vẹn — gỡ duyệt không phải gỡ hết", () => {
  it("trả THIẾU vẫn MANUAL", () => {
    const r = decideSepayAction({
      payload: tienVe(1_000_000),
      order: donCoGiamGia({ discountApprovalStatus: null }),
    } as never);
    expect(r.action).toBe("MANUAL");
  });

  it("đơn KHÔNG ở PENDING_PAYMENT vẫn SKIP", () => {
    const r = decideSepayAction({
      payload: tienVe(5_000_000),
      order: donCoGiamGia({ status: "CONFIRMED", discountApprovalStatus: null }),
    } as never);
    expect(r.action).toBe("SKIP");
  });

  it("giao dịch đã xử lý vẫn SKIP (chống cộng đôi)", () => {
    const r = decideSepayAction({
      payload: tienVe(5_000_000),
      order: donCoGiamGia({ gatewayTxnId: "123", discountApprovalStatus: null }),
    } as never);
    expect(r.action).toBe("SKIP");
  });

  it("không tra ra đơn vẫn MANUAL", () => {
    const r = decideSepayAction({ payload: tienVe(5_000_000), order: null } as never);
    expect(r.action).toBe("MANUAL");
  });

  it("không phải tiền VÀO vẫn SKIP", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "out", transferAmount: 5_000_000 },
      order: donCoGiamGia({ discountApprovalStatus: null }),
    } as never);
    expect(r.action).toBe("SKIP");
  });
});
