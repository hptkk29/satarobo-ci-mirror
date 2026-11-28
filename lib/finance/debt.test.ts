// R2-06 — computeDebt + paidOf (THUẦN). Pure.
// R7-04 — computeEnrollmentDebt + overdueBucket + reminder-day decision (THUẦN).
import { describe, it, expect } from "vitest";
import {
  computeDebt,
  paidOf,
  computeEnrollmentDebt,
  overdueBucket,
  effectiveReminderDays,
  isReminderDue,
} from "@/lib/finance/debt";

describe("[R2-06] debt calc (C6.1)", () => {
  it("công nợ = total - paid (không âm)", () => {
    expect(computeDebt(5_000_000, 2_000_000)).toBe(3_000_000);
    expect(computeDebt(5_000_000, 5_000_000)).toBe(0);
    expect(computeDebt(5_000_000, 6_000_000)).toBe(0); // không âm
  });
  it("paidOf theo status", () => {
    expect(paidOf({ status: "CONFIRMED", totalAmount: 100 })).toBe(100);
    expect(paidOf({ status: "COMPLETED", totalAmount: 100 })).toBe(100);
    expect(paidOf({ status: "PENDING_PAYMENT", totalAmount: 100 })).toBe(0);
  });
});

describe("[R7-04] computeEnrollmentDebt (AC6)", () => {
  /** Phiếu thu đã xác nhận. */
  const thu = (amount: number) => ({ amount, accountantStatus: "CONFIRMED" });
  /** Bút toán hoàn (số ÂM). */
  const hoan = (amount: number) => ({ amount, accountantStatus: "REFUNDED" });
  /** Bút toán điều chỉnh mang DELTA — vẫn là `CONFIRMED`. */
  const dieuChinh = (delta: number) => ({ amount: delta, accountantStatus: "CONFIRMED" });
  const DANG_HOC = "STUDYING";

  it("finalPrice - Σ đã đóng", () => {
    expect(computeEnrollmentDebt(9_000_000, [thu(5_000_000)], DANG_HOC)).toBe(4_000_000);
    expect(
      computeEnrollmentDebt(9_000_000, [thu(5_000_000), thu(4_000_000)], DANG_HOC),
    ).toBe(0);
  });
  it("đóng thừa → ÂM (trả raw, không clamp)", () => {
    expect(computeEnrollmentDebt(9_000_000, [thu(10_000_000)], DANG_HOC)).toBe(-1_000_000);
  });
  it("finalPrice null → 0; không có khoản → finalPrice", () => {
    expect(computeEnrollmentDebt(null, [thu(1_000)], DANG_HOC)).toBe(-1_000);
    expect(computeEnrollmentDebt(9_000_000, [], DANG_HOC)).toBe(9_000_000);
  });

  // ── Ngoại lệ "đã rời lớp" (17/09/2026 — NỢ-4) ───────────────────────────────────
  it("CÒN HỌC: hoàn tiền LÀM TĂNG công nợ — tiền đã trả lại thì vẫn còn phải đóng", () => {
    // Đóng 5tr rồi được hoàn 2tr ⇒ thực đóng 3tr ⇒ còn nợ 6tr.
    expect(computeEnrollmentDebt(9_000_000, [thu(5_000_000), hoan(-2_000_000)], DANG_HOC)).toBe(
      6_000_000,
    );
  });
  it.each(["WITHDREW", "TRANSFERRED", "CANCELLED"])(
    "ĐÃ RỜI LỚP (%s): KHÔNG trừ bút toán hoàn — không đòi tiền người vừa được trả lại",
    (trangThai) => {
      // Cùng dữ liệu như ca trên. Nếu tính ròng thì em này "nợ" 9tr — đúng số vừa được
      // hoàn cộng phần chưa đóng — và hệ thống đi đòi một người đã nghỉ. Đó là NỢ MA.
      expect(
        computeEnrollmentDebt(9_000_000, [thu(5_000_000), hoan(-5_000_000)], trangThai),
      ).toBe(4_000_000);
    },
  );
  it("ngoại lệ KHÔNG áp cho bút toán ĐIỀU CHỈNH — sửa số ghi nhầm thì nợ phải theo số đúng", () => {
    // Ghi nhầm 5tr, sửa xuống 3tr (delta −2tr). Dù đã nghỉ, công nợ vẫn phải tính trên
    // 3tr thật chứ không phải 5tr ghi nhầm.
    expect(
      computeEnrollmentDebt(9_000_000, [thu(5_000_000), dieuChinh(-2_000_000)], "WITHDREW"),
    ).toBe(6_000_000);
  });
  it("COMPLETED KHÔNG phải 'rời lớp' — học xong vẫn phải đóng đủ", () => {
    expect(
      computeEnrollmentDebt(9_000_000, [thu(5_000_000), hoan(-2_000_000)], "COMPLETED"),
    ).toBe(6_000_000);
  });
  it("status null → coi như còn học (fail-closed: không tự cho ngoại lệ)", () => {
    expect(computeEnrollmentDebt(9_000_000, [thu(5_000_000), hoan(-2_000_000)], null)).toBe(
      6_000_000,
    );
  });
});

