// R1-10 — commission engine (tiền). Pure, coverage cao.
import { describe, it, expect } from "vitest";
import {
  computeCommission,
  computeClawback,
  validateRates,
  CommissionError,
  DEFAULT_RATES,
  COMMISSION_TIERS,
  MAX_TOTAL_RATE,
} from "@/lib/crm/commission";

const recipients = { QC: "qc", SALE_ADMIN: "adm", SALE: "sale", QL_TT: "tt" };

describe("[R1-10] commission engine", () => {
  it("[R1-10-C10.1] 4 tầng đúng % (QC1/Admin1/Sale4/TT2) trên doanh thu 10tr", () => {
    const lines = computeCommission({ revenue: 10_000_000, isRenewal: false, recipients });
    const byTier = Object.fromEntries(lines.map((l) => [l.tier, l.amount]));
    expect(byTier).toEqual({ QC: 100_000, SALE_ADMIN: 100_000, SALE: 400_000, QL_TT: 200_000 });
  });

  it("[R1-10-C10.2] Σ rate > 8% → từ chối", () => {
    expect(() => validateRates({ SALE: 0.07 })).toThrow(CommissionError); // 0.01+0.01+0.07+0.02=0.11
    expect(() => validateRates(DEFAULT_RATES)).not.toThrow(); // đúng 8%
  });

  it("[R1-10-C10.3] tái tục → KHÔNG có hoa hồng 4 tầng", () => {
    expect(computeCommission({ revenue: 10_000_000, isRenewal: true, recipients })).toEqual([]);
  });

  it("[R1-10-C10.4] refund → clawback dòng âm theo tỉ lệ", () => {
    const orig = computeCommission({ revenue: 10_000_000, isRenewal: false, recipients });
    const claw = computeClawback(orig, 1); // hoàn 100%
    expect(claw.every((l) => l.amount < 0 && l.isClawback)).toBe(true);
    const saleClaw = claw.find((l) => l.tier === "SALE");
    expect(saleClaw?.amount).toBe(-400_000);
    // hoàn 50%
    expect(computeClawback(orig, 0.5).find((l) => l.tier === "SALE")?.amount).toBe(-200_000);
  });

  it("[R1-10-C10.5] đổi sale giữa chừng → người chốt cuối hưởng tầng Sale", () => {
    const lines = computeCommission({
      revenue: 10_000_000, isRenewal: false,
      recipients: { ...recipients, SALE: "sale-cuoi" },
    });
    expect(lines.find((l) => l.tier === "SALE")?.recipientId).toBe("sale-cuoi");
  });

  it("chỉ sinh dòng cho tầng có recipient; revenue<=0 → rỗng", () => {
    expect(computeCommission({ revenue: 10_000_000, isRenewal: false, recipients: { SALE: "s" } })).toHaveLength(1);
    expect(computeCommission({ revenue: 0, isRenewal: false, recipients })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GĐ6 (25/08/2026) — tầng giáo viên, trần 9%, và tham số đợt cho mục 9.2.
// ─────────────────────────────────────────────────────────────────────────────
describe("[GĐ6] trần tổng 9%", () => {
  it("pool Sale KHÔNG chứa tầng giáo viên — tầng đó tính trên từng ghi danh", () => {
    // Xem `lib/crm/trial-teacher-commission.ts`. Nhét chung mảng là cộng nhầm cơ sở
    // tính: pool Sale tính trên doanh thu kỳ, tầng GV tính trên từng ghi danh.
    expect(COMMISSION_TIERS).not.toContain("GIAO_VIEN" as never);
  });

  it("Σ pool Sale đúng 8%, trần tổng nới lên 9% (chốt câu 7 — phương án A)", () => {
    const tong = COMMISSION_TIERS.reduce((s, t) => s + DEFAULT_RATES[t], 0);
    expect(tong).toBeCloseTo(0.08, 6);
    expect(MAX_TOTAL_RATE).toBeCloseTo(0.09, 6);
    // Mức mặc định phải nằm DƯỚI trần — nếu không thì lưu cấu hình mặc định cũng bị
    // chính validateRates từ chối.
    expect(() => validateRates()).not.toThrow();
  });

  it("vượt trần vẫn bị chặn, và thông điệp nêu ĐÚNG con số trần", () => {
    try {
      validateRates({ SALE: 0.06 }); // 0.01+0.01+0.06+0.02 = 10%
      throw new Error("đáng lẽ phải ném lỗi");
    } catch (e) {
      expect(e).toBeInstanceOf(CommissionError);
      // Trước GĐ6 chuỗi viết cứng "8%", nới trần mà quên sửa là báo sai cho người dùng.
      expect((e as CommissionError).message).toContain("9.00%");
    }
  });

  it("trần truyền từ cấu hình vận hành thắng hằng mặc định", () => {
    // `crm.commissionMaxTotalRate` — người vận hành hạ trần thì đường ghi phải chặn
    // theo số MỚI, không phải theo hằng trong code.
    expect(() => validateRates({ SALE: 0.04 }, 0.05)).toThrow(CommissionError);
    expect(() => validateRates({ SALE: 0.04 }, 0.09)).not.toThrow();
  });
});

describe("[GĐ6] tham số đợt — chỗ để mục 9.2 đổi bằng cấu hình", () => {
  const base = {
    revenue: 10_000_000,
    isRenewal: false,
    recipients: { SALE: "s1" },
  };

  it("MẶC ĐỊNH: đợt 2 vẫn tính hoa hồng đầy đủ (một hợp đồng = một kỳ)", () => {
    // Đây là phương án đang đề xuất: chia mấy đợt thu cũng vẫn là khách mới. Nếu đợt 2
    // xuống mức tái tục thì Sale có động cơ ép phụ huynh đóng full.
    const lines = computeCommission({ ...base, soDot: 2 });
    expect(lines.find((l) => l.tier === "SALE")?.amount).toBe(400_000);
  });

  it("bật cờ: đợt 2 trở đi coi như tái tục, không sinh dòng nào", () => {
    expect(
      computeCommission({ ...base, soDot: 2, dotSauTinhTaiTuc: true }),
    ).toEqual([]);
    expect(
      computeCommission({ ...base, soDot: 3, dotSauTinhTaiTuc: true }),
    ).toEqual([]);
  });

  it("bật cờ nhưng đợt 1 thì KHÔNG bị ảnh hưởng", () => {
    const lines = computeCommission({ ...base, soDot: 1, dotSauTinhTaiTuc: true });
    expect(lines.find((l) => l.tier === "SALE")?.amount).toBe(400_000);
  });

  it("bỏ trống soDot coi như đợt 1", () => {
    const lines = computeCommission({ ...base, dotSauTinhTaiTuc: true });
    expect(lines.find((l) => l.tier === "SALE")?.amount).toBe(400_000);
  });

  it("cờ chỉ có tác dụng khi bật TƯỜNG MINH — undefined không tự suy", () => {
    const lines = computeCommission({ ...base, soDot: 2, dotSauTinhTaiTuc: undefined });
    expect(lines.length).toBeGreaterThan(0);
  });
});
