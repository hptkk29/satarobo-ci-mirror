// B-02 / quyết định B3 (24/08/2026) — "thực thu" là MỘT công thức duy nhất.
// Ba tình huống bắt buộc: thu thường · có hoàn · có điều chỉnh giảm.
import { describe, it, expect } from "vitest";
import {
  tinhThucThu,
  butToanThucThu,
  WHERE_THUC_THU,
  TRANG_THAI_THUC_THU,
  type ThucThuButToan,
} from "@/lib/finance/thuc-thu";

/** Dựng 1 bút toán Payment phẳng cho test. */
function bt(
  id: string,
  amount: number,
  accountantStatus: string,
  adjustmentOfId: string | null = null,
): ThucThuButToan {
  return { id, amount, accountantStatus, adjustmentOfId };
}

describe("[B-02] tinhThucThu — thu thường", () => {
  it("cộng đúng các khoản kế toán ĐÃ xác nhận", () => {
    expect(tinhThucThu([bt("p1", 5_000_000, "CONFIRMED"), bt("p2", 3_000_000, "CONFIRMED")])).toBe(
      8_000_000,
    );
  });

  it("không có bút toán nào → 0", () => {
    expect(tinhThucThu([])).toBe(0);
  });

  it("khoản Sale mới ghi nhận (PENDING) và khoản bị từ chối (REJECTED) KHÔNG phải tiền thật", () => {
    expect(
      tinhThucThu([
        bt("p1", 5_000_000, "CONFIRMED"),
        bt("p2", 9_000_000, "PENDING"),
        bt("p3", 7_000_000, "REJECTED"),
      ]),
    ).toBe(5_000_000);
  });
});

describe("[B-02] tinhThucThu — có hoàn tiền", () => {
  it("hoàn toàn bộ → thực thu về 0, KHÔNG còn phồng bằng khoản gốc", () => {
    // refundPayment() ghi bút toán ÂM, trỏ adjustmentOfId về gốc, KHÔNG xoá gốc.
    const rows = [bt("p1", 5_000_000, "CONFIRMED"), bt("r1", -5_000_000, "REFUNDED", "p1")];
    expect(tinhThucThu(rows)).toBe(0);
  });

  it("hoàn một phần → trừ đúng phần đã hoàn", () => {
    const rows = [bt("p1", 5_000_000, "CONFIRMED"), bt("r1", -2_000_000, "REFUNDED", "p1")];
    expect(tinhThucThu(rows)).toBe(3_000_000);
  });

  it("bút toán hoàn KHÔNG thay thế bản gốc (hoàn là đối ứng, không phải sửa số)", () => {
    const rows = [bt("p1", 5_000_000, "CONFIRMED"), bt("r1", -2_000_000, "REFUNDED", "p1")];
    expect(butToanThucThu(rows).map((r) => r.id).sort()).toEqual(["p1", "r1"]);
  });
});

