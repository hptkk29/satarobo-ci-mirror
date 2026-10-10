// @vitest-environment node
/**
 * [NHH-DSP-05d] — dựng dòng DISPUTE_ADJUSTMENT (THUẦN). Hai hình dạng: đích DÒNG (giữ người/vai/chính sách) và đích KHOẢN THU (người = người khiếu nại,
 * KHÔNG chép chính sách của dòng mẫu). Cả hai: không tỉ lệ, không cơ sở tính (ngăn "Vì sao" không được in phép nhân nói dối).
 */
import { describe, it, expect } from "vitest";
import { Prisma, type CommissionTransaction } from "@prisma/client";

import { dungDongDieuChinhKhieuNai } from "./khieu-nai-dieu-chinh";
import { MA_KHIEU_NAI_DIEU_CHINH } from "./khieu-nai-ma";

function mau(p: Partial<CommissionTransaction> = {}): CommissionTransaction {
  return {
    id: "d-goc",
    idempotencyKey: "ORIG|p1|-|TUITION|SALE|USER|u-sale",
    entryKind: "ORIGINAL",
    calcSlotId: "o1",
    periodId: "ky-10",
    naturalPeriod: "2026-10",
    lateArrival: false,
    rateDate: new Date("2026-10-10T03:00:00.000Z"),
    assigneeDate: new Date("2026-10-10T03:00:00.000Z"),
    paymentId: "p1",
    orderId: "don1",
    orderItemId: "oi1",
    studentId: "hv1",
    leadId: "lead1",
    studentTransactionId: "st1",
    transactionTypeCode: "NEW",
    revenueComponent: "TUITION",
    splitMethod: "DONG",
    attributionId: "attr1",
    sourceGroupId: "g1",
    sourceGroupCode: "PAID_ADS",
    sourceId: null,
    beneficiaryRoleId: "vai-sale",
    roleCode: "SALE",
    beneficiaryKind: "USER",
    beneficiaryUserId: "u-sale",
    beneficiaryAffiliateId: null,
    beneficiaryEmployeeId: "nv-sale",
    beneficiaryName: "Sale A",
    resolverType: "TRANSACTION_ROLE",
    resolverBasis: { canCu: "lead.convertedById" },
    policyId: "pol1",
    policyVersionId: "ver1",
    versionNo: 2,
    ruleId: "rule1",
    documentNumber: "SR.QD.208",
    calcKind: "PERCENT",
    scopeOrderVersion: "v1",
    reason: "SALE 4% theo SR.QD.208",
    reasonCode: null,
    candidates: null,
    legacyTier: null,
    grossAmount: 10_000_000,
    vatRate: new Prisma.Decimal("0.1"),
    netBase: 9_090_909,
    rate: new Prisma.Decimal("0.04"),
    fixedAmount: null,
    amount: 363_636,
    capRate: new Prisma.Decimal("0.09"),
    equivalentRate: new Prisma.Decimal("0.09"),
    inputHash: "hash-goc",
    refEntryId: null,
    refEventType: null,
    refEventId: null,
    payoutStatus: "PENDING",
    payoutBatchId: null,
    payoutStatusAt: null,
    calculationRunId: null,
    createdById: null,
    createdAt: new Date("2026-10-11T03:00:00.000Z"),
    centerId: "cs1",
    orgUnitId: "ou1",
    ...p,
  } as CommissionTransaction;
}

const NEN = { id: "dong-moi", disputeId: "kn1", soTien: 50_000, lyDoQuyetDinh: "Bù phần bị thiếu theo biên bản", periodId: "ky-11", lateArrival: true };
const NGUOI_REF = {
  nguoi: { userId: "u-ref", employeeId: "nv-ref", ten: "Người giới thiệu" },
  vai: { id: "vai-ref", code: "REFERRER_EMPLOYEE", resolverType: "DIRECT_PERSON" as const },
};

