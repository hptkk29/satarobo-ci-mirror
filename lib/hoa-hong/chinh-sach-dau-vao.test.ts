// @vitest-environment node
/**
 * [NHH-DV-*] — bộ kiểm ĐẦU VÀO của rule + khoá phạm vi (`chinh-sach-dau-vao.ts`). THUẦN.
 *
 * Vì sao có tệp này (cấy lỗi 08/10): module này KHÔNG có ca thuần nào. Nó chỉ được chạm gián tiếp qua `[NHH-SEED-04]`
 * (bộ rule seed hợp lệ) và `[NHH-POL-DB-07]` (3 đầu vào sai trên Postgres). Cấy 8 lỗi ở đây thì 6 lỗi cho 0 ca đỏ:
 *   · khoá 'trùng ô' bỏ thành phần doanh thu ⇒ rule Học phí + rule Học cụ của CÙNG vai bị bắt oan là trùng;
 *   · biên (0, 1] của PERCENT: nhận 0% / nhận >100% / thiếu tỉ lệ; biên FIXED > 0; PERCENT / EXCLUDE mang giá trị thừa.
 * CHECK `CommissionRule_cach_tinh_chk` của DB chặn lại ở phút cuối, nhưng bằng một lỗi Prisma thô SAU khi các rule hợp lệ
 * đứng trước đã được ghi — và validator còn là nơi duy nhất nói ĐÚNG rule số mấy sai.
 */
import { describe, it, expect } from "vitest";

import { cotPhamVi, kiemRuleDauVao, scopeKeyCua, type PhamViInput, type RuleInput } from "./chinh-sach-dau-vao";

const r = (p: Partial<RuleInput> = {}): RuleInput => ({
  transactionTypeCode: "NEW",
  roleCode: "SALE",
  revenueComponent: "TUITION",
  calcKind: "PERCENT",
  rate: 0.04,
  fixedAmount: null,
  tierTable: null,
  note: null,
  ...p,
});

const loi = (...rules: RuleInput[]) => kiemRuleDauVao(rules);

describe("[NHH-DV-01] một ô (loại × vai × thành phần) chỉ một rule", () => {
  it("[NHH-DV-01] trùng đủ ba khoá ⇒ đúng MỘT lỗi nói 'trùng ô' và nêu số thứ tự rule", () => {
    const e = loi(r(), r({ rate: 0.05 }));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("trùng ô");
    expect(e[0]).toContain("Rule #2");
  });

  it("[NHH-DV-01b] khác MỘT trong ba khoá ⇒ KHÔNG trùng: khác thành phần (Học phí / Học cụ), khác vai, khác loại giao dịch", () => {
    // Cấy 08/10 (I01: bỏ thành phần khỏi khoá): 0 ca đỏ. Hậu quả nếu lọt: không khai được hai rule cho CÙNG vai ở hai thành phần.
    expect(loi(r(), r({ revenueComponent: "MATERIAL" }))).toEqual([]);
    expect(loi(r(), r({ roleCode: "SALE_ADMIN" }))).toEqual([]);
    expect(loi(r(), r({ transactionTypeCode: "RENEWAL" }))).toEqual([]);
  });
});

describe("[NHH-DV-02] PERCENT: 0 < tỉ lệ ≤ 1, tối đa 6 chữ số thập phân, không mang giá trị khác", () => {
  it("[NHH-DV-02] biên: 0,000001 và 1 (100%) qua; 0, 1,000001, âm, 7 chữ số, thiếu ⇒ lỗi", () => {
    // Cấy 08/10 (I02, I02b, I03, I08): sửa/bỏ cận trên, dịch biên dưới, bỏ nhánh thiếu tỉ lệ ⇒ 0 ca đỏ.
    expect(loi(r({ rate: 0.000001 }))).toEqual([]);
    expect(loi(r({ rate: 1 }))).toEqual([]);
    expect(loi(r({ rate: "1.000000" }))).toEqual([]);
    for (const sai of [0, "0", "0.000000", 1.000001, "1.000001", 2, -0.01, 0.1234567]) {
      expect(loi(r({ rate: sai })).length, String(sai)).toBe(1);
    }
    const thieu = loi(r({ rate: null }));
    expect(thieu).toHaveLength(1);
    expect(thieu[0]).toContain("cần tỉ lệ");
  });

  it("[NHH-DV-02b] PERCENT mang số tiền cố định hoặc bảng bậc ⇒ lỗi", () => {
    expect(loi(r({ fixedAmount: 1 }))).toHaveLength(1);
    expect(loi(r({ tierTable: [] }))).toHaveLength(1);
  });
});