describe("[B-02] tinhThucThu — có điều chỉnh (mô hình DELTA)", () => {
  // 🔴 ĐỔI MÔ HÌNH 07/09/2026 (`payment_type_tach_khoi_status`), áp khi hợp nhất
  // `main` → `test` ngày 16/09/2026.
  //
  // TRƯỚC: `adjustPayment()` đẻ một bút toán trạng thái `ADJUSTED` mang SỐ ĐÚNG, bản
  //   gốc giữ số cũ ⇒ phải LOẠI bản gốc, không thì cộng đôi. Bộ ca cũ ở đây đo đúng
  //   luật đó ("bản điều chỉnh THAY THẾ bản gốc").
  // NAY: `ADJUSTED` đã bị BỎ khỏi `PaymentAccountantStatus`. Bút toán điều chỉnh là
  //   dòng `paymentType = "ADJUSTMENT"`, trạng thái vẫn `CONFIRMED`, và nó mang PHẦN
  //   CHÊNH LỆCH. Bản gốc giữ số cũ, cộng CẢ HAI mới ra số đúng.
  // ⇒ Loại bản gốc bây giờ là ĐẾM THIẾU đúng phần vừa sửa — ngược hẳn lỗi cũ.
  //
  // Luật này khai ở `lib/finance/debt.ts` ("KHÔNG lọc theo `paymentType`: bút toán
  // ADJUSTMENT LUÔN được cộng"); file này chỉ đi theo.

  it("điều chỉnh GIẢM: gốc + delta âm = số đúng, không loại bản nào", () => {
    // Khách đóng 5tr, kế toán sửa xuống 3tr ⇒ dòng điều chỉnh mang −2tr.
    const rows = [bt("p1", 5_000_000, "CONFIRMED"), bt("a1", -2_000_000, "CONFIRMED", "p1")];
    expect(tinhThucThu(rows)).toBe(3_000_000);
    // CẢ HAI dòng đều tham gia — không còn bước "loại bản gốc".
    expect(butToanThucThu(rows).map((r) => r.id)).toEqual(["p1", "a1"]);
  });

  it("điều chỉnh TĂNG: gốc + delta dương", () => {
    const rows = [bt("p1", 3_000_000, "CONFIRMED"), bt("a1", 2_000_000, "CONFIRMED", "p1")];
    expect(tinhThucThu(rows)).toBe(5_000_000);
  });

  it("điều chỉnh NHIỀU LẦN: cộng dồn mọi delta, không chỉ lấy bản cuối", () => {
    const rows = [
      bt("p1", 5_000_000, "CONFIRMED"),
      bt("a1", -1_000_000, "CONFIRMED", "p1"),
      bt("a2", -1_000_000, "CONFIRMED", "a1"),
    ];
    expect(tinhThucThu(rows)).toBe(3_000_000);
  });

  it("điều chỉnh giảm rồi hoàn nốt → 0", () => {
    const rows = [
      bt("p1", 5_000_000, "CONFIRMED"),
      bt("a1", -2_000_000, "CONFIRMED", "p1"),
      bt("r1", -3_000_000, "REFUNDED", "a1"),
    ];
    expect(tinhThucThu(rows)).toBe(0);
  });

  it("gốc CHƯA xác nhận thì không vào phép cộng — delta của nó cũng vậy", () => {
    // PENDING chưa phải tiền thật. Dòng điều chỉnh treo trên nó cũng để PENDING;
    // cả hai cùng đứng ngoài, không đẻ ra tiền ảo.
    const rows = [bt("p1", 5_000_000, "PENDING"), bt("a1", -2_000_000, "PENDING", "p1")];
    expect(tinhThucThu(rows)).toBe(0);
  });
});

describe("[B-02] hợp đồng where dùng chung", () => {
  it("chỉ HAI trạng thái tham gia phép tính thực thu", () => {
    // `ADJUSTED` đã bị bỏ khỏi `PaymentAccountantStatus` (07/09/2026) — bút toán điều
    // chỉnh nay mang trạng thái `CONFIRMED` và phân biệt bằng cột `paymentType`.
    expect([...TRANG_THAI_THUC_THU].sort()).toEqual(["CONFIRMED", "REFUNDED"]);
  });

  it("where chuẩn loại bản ghi xoá mềm và KHÔNG loại bản gốc (mô hình delta)", () => {
    // 🔴 Đổi 16/09/2026 khi hợp nhất `main`: `ADJUSTED` đã bị bỏ khỏi trạng thái kế toán;
    // bút toán điều chỉnh nay là `paymentType = "ADJUSTMENT"` mang PHẦN CHÊNH LỆCH. Bản
    // gốc giữ số cũ và PHẢI được cộng. Khoá lại cả hai vế: không còn `adjustments`, và
    // KHÔNG được thêm bộ lọc `paymentType` (xem `lib/finance/debt.ts`).
    expect(WHERE_THUC_THU.deletedAt).toBeNull();
    expect(WHERE_THUC_THU.accountantStatus).toEqual({ in: [...TRANG_THAI_THUC_THU] });
    expect("adjustments" in WHERE_THUC_THU).toBe(false);
    expect("paymentType" in WHERE_THUC_THU).toBe(false);
  });

  it("lọc theo where chuẩn rồi vẫn qua hàm thuần thì kết quả không đổi (idempotent)", () => {
    const rows = [bt("a1", 3_000_000, "ADJUSTED", "p1"), bt("r1", -1_000_000, "REFUNDED", "a1")];
    expect(tinhThucThu(butToanThucThu(rows))).toBe(tinhThucThu(rows));
  });
});
