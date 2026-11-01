// @vitest-environment node
/**
 * [NHH-DSP-VS] — ngăn "Vì sao" của dòng ĐIỀU CHỈNH DO KHIẾU NẠI (THUẦN). Dòng này không có cơ sở / tỉ lệ / trần, nên ngăn KHÔNG được in những bước ấy
 * (cấy 13/10: bỏ nhánh riêng ⇒ ngăn in "Cơ sở tính hoa hồng 0đ → 0đ" và "Kiểm trần" cho một số tiền người duyệt gõ tay).
 */
import { describe, it, expect } from "vitest";

import { MA_KHIEU_NAI_DIEU_CHINH } from "./khieu-nai-ma";
import { dungViSao, type DongChoViSao } from "./vi-sao";

const dong = (p: Partial<DongChoViSao> = {}): DongChoViSao => ({
  entryKind: "DISPUTE_ADJUSTMENT",
  amount: 50_000,
  grossAmount: 0,
  vatRate: 0.1,
  netBase: 0,
  rate: null,
  fixedAmount: null,
  capRate: 0.09,
  equivalentRate: 0.09,
  sourceGroupCode: "PAID_ADS",
  transactionTypeCode: "NEW",
  roleCode: "SALE",
  splitMethod: "DONG",
  documentNumber: null,
  versionNo: null,
  calcKind: null,
  reason: "Điều chỉnh do khiếu nại kn1: Bù phần bị thiếu theo biên bản",
  reasonCode: MA_KHIEU_NAI_DIEU_CHINH,
  naturalPeriod: "2026-10",
  kyGhi: "2026-11",
  lateArrival: true,
  refEntryId: "d-goc",
  refEventType: "DISPUTE",
  refEventId: "kn1",
  resolverBasis: { canCu: "KHIEU_NAI", disputeId: "kn1" },
  paymentId: "p1",
  ...p,
});

describe("[NHH-DSP-VS] dungViSao — dòng DISPUTE_ADJUSTMENT do khiếu nại", () => {
  it("in loại dòng, kỳ (hiệu lực vs ghi sổ), số tiền, lý do, khiếu nại, dòng liên quan — KHÔNG in cơ sở tính / công thức / kiểm trần", () => {
    const v = dungViSao(dong(), true);
    const nhan = v.buoc.map((b) => b.nhan);
    expect(v.tieuDe).toBe("Điều chỉnh do khiếu nại · SALE");
    expect(nhan).toEqual(["Loại dòng", "Kỳ", "Số tiền điều chỉnh", "Lý do", "Khiếu nại", "Dòng liên quan"]);
    expect(v.buoc.find((b) => b.nhan === "Kỳ")!.giaTri).toBe("Hiệu lực 2026-10 · ghi vào kỳ 2026-11");
    expect(v.buoc.find((b) => b.nhan === "Số tiền điều chỉnh")!.giaTri).toBe("50.000đ");
    for (const cam of ["Cơ sở tính hoa hồng", "Công thức", "Kiểm trần", "Chính sách áp dụng", "Nhóm nguồn", "Loại giao dịch"]) expect(nhan).not.toContain(cam);
    expect(v.canhBao).toHaveLength(1);
  });

  it("số tiền ÂM (đòi lại) in có dấu trừ; kỳ không muộn ⇒ không cảnh báo", () => {
    const v = dungViSao(dong({ amount: -30_000, lateArrival: false, kyGhi: "2026-10" }), false);
    expect(v.buoc.find((b) => b.nhan === "Số tiền điều chỉnh")!.giaTri).toBe("−30.000đ");
    expect(v.buoc.find((b) => b.nhan === "Kỳ")!.giaTri).toBe("Kỳ 2026-10");
    expect(v.canhBao).toEqual([]);
  });

  it("đối chứng: DISPUTE_ADJUSTMENT KHÔNG phải của khiếu nại (kind mượn của khoản hoàn sổ cũ / reasonCode khác) vẫn đi nhánh chung", () => {
    const v = dungViSao(dong({ reasonCode: "KHOAN_HOAN_LEGACY_BI_RUT_KHOI_PHUC" }), true);
    expect(v.buoc.map((b) => b.nhan)).toContain("Cơ sở tính hoa hồng");
    expect(v.tieuDe).toContain("Trả lại hoa hồng đã thu hồi");
  });
});