describe("[R7-04] overdueBucket (công nợ đa chiều)", () => {
  const due = new Date("2026-06-15T00:00:00Z");
  const at = (d: string) => new Date(d + "T00:00:00Z");
  it("chưa tới hạn / null → none", () => {
    expect(overdueBucket(due, at("2026-06-15"))).toBe("none"); // đúng hạn (0 ngày)
    expect(overdueBucket(due, at("2026-06-10"))).toBe("none"); // trước hạn
    expect(overdueBucket(null, at("2026-06-30"))).toBe("none");
  });
  it("biên 1-7 / 8-30 / >30", () => {
    expect(overdueBucket(due, at("2026-06-16"))).toBe("1-7"); // +1
    expect(overdueBucket(due, at("2026-06-22"))).toBe("1-7"); // +7
    expect(overdueBucket(due, at("2026-06-23"))).toBe("8-30"); // +8
    expect(overdueBucket(due, at("2026-07-15"))).toBe("8-30"); // +30
    expect(overdueBucket(due, at("2026-07-16"))).toBe(">30"); // +31
  });
});

describe("[R7-04] reminder-day decision (AC4 / C4,C5)", () => {
  const due = new Date("2026-06-15T00:00:00Z");
  const at = (d: string) => new Date(d + "T00:00:00Z");

  it("effectiveReminderDays: override → fallback default 14", () => {
    expect(effectiveReminderDays(7, 14)).toBe(7);
    expect(effectiveReminderDays(null, 14)).toBe(14);
    expect(effectiveReminderDays(0, 14)).toBe(0); // 0 hợp lệ — nhắc đúng ngày hạn
  });

  it("X=7: D-8 chưa nhắc, từ D-7 trở đi đã đến hạn", () => {
    expect(isReminderDue(due, 7, at("2026-06-07"))).toBe(false); // D-8
    expect(isReminderDue(due, 7, at("2026-06-08"))).toBe(true); // D-7
    expect(isReminderDue(due, 7, at("2026-06-09"))).toBe(true); // D-6 (anti-spam ở tầng lastReminderAt)
  });

  it("reminderDays null → dùng default 14: nhắc từ D-14", () => {
    const days = effectiveReminderDays(null, 14);
    expect(isReminderDue(due, days, at("2026-05-31"))).toBe(false); // D-15
    expect(isReminderDue(due, days, at("2026-06-01"))).toBe(true); // D-14
  });

  it("ngày nhắc ≤ hôm nay (X lớn hơn khoảng cách) → nhắc ngay (C5)", () => {
    // dueDate +3 ngày, X=14 → remindFrom đã ở quá khứ → nhắc ngay.
    const dueSoon = at("2026-06-18");
    expect(isReminderDue(dueSoon, 14, at("2026-06-15"))).toBe(true);
  });
});
