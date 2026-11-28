// Ca [BFR-*] — `planRequests`: backfill dựng phiếu thu hình dạng nào cho một đơn.
//
// Phần THUẦN của `scripts/backfill-payment-requests.ts`. Script đó ghi thẳng
// `PaymentRequest` (không qua `lib/payments/payment-request.ts` vì tệp kia mở đầu bằng
// `import "server-only"`, không nạp được trong tiến trình `tsx`), nên nó phải TỰ MANG
// THEO các luật của đường chạy thật — và đó đúng là chỗ nó từng lệch.
import { describe, it, expect } from "vitest";
import { planRequests } from "./backfill-payment-requests";

const don = (p: Partial<Parameters<typeof planRequests>[0]> = {}) => ({
  id: "o1",
  code: "ORD-260913-000001",
  totalAmount: 8_000_000,
  installmentApprovalStatus: null,
  installments: [],
  ...p,
});

const KE_HOACH_4_DOT = [
  { soDot: 1, amount: 1_000_000, dueDate: null },
  { soDot: 2, amount: 3_000_000, dueDate: null },
  { soDot: 3, amount: 2_000_000, dueDate: null },
  { soDot: 4, amount: 2_000_000, dueDate: null },
];

describe("[BFR-01] kế hoạch còn hiệu lực ⇒ phiếu THEO ĐỢT", () => {
  it("approvalStatus = null VẪN là kế hoạch còn hiệu lực", () => {
    // ⚠️ ĐÂY LÀ CON BUG ĐÃ VÁ 14/09. Bản cũ đòi `=== "APPROVED"`, mà cơ chế duyệt kế
    // hoạch ĐÃ BỊ GỠ HẲN (`approveInstallmentPlan` nay 0 lời gọi trong mã chạy) nên
    // KHÔNG đơn nào còn đạt điều kiện đó. Luật chốt từ 13/09: chỉ `REJECTED` mới làm
    // kế hoạch mất hiệu lực — hỏi ở `lib/payments/installment-plan.ts`.
    const ra = planRequests(don({ installments: KE_HOACH_4_DOT }));
    expect(ra.map((r) => r.installmentNo)).toEqual([1, 2, 3, 4]);
    expect(ra.map((r) => r.amountDue)).toEqual([
      1_000_000, 3_000_000, 2_000_000, 2_000_000,
    ]);
    // Σ phiếu phải bằng tổng đơn — nếu không thì công nợ sổ mới lệch ngay từ lúc dựng.
    expect(ra.reduce((s, r) => s + r.amountDue, 0)).toBe(8_000_000);
  });

  it("APPROVED cũng vẫn theo đợt (dữ liệu cũ còn giá trị đó)", () => {
    const ra = planRequests(
      don({ installmentApprovalStatus: "APPROVED", installments: KE_HOACH_4_DOT }),
    );
    expect(ra).toHaveLength(4);
  });

  it("REJECTED ⇒ kế hoạch mất hiệu lực ⇒ về phiếu TOÀN ĐƠN", () => {
    const ra = planRequests(
      don({ installmentApprovalStatus: "REJECTED", installments: KE_HOACH_4_DOT }),
    );
    expect(ra).toEqual([
      expect.objectContaining({ installmentNo: 0, amountDue: 8_000_000 }),
    ]);
  });

  it("matchKey của từng đợt phải khác nhau — đó là khoá đối khớp tiền về", () => {
    const ra = planRequests(don({ installments: KE_HOACH_4_DOT }));
    expect(new Set(ra.map((r) => r.matchKey)).size).toBe(4);
  });
});

describe("[BFR-02] không kế hoạch ⇒ MỘT phiếu toàn đơn", () => {
  it("đơn thường", () => {
    const ra = planRequests(don());
    expect(ra).toEqual([
      expect.objectContaining({ installmentNo: 0, amountDue: 8_000_000, dueDate: null }),
    ]);
  });
});

describe("[BFR-03] ĐÃ CÓ phiếu đợt sống ⇒ KHÔNG dựng phiếu toàn đơn đè lên", () => {
  it("trả mảng RỖNG thay vì thêm một phiếu 8tr thứ hai", () => {
    // ⚠️ Ca này canh một phép tính TIỀN, không phải một chi tiết kỹ thuật. Đo thật trên
    // `satarobo_local`: `ORD-260913-000001` có 4 phiếu đợt (1+3+2+2 = 8tr) và
    // `installmentApprovalStatus = null`. Bản cũ rơi xuống nhánh toàn đơn ⇒ dry-run
    // định tạo THÊM phiếu 8.000.000đ và rót 1.000.000đ vào đó, để 4 phiếu đợt nằm
    // không ⇒ đơn 8tr hoá **16tr phải thu**.
    //
    // Mã thật có luật này rồi: `ensureFullOrderRequest` trả `null` khi đơn đã có phiếu
    // đợt còn sống. Script tạo thẳng nên phải tự mang luật theo, kẻo nó là đường vòng
    // qua chính cổng mà mã thật dựng lên.
    expect(planRequests(don({ installments: [] }), true)).toEqual([]);
    expect(
      planRequests(
        don({ installmentApprovalStatus: "REJECTED", installments: KE_HOACH_4_DOT }),
        true,
      ),
    ).toEqual([]);
  });

  it("mặc định là FALSE — người gọi phải nói rõ, không tự đoán", () => {
    expect(planRequests(don())).toHaveLength(1);
  });
});