describe("[NHH-DSP-05d] dungDongDieuChinhKhieuNai", () => {
  it("đích DÒNG: giữ NGƯỜI + VAI + CHÍNH SÁCH của dòng bị khiếu nại; tiền = số HR quyết; kỳ ghi = kỳ OPEN, kỳ hiệu lực = kỳ của dòng gốc", () => {
    const r = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan: null });
    expect(r).toMatchObject({
      id: "dong-moi",
      entryKind: "DISPUTE_ADJUSTMENT",
      amount: 50_000,
      calcSlotId: "o1",
      periodId: "ky-11",
      naturalPeriod: "2026-10",
      lateArrival: true,
      roleCode: "SALE",
      beneficiaryUserId: "u-sale",
      beneficiaryName: "Sale A",
      policyVersionId: "ver1",
      documentNumber: "SR.QD.208",
      paymentId: "p1",
      orderId: "don1",
      centerId: "cs1",
      orgUnitId: "ou1",
      refEntryId: "d-goc",
      refEventType: "DISPUTE",
      refEventId: "kn1",
      reasonCode: MA_KHIEU_NAI_DIEU_CHINH,
    });
    expect(r.reason).toContain("kn1");
    expect(r.reason).toContain("Bù phần bị thiếu theo biên bản");
  });

  it("cả hai hình dạng: KHÔNG tỉ lệ, KHÔNG cơ sở tính (ngăn Vì sao không in phép nhân sai) — dòng mẫu có 4% × 9.090.909 mà dòng mới không mang", () => {
    for (const nguoiNhan of [null, NGUOI_REF]) {
      const r = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan });
      expect(r.calcKind).toBeNull();
      expect(r.rate).toBeNull();
      expect(r.fixedAmount).toBeNull();
      expect(r.grossAmount).toBe(0);
      expect(r.netBase).toBe(0);
    }
  });

  it("đích KHOẢN THU: người = NGƯỜI KHIẾU NẠI, vai = vai chọn; chính sách của dòng mẫu KHÔNG được chép sang", () => {
    const r = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan: NGUOI_REF });
    expect(r).toMatchObject({
      roleCode: "REFERRER_EMPLOYEE",
      beneficiaryRoleId: "vai-ref",
      beneficiaryKind: "USER",
      beneficiaryUserId: "u-ref",
      beneficiaryAffiliateId: null,
      beneficiaryEmployeeId: "nv-ref",
      beneficiaryName: "Người giới thiệu",
      resolverType: "DIRECT_PERSON",
      policyId: null,
      policyVersionId: null,
      versionNo: null,
      ruleId: null,
      documentNumber: null,
      // ngữ cảnh khoản thu vẫn chép từ dòng mẫu
      paymentId: "p1",
      orderId: "don1",
      studentId: "hv1",
      sourceGroupCode: "PAID_ADS",
      calcSlotId: "o1",
    });
    expect(r.beneficiaryUserId).not.toBe("u-sale");
  });

  it("khoá idempotency gồm (khiếu nại × ô × VAI × NGƯỜI NHẬN): cùng khiếu nại + cùng người ⇒ cùng khoá; khác người ⇒ khác khoá", () => {
    const a = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan: null });
    const b = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan: null });
    const c = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau(), nguoiNhan: NGUOI_REF });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey);
    expect(a.idempotencyKey).toBe("DISPUTE_ADJUSTMENT|kn1|o1|SALE|USER|u-sale");
  });

  it("số tiền âm (đòi lại) giữ nguyên dấu; không đổi bất kỳ trường nào ngoài số tiền", () => {
    const duong = dungDongDieuChinhKhieuNai({ ...NEN, soTien: 50_000, mau: mau(), nguoiNhan: null });
    const am = dungDongDieuChinhKhieuNai({ ...NEN, soTien: -50_000, mau: mau(), nguoiNhan: null });
    expect(am.amount).toBe(-50_000);
    expect({ ...am, amount: 0 }).toEqual({ ...duong, amount: 0 });
  });

  it("dòng mẫu KHÔNG có ô (PERIOD_BONUS/LEGACY) ⇒ dòng điều chỉnh cũng không có ô (CHECK `o_tinh_chk` cho phép NULL với DISPUTE_ADJUSTMENT)", () => {
    const r = dungDongDieuChinhKhieuNai({ ...NEN, mau: mau({ calcSlotId: null, entryKind: "LEGACY_REVERSAL" }), nguoiNhan: null });
    expect(r.calcSlotId).toBeNull();
  });
});
