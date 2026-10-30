// R7-05 — unit cho phần THUẦN của convert v2 (guard, dedupe, codegen). DB-touching
// (convertLeadV2 transaction) để cho e2e/integration.
import { describe, it, expect } from "vitest";
import { evaluatePaymentGuard, computeInstallmentSplit } from "@/lib/crm/convert-lead-v2";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import { normalizeName, classifyParentMatch, studentMatches } from "@/lib/crm/dedupe";
import {
  randomStudentCodeBody,
  formatStudentCodeV2,
  STUDENT_CODE_V2_CHARSET,
} from "@/lib/codegen";

describe("[R7-05] evaluatePaymentGuard (AC1/C1/C3 — R7-05-C2)", () => {
  it("có khoản Sale ghi nhận (RECORDED) → pass (không scholarship; KT chưa confirm vẫn pass)", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: true, totalFinalPrice: 9_000_000 })).toEqual({
      ok: true,
      scholarshipFull: false,
    });
  });
  it("0 khoản + finalPrice=0 → pass + scholarshipFull (audit)", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 0 })).toEqual({
      ok: true,
      scholarshipFull: true,
    });
  });
  it("0 khoản RECORDED + finalPrice>0 → PAYMENT_REQUIRED", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 9_000_000 }).ok).toBe(false);
  });
});

// 27/08 — hồi quy cho bế tắc thật trên prod: lead được miễn phí học phí toàn phần mà
// bấm chốt vẫn báo PAYMENT_REQUIRED. Guard vốn ĐÚNG; hỏng ở chỗ form convert cố định
// `discount: null` ⇒ tổng sau ưu đãi luôn = giá niêm yết ⇒ nhánh học bổng không bao
// giờ tới lượt. Test này chốt lại ĐƯỜNG ĐI đầy đủ giá → ưu đãi → guard, đúng thứ tự
// mà server action gọi, để lần sau ai bỏ ưu đãi khỏi đường truyền là đỏ ngay.
describe("[27/08] miễn phí toàn phần chốt được KHÔNG cần khoản thu", () => {
  const guardFor = (students: { listPrice: number; discount: Parameters<typeof computeEnrollmentPrice>[0]["discount"] }[]) =>
    evaluatePaymentGuard({
      hasRecordedPayment: false,
      totalFinalPrice: students.reduce(
        (sum, s) => sum + computeEnrollmentPrice(s).finalPrice,
        0,
      ),
    });

  it("học bổng 100% (1 em) → pass + scholarshipFull", () => {
    expect(guardFor([{ listPrice: 9_000_000, discount: { type: "SCHOLARSHIP", value: 100 } }])).toEqual({
      ok: true,
      scholarshipFull: true,
    });
  });

  it("giảm 100% dạng PERCENT cũng về 0 → pass", () => {
    expect(guardFor([{ listPrice: 12_000_000, discount: { type: "PERCENT", value: 100 } }]).ok).toBe(true);
  });

  it("giảm đúng bằng giá lớp (AMOUNT) → pass", () => {
    expect(guardFor([{ listPrice: 9_000_000, discount: { type: "AMOUNT", value: 9_000_000 } }]).ok).toBe(true);
  });

  it("MIỄN PHÍ MỘT PHẦN vẫn phải thu tiền — 2 em, 1 em free thì tổng > 0 ⇒ chặn", () => {
    expect(
      guardFor([
        { listPrice: 9_000_000, discount: { type: "SCHOLARSHIP", value: 100 } },
        { listPrice: 9_000_000, discount: null },
      ]).ok,
    ).toBe(false);
  });

  it("giảm 50% KHÔNG phải miễn phí ⇒ vẫn đòi khoản thu", () => {
    expect(guardFor([{ listPrice: 9_000_000, discount: { type: "PERCENT", value: 50 } }]).ok).toBe(false);
  });

  it("không ưu đãi (hành vi cũ, đường mặc định) ⇒ vẫn đòi khoản thu", () => {
    expect(guardFor([{ listPrice: 9_000_000, discount: null }]).ok).toBe(false);
  });
});

