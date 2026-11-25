// B-02 / quyết định B3 (24/08/2026) — "thực thu" là MỘT công thức duy nhất.
// Ba tình huống bắt buộc: thu thường · có hoàn · có điều chỉnh giảm.
import { describe, it, expect } from "vitest";
import {
  tinhThucThu,
  butToanThucThu,
  coBangChungNganHang,
  WHERE_THUC_THU,
  WHERE_DOANH_THU,
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

// ── DOANH THU ≠ THỰC THU (07/11/2026) — quyết định BGĐ 01–02/11: tiền ĐÃ vào ngân hàng là doanh thu, không chờ kế toán xác nhận ──
describe("[DT-*] coBangChungNganHang — bằng chứng là marker do HỆ THỐNG ghi, không phải chữ người gõ", () => {
  it.each([
    ["[DT-01] webhook cổng thanh toán", "[auto:sepay:FT26310040803067]", true],
    ["[DT-02] webhook provider khác", "[auto:payos:123456]", true],
    ["[DT-03] kế toán gắn giao dịch ngân hàng thật", "[gan-tay:bt_abc123]", true],
    ["[DT-04] khoản kế hoạch TỰ SINH (đợt) KHÔNG phải tiền về", "[auto:order-installment:dot1]", false],
    ["[DT-05] khoản kế hoạch TỰ SINH (chốt đơn) KHÔNG phải tiền về", "[auto:order-confirm]", false],
    ["[DT-06] mã giao dịch do NGƯỜI GÕ khai chưa phải bằng chứng", "[ma-gd:FT26310040803067]", false],
    ["[DT-07] nhập lịch sử", "[backfill-import]", false],
    ["[DT-08] ghi chú tự do", "khách đưa tiền mặt", false],
    ["[DT-09] không có ghi chú", null, false],
  ])("%s", (_ten, note, ky) => {
    expect(coBangChungNganHang(note as string | null)).toBe(ky);
  });
});

describe("[DT-*] butToanThucThu — cờ coBangChungNganHang chỉ mở cho đúng PENDING thu gốc dương", () => {
  const pending = (id: string, amount: number, co: boolean | undefined, adj: string | null = null): ThucThuButToan => ({
    id,
    amount,
    accountantStatus: "PENDING",
    adjustmentOfId: adj,
    ...(co === undefined ? {} : { coBangChungNganHang: co }),
  });

  it("[DT-10] PENDING CÓ bằng chứng ngân hàng ⇒ được tính (ca thật: đợt 2 7.976.000đ chưa xác nhận)", () => {
    expect(tinhThucThu([bt("p1", 1_000_000, "CONFIRMED"), pending("p2", 7_976_000, true)])).toBe(8_976_000);
  });

  it("[DT-11] PENDING KHÔNG bằng chứng (tiền mặt Sale khai) ⇒ chưa tính", () => {
    expect(tinhThucThu([pending("p1", 500_000, false)])).toBe(0);
  });

  it("[DT-12] ĐÔI CHỨNG hành vi CŨ: dòng không khai cờ (hoa hồng / công nợ / nguồn lead) PENDING vẫn KHÔNG tính", () => {
    expect(tinhThucThu([pending("p1", 7_976_000, undefined)])).toBe(0);
  });

  it("[DT-13] REJECTED có cờ ⇒ KHÔNG tính (kế toán đã nói tiền đó không hợp lệ)", () => {
    expect(tinhThucThu([{ id: "p1", amount: 3_000_000, accountantStatus: "REJECTED", adjustmentOfId: null, coBangChungNganHang: true }])).toBe(0);
  });

  it("[DT-14] bút toán đảo / điều chỉnh PENDING có cờ ⇒ KHÔNG tính; số âm PENDING ⇒ KHÔNG tính", () => {
    expect(tinhThucThu([pending("p1", -1_000_000, true, "p0")])).toBe(0);
    expect(tinhThucThu([pending("p1", -1_000_000, true)])).toBe(0);
  });

  it("[DT-15] khoản được kế toán xác nhận SAU đó vẫn tính ĐÚNG MỘT LẦN (không cộng đôi)", () => {
    const truoc = [pending("p2", 7_976_000, true)];
    const sau = [{ ...bt("p2", 7_976_000, "CONFIRMED"), coBangChungNganHang: true }];
    expect(tinhThucThu(truoc)).toBe(7_976_000);
    expect(tinhThucThu(sau)).toBe(7_976_000);
  });

  it("[DT-16] hoàn tiền vẫn trừ ra như cũ", () => {
    expect(tinhThucThu([pending("p1", 7_976_000, true), bt("r1", -1_000_000, "REFUNDED", "p1")])).toBe(6_976_000);
  });
});

describe("[DT-*] WHERE_DOANH_THU — hằng thực thu CŨ không đổi; hằng mới là hợp của hai nhánh", () => {
  it("[DT-20] WHERE_THUC_THU giữ nguyên (nền của công nợ / hoa hồng / cổng phụ huynh)", () => {
    expect(WHERE_THUC_THU).toEqual({ deletedAt: null, accountantStatus: { in: ["CONFIRMED", "REFUNDED"] } });
  });

  it("[DT-21] nhánh 1 của WHERE_DOANH_THU là đúng điều kiện thực thu; nhánh 2 là PENDING thu gốc dương có marker ngân hàng, loại marker tự sinh/lịch sử", () => {
    expect(WHERE_DOANH_THU.deletedAt).toBeNull();
    const [thucThu, chuaXacNhan] = WHERE_DOANH_THU.OR;
    expect(thucThu).toEqual({ accountantStatus: { in: [...TRANG_THAI_THUC_THU] } });
    expect(chuaXacNhan).toMatchObject({ accountantStatus: "PENDING", adjustmentOfId: null, amount: { gt: 0 }, adjustments: { none: { deletedAt: null } } });
    const mang = JSON.stringify(chuaXacNhan);
    for (const m of ["[auto:", "[gan-tay:", "[auto:order-", "[backfill-import]", "[sheet:", "[chuyen:"]) expect(mang).toContain(JSON.stringify(m).slice(1, -1));
    // Không có đường nào cho REJECTED vào.
    expect(mang).not.toContain("REJECTED");
  });
});