describe("[NHH-DV-03] FIXED / TIER / EXCLUDE", () => {
  const fixed = (p: Partial<RuleInput> = {}) => r({ calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 500_000, ...p });

  it("[NHH-DV-03] FIXED: số nguyên dương qua; 0, âm, lẻ, thiếu ⇒ lỗi; mang tỉ lệ / bảng bậc ⇒ lỗi", () => {
    expect(loi(fixed({ fixedAmount: 1 }))).toEqual([]);
    for (const sai of [0, -1, 1.5, null]) expect(loi(fixed({ fixedAmount: sai })).length, String(sai)).toBe(1);
    expect(loi(fixed({ rate: 0.01 }))).toHaveLength(1);
    expect(loi(fixed({ tierTable: [] }))).toHaveLength(1);
  });

  it("[NHH-DV-04] TIER: cần bảng bậc, không mang tỉ lệ / số tiền cố định", () => {
    const tier = (p: Partial<RuleInput> = {}) => r({ calcKind: "TIER_PERIOD_BONUS", rate: null, tierTable: [{ tu: 0, den: null, tien: 1 }], ...p });
    expect(loi(tier())).toEqual([]);
    expect(loi(tier({ tierTable: null }))).toHaveLength(1);
    expect(loi(tier({ rate: 0.01 }))).toHaveLength(1);
    expect(loi(tier({ fixedAmount: 1 }))).toHaveLength(1);
  });

  it("[NHH-DV-05] EXCLUDE không mang giá trị nào", () => {
    // Cấy 08/10 (I06): bỏ cổng này ⇒ 0 ca đỏ.
    const loai = (p: Partial<RuleInput> = {}) => r({ calcKind: "EXCLUDE", rate: null, ...p });
    expect(loi(loai())).toEqual([]);
    expect(loi(loai({ rate: 0.01 }))).toHaveLength(1);
    expect(loi(loai({ fixedAmount: 1 }))).toHaveLength(1);
    expect(loi(loai({ tierTable: [] }))).toHaveLength(1);
  });

  it("[NHH-DV-06] mọi lỗi được gom MỘT lượt (người soạn sửa một lần) và nêu đúng rule", () => {
    const e = loi(r({ rate: 0 }), r({ roleCode: "SALE_ADMIN", calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 0 }));
    expect(e).toHaveLength(2);
    expect(e[0]).toContain("Rule #1");
    expect(e[1]).toContain("Rule #2");
  });
});

describe("[NHH-DV-07] khoá phạm vi + cột scope* (khớp CHECK pham_vi: đúng MỘT cột theo loại)", () => {
  const BANG: [PhamViInput, string, string | null][] = [
    [{ loai: "GLOBAL" }, "GLOBAL", null],
    [{ loai: "PERSON", userId: "u1" }, "PERSON:u1", "scopeUserId"],
    [{ loai: "AFFILIATE", affiliateId: "a1" }, "AFFILIATE:a1", "scopeAffiliateId"],
    [{ loai: "SOURCE_GROUP", sourceGroupId: "g1" }, "SOURCE_GROUP:g1", "scopeSourceGroupId"],
    [{ loai: "ORG_UNIT", orgUnitId: "o1" }, "ORG_UNIT:o1", "scopeOrgUnitId"],
    [{ loai: "ROLE", roleDefId: "rd1" }, "ROLE:rd1", "scopeRoleDefId"],
  ];
  const COT = ["scopeUserId", "scopeAffiliateId", "scopeSourceGroupId", "scopeOrgUnitId", "scopeRoleDefId"] as const;

  it("[NHH-DV-07] scopeKey đúng khuôn <LOẠI>:<id>; cotPhamVi điền ĐÚNG cột của loại và để NULL bốn cột còn lại", () => {
    // Cấy 08/10 (I07: ORG_UNIT khai khoá tiền tố PERSON): chỉ [NHH-POL-DB-06] đỏ — nghĩa là không có ca thuần nào canh khoá.
    for (const [pv, khoa, cot] of BANG) {
      expect(scopeKeyCua(pv), pv.loai).toBe(khoa);
      const c = cotPhamVi(pv);
      expect(c.scopeType, pv.loai).toBe(pv.loai);
      expect(c.scopeKey, pv.loai).toBe(khoa);
      const coGiaTri = COT.filter((k) => c[k] !== null);
      expect(coGiaTri, pv.loai).toEqual(cot === null ? [] : [cot]);
    }
  });
});