describe("[FL2-01] computeInstallmentSplit — tổng 2 đợt LUÔN bằng order total", () => {
  it("dot1 trong khoảng → dot2 = phần còn lại", () => {
    expect(computeInstallmentSplit(10_000_000, 6_000_000)).toEqual({ dot1: 6_000_000, dot2: 4_000_000 });
  });
  it("dot1 = 0 → dot2 = toàn bộ", () => {
    expect(computeInstallmentSplit(8_000_000, 0)).toEqual({ dot1: 0, dot2: 8_000_000 });
  });
  it("dot1 > total → clamp về total, dot2 = 0", () => {
    expect(computeInstallmentSplit(5_000_000, 9_000_000)).toEqual({ dot1: 5_000_000, dot2: 0 });
  });
  it("dot1 âm → clamp về 0", () => {
    expect(computeInstallmentSplit(5_000_000, -100)).toEqual({ dot1: 0, dot2: 5_000_000 });
  });
  it("bất biến: dot1 + dot2 === total (mọi input hợp lệ)", () => {
    for (const [total, d1] of [
      [10_000_000, 3_000_000],
      [7_500_000, 7_500_000],
      [1_000_000, 12_000_000],
    ] as const) {
      const { dot1, dot2 } = computeInstallmentSplit(total, d1);
      expect(dot1 + dot2).toBe(total);
    }
  });
});

describe("[R7-05] dedupe parent 3 nhánh (AC3/C6)", () => {
  it("không khớp → none", () => {
    expect(classifyParentMatch(null, null)).toEqual({ kind: "none" });
  });
  it("cả 2 khớp cùng hồ sơ → reuse", () => {
    expect(classifyParentMatch("u1", "u1")).toEqual({ kind: "reuse", userId: "u1" });
  });
  it("chỉ 1 khớp → reuse", () => {
    expect(classifyParentMatch("u1", null)).toEqual({ kind: "reuse", userId: "u1" });
    expect(classifyParentMatch(null, "u2")).toEqual({ kind: "reuse", userId: "u2" });
  });
  it("email∈A & phone∈B khác nhau → conflict", () => {
    expect(classifyParentMatch("uA", "uB")).toEqual({ kind: "conflict", parentAId: "uA", parentBId: "uB" });
  });
});

describe("[R7-05] normalize + student match (AC4/C7)", () => {
  it("normalizeName: trim + gộp space + casefold", () => {
    expect(normalizeName("  Nguyễn   Văn  A ")).toBe("nguyễn văn a");
  });
  it("studentMatches: cùng tên chuẩn hoá + DOB → true", () => {
    const dob = new Date("2016-05-10");
    expect(studentMatches({ name: " nguyễn  văn a ", dob }, { name: "Nguyễn Văn A", dob })).toBe(true);
  });
  it("studentMatches: khác DOB → false", () => {
    expect(
      studentMatches(
        { name: "A", dob: new Date("2016-05-10") },
        { name: "A", dob: new Date("2017-05-10") },
      ),
    ).toBe(false);
  });
});

describe("[R7-05] genStudentCodeV2 format/charset (AC6/C9)", () => {
  it("body 6 ký tự thuộc charset không nhập nhằng (không I/L/O/0/1)", () => {
    const body = randomStudentCodeBody(() => 0.5);
    expect(body).toHaveLength(6);
    expect([...body].every((c) => STUDENT_CODE_V2_CHARSET.includes(c))).toBe(true);
    expect(/[ILO01]/.test(STUDENT_CODE_V2_CHARSET)).toBe(false);
  });
  it("format CS1-YY-XXXXXX", () => {
    const code = formatStudentCodeV2("CS1", "AB3K9P", new Date("2026-01-01"));
    expect(code).toBe("CS1-26-AB3K9P");
  });
});
